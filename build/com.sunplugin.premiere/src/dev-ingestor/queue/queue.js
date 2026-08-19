"use strict";
/**
 * Download queue.
 *
 * Every acquisition passes through here, which is what makes the guards
 * unavoidable. The order is fixed and an adapter cannot reorder it:
 *
 *   source automatable?  ->  license verified?  ->  URL allowed?  ->  fetch
 *   ->  validate bytes   ->  promote into library  ->  index
 *
 * Jobs are observable (queued, running, done, failed, skipped), retryable with
 * backoff, cancellable, and pausable. Failures are recorded rather than thrown
 * away, because "why did that not download" is the question this subsystem gets
 * asked most.
 */

const { EventEmitter } = require("events");

const {
  assertSourceAutomatable, assertLicenseAcceptable,
  GuardError, ManualOnlySourceError,
  SessionLimiter, RateLimiter,
} = require("./guards");
const { ingestBuffer } = require("../../core/library/ingest");

const STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
  MANUAL: "manual-required",
};

let nextJobId = 1;

class DownloadJob {
  constructor({ adapter, ref, source, options = {} }) {
    this.id = `job-${nextJobId++}`;
    this.adapter = adapter;
    this.ref = ref;
    this.source = source;
    this.options = options;

    this.status = STATUS.QUEUED;
    this.progress = 0;
    this.error = null;
    this.errorCode = null;
    this.attempts = 0;
    this.assetId = null;
    this.bytes = null;
    this.filename = null;
    this.url = null;
    this.pageUrl = null;
    this.startedAt = null;
    this.finishedAt = null;
  }

  get title() {
    return (this.ref && (this.ref.title || this.ref.name)) || this.id;
  }

  toJSON() {
    return {
      id: this.id,
      source: this.source.id,
      title: this.title,
      status: this.status,
      progress: this.progress,
      error: this.error,
      errorCode: this.errorCode,
      attempts: this.attempts,
      assetId: this.assetId,
      bytes: this.bytes,
      filename: this.filename,
      url: this.url,
      pageUrl: this.pageUrl,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }
}

class DownloadQueue extends EventEmitter {
  constructor(db, { concurrency = 2, maxRetries = 2 } = {}) {
    super();
    this.db = db;
    this.concurrency = concurrency;
    this.maxRetries = maxRetries;

    this.jobs = [];
    this.active = new Set();
    this.paused = false;
    this.cancelled = false;

    this.sessionLimiter = new SessionLimiter();
    this.rateLimiter = new RateLimiter();
  }

  add(adapter, ref, source, options = {}) {
    const job = new DownloadJob({ adapter, ref, source, options });
    job.pageUrl = safeCall(() => adapter.getAssetPage(ref), null);
    this.jobs.push(job);
    this.emit("added", job.toJSON());
    return job;
  }

  addMany(adapter, refs, source, options = {}) {
    return refs.map((ref) => this.add(adapter, ref, source, options));
  }

  get stats() {
    const counts = {};
    for (const status of Object.values(STATUS)) counts[status] = 0;
    for (const job of this.jobs) counts[job.status] = (counts[job.status] || 0) + 1;
    return {
      total: this.jobs.length,
      ...counts,
      active: this.active.size,
      paused: this.paused,
    };
  }

  pause() {
    this.paused = true;
    this.emit("paused");
  }

  resume() {
    this.paused = false;
    this.emit("resumed");
  }

  cancel() {
    this.cancelled = true;
    for (const job of this.jobs) {
      if (job.status === STATUS.QUEUED) {
        job.status = STATUS.CANCELLED;
        this.emit("job", job.toJSON());
      }
    }
    this.emit("cancelled");
  }

  retryFailed() {
    let n = 0;
    for (const job of this.jobs) {
      if (job.status === STATUS.FAILED) {
        job.status = STATUS.QUEUED;
        job.error = null;
        job.errorCode = null;
        n++;
      }
    }
    return n;
  }

  /** Run the queue to completion. Resolves with a summary. */
  async run() {
    this.cancelled = false;
    const workers = [];
    for (let i = 0; i < this.concurrency; i++) workers.push(this.worker());
    await Promise.all(workers);

    const summary = this.stats;
    this.emit("complete", summary);
    return summary;
  }

  async worker() {
    for (;;) {
      while (this.paused && !this.cancelled) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (this.cancelled) return;

      const job = this.jobs.find((j) => j.status === STATUS.QUEUED);
      if (!job) return;

      job.status = STATUS.RUNNING;
      job.startedAt = new Date().toISOString();
      this.active.add(job.id);
      this.emit("job", job.toJSON());

      try {
        await this.process(job);
      } catch (e) {
        this.fail(job, e);
      } finally {
        this.active.delete(job.id);
        job.finishedAt = new Date().toISOString();
        this.emit("job", job.toJSON());
      }
    }
  }

  async process(job) {
    job.attempts++;
    const { adapter, ref, source } = job;

    // 1. Is this source permitted to auto-download at all?
    try {
      assertSourceAutomatable(source);
    } catch (e) {
      if (e instanceof ManualOnlySourceError) {
        job.status = STATUS.MANUAL;
        job.error = e.message;
        job.errorCode = e.code;
        job.pageUrl = e.pageUrl || job.pageUrl;
        return;
      }
      throw e;
    }

    // 2. License, before any bytes move.
    const license = await adapter.verifyLicense(ref);
    try {
      assertLicenseAcceptable(license, source, adapter.policy);
    } catch (e) {
      job.status = STATUS.SKIPPED;
      job.error = e.message;
      job.errorCode = e.code;
      return;
    }

    // 3. Per-session volume cap, for sources whose terms limit it.
    const category = job.options.category || ref.type || null;
    try {
      this.sessionLimiter.check(source, category, 1);
    } catch (e) {
      job.status = STATUS.SKIPPED;
      job.error = e.message;
      job.errorCode = e.code;
      return;
    }

    // 4. Politeness throttle.
    await this.rateLimiter.wait(source);
    if (this.cancelled) { job.status = STATUS.CANCELLED; return; }

    const info = await adapter.getDownloadInformation(ref, job.options);
    if (info && info.manualOnly) {
      job.status = STATUS.MANUAL;
      job.error = "this source requires a manual download";
      job.errorCode = "MANUAL_ONLY";
      job.pageUrl = info.pageUrl;
      return;
    }
    job.url = info && info.url;
    job.progress = 0.1;
    this.emit("job", job.toJSON());

    // 5. Fetch. The adapter applies the URL allowlist inside fetchBytes.
    const downloaded = await adapter.download(ref, job.options);
    job.bytes = downloaded.bytes.length;
    job.filename = downloaded.filename;
    job.progress = 0.7;
    this.emit("job", job.toJSON());

    // 6. Validate and index. Everything from here is shared with user import,
    //    so a downloaded file gets exactly the same scrutiny as an imported one.
    const normalized = adapter.normalizeMetadata(ref);
    const result = ingestBuffer(this.db, {
      bytes: downloaded.bytes,
      filename: downloaded.filename,
      developmentOnly: true,
      source: source.id,
      sourceUrl: normalized.sourceUrl,
      author: normalized.author,
      license: license.spdx || normalized.license,
      licenseUrl: license.url || normalized.licenseUrl,
      attribution: license.attribution || normalized.attribution,
      syntheticFixture: normalized.syntheticFixture === true,
      hints: {
        type: job.options.type || normalized.type,
        category: job.options.category || normalized.category,
        subcategory: normalized.subcategory,
      },
      meta: normalized.meta,
    });

    if (result.quarantined) {
      job.status = STATUS.FAILED;
      job.error = `quarantined: ${result.reason}`;
      job.errorCode = "QUARANTINED";
      return;
    }

    if (result.duplicate) {
      job.status = STATUS.SKIPPED;
      job.error = "already in library";
      job.errorCode = "DUPLICATE";
      job.assetId = result.asset.id;
      return;
    }

    this.sessionLimiter.record(source, category, 1);
    job.assetId = result.asset.id;
    job.progress = 1;
    job.status = STATUS.DONE;
  }

  fail(job, error) {
    job.error = error.message;
    job.errorCode = error.code || "ERROR";

    // An aggregator hands back media hosted on the original provider's CDN,
    // which is deliberately not in the allowlist — allowlisting one domain must
    // not turn it into an open proxy to anywhere. That is not a failure the user
    // can act on by retrying; it is a manual download, so say so and hand over
    // the page rather than reporting a dead end.
    if (error.code === "DOMAIN_NOT_DECLARED" || error.code === "HOST_PROHIBITED") {
      job.status = STATUS.MANUAL;
      job.error = `${error.message}. Open the page to download it yourself, then IMPORT.`;
      return;
    }

    const retryable = !(error instanceof GuardError) && job.attempts <= this.maxRetries;

    if (retryable) {
      job.status = STATUS.QUEUED;
      // Exponential backoff, applied by delaying the next rate-limit slot.
      const delay = Math.min(8000, 500 * Math.pow(2, job.attempts));
      this.rateLimiter.last.set(job.source.id, Date.now() + delay);
    } else {
      job.status = STATUS.FAILED;
    }
  }

  /** Jobs needing a human, grouped by page — the manual-download worklist. */
  manualWorklist() {
    return this.jobs
      .filter((j) => j.status === STATUS.MANUAL)
      .map((j) => ({ title: j.title, source: j.source.name, pageUrl: j.pageUrl, reason: j.error }));
  }

  report() {
    return {
      ...this.stats,
      jobs: this.jobs.map((j) => j.toJSON()),
      manual: this.manualWorklist(),
    };
  }
}

function safeCall(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

module.exports = { DownloadQueue, DownloadJob, STATUS };
