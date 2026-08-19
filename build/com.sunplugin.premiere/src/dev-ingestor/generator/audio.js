"use strict";
/**
 * SFX synthesis.
 *
 * Real 48kHz PCM audio, synthesised from scratch, emitted as .wav that Premiere
 * imports directly. Every sound is seeded from its own name, so regenerating the
 * corpus reproduces byte-identical files and the database hashes stay stable.
 *
 * The families mirror how an editor actually reaches for sound: whooshes for
 * motion, impacts for accents, risers and downers for tension, UI ticks for
 * interface work, ambience for beds.
 */

const { encodeWAV } = require("../../core/util/wav");

const SR = 48000;

/* ----------------------------------------------------------------- helpers */

/** Small, fast, seedable PRNG. Deterministic output is the point. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** RBJ biquad. type: lowpass | highpass | bandpass | peak */
function biquad(type, freq, q, sampleRate = SR) {
  const w0 = (2 * Math.PI * clamp(freq, 20, sampleRate / 2 - 100)) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(0.05, q));

  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case "highpass":
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    default: // lowpass
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * Filter with per-sample coefficient updates, so a filter can sweep across the
 * sound. `freqAt(t01)` returns the cutoff at that position, 0..1 through the buffer.
 */
function sweepFilter(buf, type, freqAt, q = 1) {
  const out = new Float32Array(buf.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;

  for (let i = 0; i < buf.length; i++) {
    const c = biquad(type, freqAt(i / (buf.length - 1 || 1)), q);
    const x0 = buf[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

function whiteNoise(n, rnd) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rnd() * 2 - 1;
  return out;
}

/** Pink-ish noise via the Voss-McCartney style filter cascade. */
function pinkNoise(n, rnd) {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** Oscillator with a frequency envelope. shape: sine | saw | square | triangle */
function osc(n, freqAt, shape = "sine") {
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = Math.max(1, freqAt(i / (n - 1 || 1)));
    phase += (2 * Math.PI * f) / SR;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    switch (shape) {
      case "saw": out[i] = 1 - phase / Math.PI; break;
      case "square": out[i] = phase < Math.PI ? 1 : -1; break;
      case "triangle": out[i] = 1 - 4 * Math.abs(Math.round(phase / (2 * Math.PI)) - phase / (2 * Math.PI)); break;
      default: out[i] = Math.sin(phase);
    }
  }
  return out;
}

/** Apply an amplitude envelope: envAt(t01) -> gain. */
function envelope(buf, envAt) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * envAt(i / (buf.length - 1 || 1));
  return out;
}

const expDecay = (rate) => (t) => Math.exp(-t * rate);
const expAttack = (rate) => (t) => 1 - Math.exp(-t * rate);

function mix(...buffers) {
  const n = Math.max(...buffers.map((b) => b.length));
  const out = new Float32Array(n);
  for (const b of buffers) for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}

function gain(buf, g) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * g;
  return out;
}

/** Soft saturation: adds harmonics and stops peaks from clipping hard. */
function saturate(buf, drive = 1.5) {
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = Math.tanh(buf[i] * drive) / Math.tanh(drive);
  return out;
}

/** Schroeder reverb: four combs into two allpasses. Cheap, and enough here. */
function reverb(buf, amount = 0.3, decay = 0.75) {
  if (amount <= 0) return buf;
  const combDelays = [1687, 1601, 2053, 2251];
  const apDelays = [389, 127];
  const wet = new Float32Array(buf.length);

  for (const d of combDelays) {
    const buffer = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < buf.length; i++) {
      const delayed = buffer[idx];
      buffer[idx] = buf[i] + delayed * decay;
      wet[i] += delayed * 0.25;
      idx = (idx + 1) % d;
    }
  }

  let stage = wet;
  for (const d of apDelays) {
    const buffer = new Float32Array(d);
    const out = new Float32Array(stage.length);
    let idx = 0;
    for (let i = 0; i < stage.length; i++) {
      const delayed = buffer[idx];
      const v = -stage[i] + delayed;
      buffer[idx] = stage[i] + delayed * 0.5;
      out[i] = v;
      idx = (idx + 1) % d;
    }
    stage = out;
  }

  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] * (1 - amount * 0.5) + stage[i] * amount;
  return out;
}

/**
 * Normalise to a target peak, then taper the edges just enough to avoid a DC
 * click at the boundaries.
 *
 * The fade-in has to stay very short. A percussive sound puts all its energy in
 * the first few milliseconds, so a 5ms fade-in does not "prevent a click", it
 * deletes the transient — a 90ms UI click came out at 8% of its intended level
 * before this was split into separate in/out lengths.
 */
function finish(buf, peak = 0.89) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const g = max > 0 ? peak / max : 1;

  const fadeIn = Math.min(32, Math.floor(buf.length / 64));   // <=0.7ms
  const fadeOut = Math.min(480, Math.floor(buf.length / 8));  // <=10ms

  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let v = buf[i] * g;
    if (fadeIn > 0 && i < fadeIn) v *= i / fadeIn;
    const tail = buf.length - 1 - i;
    if (fadeOut > 0 && tail < fadeOut) v *= tail / fadeOut;
    out[i] = v;
  }
  return out;
}

const secs = (s) => Math.max(1, Math.round(s * SR));

/* ---------------------------------------------------------------- families */

const FAMILIES = {
  /** Air moving past the mic: swept bandpass noise with a motion envelope. */
  whoosh(rnd, p) {
    const n = secs(p.duration);
    const noise = p.tone === "pink" ? pinkNoise(n, rnd) : whiteNoise(n, rnd);

    // The sweep direction is what makes a whoosh feel like it enters or exits.
    const lo = p.startFreq;
    const hi = p.endFreq;
    const swept = sweepFilter(noise, "bandpass",
      (t) => lo + (hi - lo) * Math.pow(t, p.curve), p.resonance);

    const shaped = envelope(swept, (t) => {
      const attack = Math.min(1, t / p.attack);
      const release = Math.pow(1 - Math.min(1, Math.max(0, (t - p.peak) / (1 - p.peak))), p.releaseCurve);
      return attack * (t < p.peak ? 1 : release);
    });

    return finish(reverb(saturate(shaped, p.drive), p.space, 0.7));
  },

  /** Weight: a sub-bass drop under a broadband crack. */
  impact(rnd, p) {
    const n = secs(p.duration);

    const sub = envelope(
      osc(n, (t) => p.subStart * Math.pow(p.subEnd / p.subStart, Math.min(1, t * 4)), "sine"),
      expDecay(p.subDecay));

    const body = envelope(
      sweepFilter(whiteNoise(n, rnd), "lowpass", (t) => p.bodyFreq * (1 - t * 0.7) + 120, 0.9),
      expDecay(p.bodyDecay));

    const crack = envelope(
      sweepFilter(whiteNoise(n, rnd), "highpass", () => p.crackFreq, 0.7),
      expDecay(p.crackDecay));

    const mixed = mix(gain(sub, p.subLevel), gain(body, p.bodyLevel), gain(crack, p.crackLevel));
    return finish(reverb(saturate(mixed, p.drive), p.space, p.tail));
  },

  /** Tension build: pitch and brightness climbing together. */
  riser(rnd, p) {
    const n = secs(p.duration);

    const noise = sweepFilter(pinkNoise(n, rnd), "bandpass",
      (t) => p.filterStart + (p.filterEnd - p.filterStart) * Math.pow(t, p.curve), p.resonance);

    const tone = osc(n, (t) => p.toneStart * Math.pow(p.toneEnd / p.toneStart, Math.pow(t, p.curve)), p.shape);

    // Amplitude climbs with the pitch, which is what sells the build.
    const shaped = envelope(mix(gain(noise, 0.75), gain(tone, p.toneLevel)),
      (t) => Math.pow(t, p.swell) * (t > 0.985 ? (1 - t) / 0.015 : 1));

    return finish(reverb(saturate(shaped, p.drive), p.space, 0.8));
  },

  /** The inverse: everything falling away. */
  downer(rnd, p) {
    const n = secs(p.duration);

    const noise = sweepFilter(pinkNoise(n, rnd), "bandpass",
      (t) => p.filterStart + (p.filterEnd - p.filterStart) * Math.pow(t, p.curve), p.resonance);

    const tone = osc(n, (t) => p.toneStart * Math.pow(p.toneEnd / p.toneStart, Math.pow(t, p.curve)), p.shape);

    const shaped = envelope(mix(gain(noise, 0.6), gain(tone, p.toneLevel)),
      (t) => Math.min(1, t / 0.04) * Math.pow(1 - t, p.fall));

    return finish(reverb(saturate(shaped, p.drive), p.space, 0.7));
  },

  /** Interface sounds: short, clean, and pitched to feel deliberate. */
  ui(rnd, p) {
    const n = secs(p.duration);

    const tone = envelope(
      osc(n, (t) => p.freq * (p.bend ? Math.pow(p.bend, t) : 1), p.shape),
      expDecay(p.decay));

    const click = p.clickLevel > 0
      ? envelope(sweepFilter(whiteNoise(n, rnd), "highpass", () => 3200, 0.8), expDecay(90))
      : new Float32Array(n);

    const mixed = mix(gain(tone, 1), gain(click, p.clickLevel));
    return finish(reverb(mixed, p.space, 0.4), 0.72);
  },

  /** Beds: broadband noise, slowly modulated so it does not sound static. */
  ambience(rnd, p) {
    const n = secs(p.duration);
    const base = sweepFilter(pinkNoise(n, rnd), "lowpass", () => p.cutoff, 0.6);

    // Two detuned LFOs keep the bed from developing an obvious loop point.
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const lfo = 1
        + Math.sin(2 * Math.PI * p.lfoA * t) * p.depth
        + Math.sin(2 * Math.PI * p.lfoB * t) * p.depth * 0.6;
      out[i] = base[i] * lfo;
    }

    const shaped = envelope(out, (t) =>
      Math.min(1, t / 0.06) * Math.min(1, (1 - t) / 0.06));

    return finish(reverb(shaped, p.space, 0.85), 0.66);
  },

  /**
   * The editor workhorse: a whoosh that lands on an impact. Built by composing
   * the two families rather than duplicating their synthesis, so improvements to
   * either propagate here.
   */
  transition(rnd, p) {
    const total = secs(p.duration);
    const hitAt = Math.floor(total * p.hitPosition);

    const sweep = FAMILIES.whoosh(rnd, {
      duration: hitAt / SR, startFreq: p.startFreq, endFreq: p.endFreq,
      curve: 2.0, tone: p.tone, resonance: p.resonance, drive: 1.3,
      space: p.space * 0.5, attack: 0.1, peak: 0.9, releaseCurve: 1.2,
    });

    const hit = FAMILIES.impact(rnd, {
      duration: (total - hitAt) / SR,
      subStart: p.subStart, subEnd: p.subStart * 0.4, subLevel: p.subLevel,
      subDecay: 5, bodyFreq: 1600, bodyLevel: 0.7, bodyDecay: 16,
      crackFreq: 4200, crackLevel: 0.34, crackDecay: 40,
      drive: 1.6, space: p.space, tail: 0.8,
    });

    const out = new Float32Array(total);
    for (let i = 0; i < sweep.length && i < total; i++) out[i] += sweep[i] * 0.8;
    for (let i = 0; i < hit.length && hitAt + i < total; i++) out[hitAt + i] += hit[i];

    return finish(out);
  },

  /** Short, resonant noise bursts: cloth, paper, steps, handling. */
  foley(rnd, p) {
    const n = secs(p.duration);
    const body = sweepFilter(whiteNoise(n, rnd), "bandpass",
      (t) => p.freq * (1 + p.sweep * t), p.resonance);

    const shaped = envelope(body, (t) =>
      Math.min(1, t / p.attack) * Math.exp(-Math.max(0, t - p.attack) * p.decay));

    return finish(reverb(saturate(shaped, p.drive), p.space, 0.6), 0.78);
  },

  /** Digital failure: gated stutter over bitcrushed noise. */
  glitch(rnd, p) {
    const n = secs(p.duration);
    const noise = sweepFilter(whiteNoise(n, rnd), "bandpass",
      (t) => 600 + Math.sin(t * 40) * 2400 + t * 3000, 3);

    const out = new Float32Array(n);
    const step = Math.max(1, Math.floor(SR / p.rate));
    let hold = 0;

    for (let i = 0; i < n; i++) {
      if (i % step === 0) hold = rnd() > p.density ? 0 : 1;
      // Sample-and-hold quantisation gives the bitcrushed edge.
      const q = Math.round(noise[i] * p.bits) / p.bits;
      out[i] = q * hold;
    }

    const shaped = envelope(out, (t) => Math.min(1, t / 0.02) * Math.pow(1 - t, 0.8));
    return finish(saturate(shaped, 2.2), 0.84);
  },
};

/* ------------------------------------------------------------------ presets */

/**
 * Parameter sets per family. The variation is deliberate rather than random:
 * a corpus of 500 near-identical whooshes tests nothing, so each entry moves a
 * meaningful axis (length, direction, weight, brightness, space).
 */
function buildCatalogue() {
  const items = [];
  const add = (family, subcategory, name, params, tags) =>
    items.push({ family, subcategory, name, params, tags: tags || [] });

  /**
   * Emit numbered takes of the same design. Each take reseeds the noise, so the
   * files are genuinely different waveforms rather than copies — this is how
   * commercial SFX packs ship "Whoosh 01..30", and an editor auditioning a
   * transition wants alternates of the same character, not one of each.
   */
  const addTakes = (family, subcategory, name, params, tags, takes) => {
    if (takes <= 1) return add(family, subcategory, name, params, tags);
    for (let i = 1; i <= takes; i++) {
      add(family, subcategory, `${name} ${String(i).padStart(2, "0")}`, params, tags);
    }
  };

  // --- whooshes: length x direction x tone x space
  const whooshLengths = [
    { key: "Short", duration: 0.42 }, { key: "Medium", duration: 0.85 },
    { key: "Long", duration: 1.6 }, { key: "Extra Long", duration: 2.6 },
  ];
  const whooshMoves = [
    { key: "Up", startFreq: 380, endFreq: 5200, curve: 1.5 },
    { key: "Down", startFreq: 5200, endFreq: 380, curve: 0.7 },
    { key: "Pass By", startFreq: 900, endFreq: 900, curve: 1 },
    { key: "Fast", startFreq: 600, endFreq: 7200, curve: 2.4 },
    { key: "Reverse", startFreq: 4200, endFreq: 700, curve: 2.2 },
    { key: "Low Sweep", startFreq: 200, endFreq: 1800, curve: 1.2 },
  ];
  const whooshTones = [
    { key: "Airy", tone: "white", resonance: 1.1, drive: 1.2, space: 0.18 },
    { key: "Deep", tone: "pink", resonance: 0.8, drive: 1.8, space: 0.30 },
    { key: "Tight", tone: "white", resonance: 2.6, drive: 1.4, space: 0.08 },
    { key: "Wide", tone: "pink", resonance: 1.4, drive: 1.1, space: 0.48 },
  ];

  for (const len of whooshLengths) {
    for (const mv of whooshMoves) {
      for (const tn of whooshTones) {
        addTakes("whoosh", "whoosh", `Whoosh ${tn.key} ${mv.key} ${len.key}`, {
          duration: len.duration, ...mv, ...tn,
          attack: 0.12, peak: 0.55, releaseCurve: 1.8,
        }, ["whoosh", mv.key.toLowerCase(), tn.key.toLowerCase()], 2);
      }
    }
  }

  // --- impacts: weight x brightness x space
  const impactWeights = [
    { key: "Light", subStart: 120, subEnd: 48, subLevel: 0.5, bodyLevel: 0.7, duration: 0.7, subDecay: 9 },
    { key: "Medium", subStart: 95, subEnd: 38, subLevel: 0.8, bodyLevel: 0.8, duration: 1.1, subDecay: 6 },
    { key: "Heavy", subStart: 78, subEnd: 30, subLevel: 1.0, bodyLevel: 0.9, duration: 1.8, subDecay: 4 },
    { key: "Massive", subStart: 62, subEnd: 24, subLevel: 1.2, bodyLevel: 1.0, duration: 2.6, subDecay: 2.6 },
  ];
  const impactTones = [
    { key: "Dull", bodyFreq: 900, crackFreq: 2600, crackLevel: 0.16, drive: 1.6 },
    { key: "Bright", bodyFreq: 2200, crackFreq: 5200, crackLevel: 0.48, drive: 1.3 },
    { key: "Metal", bodyFreq: 3200, crackFreq: 7200, crackLevel: 0.62, drive: 2.4 },
    { key: "Wooden", bodyFreq: 1500, crackFreq: 3800, crackLevel: 0.34, drive: 1.9 },
    { key: "Braam", bodyFreq: 520, crackFreq: 1900, crackLevel: 0.12, drive: 2.8 },
    { key: "Sub Drop", bodyFreq: 320, crackFreq: 1400, crackLevel: 0.06, drive: 1.4 },
  ];
  const impactSpaces = [
    { key: "Dry", space: 0.05, tail: 0.55 },
    { key: "Room", space: 0.28, tail: 0.75 },
    { key: "Hall", space: 0.52, tail: 0.88 },
  ];

  for (const w of impactWeights) {
    for (const t of impactTones) {
      for (const s of impactSpaces) {
        addTakes("impact", "impact", `Impact ${w.key} ${t.key} ${s.key}`, {
          ...w, ...t, ...s, bodyDecay: 14, crackDecay: 42,
        }, ["impact", "hit", w.key.toLowerCase(), t.key.toLowerCase()], 2);
      }
    }
  }

  // --- risers
  const riserLengths = [
    { key: "Short", duration: 1.5 }, { key: "Medium", duration: 3 },
    { key: "Long", duration: 5 }, { key: "Epic", duration: 8 },
  ];
  const riserChars = [
    { key: "Noise", toneLevel: 0.18, shape: "sine", filterStart: 300, filterEnd: 9000, resonance: 1.4, curve: 2, swell: 1.6, drive: 1.3, space: 0.32 },
    { key: "Tonal", toneLevel: 0.85, shape: "saw", filterStart: 500, filterEnd: 6500, resonance: 1.8, curve: 1.6, swell: 1.3, drive: 1.7, space: 0.24 },
    { key: "Airy", toneLevel: 0.10, shape: "sine", filterStart: 900, filterEnd: 12000, resonance: 0.9, curve: 2.4, swell: 2.0, drive: 1.1, space: 0.46 },
    { key: "Dark", toneLevel: 0.55, shape: "triangle", filterStart: 180, filterEnd: 3200, resonance: 2.2, curve: 1.8, swell: 1.5, drive: 2.0, space: 0.38 },
    { key: "Metallic", toneLevel: 0.70, shape: "square", filterStart: 700, filterEnd: 8200, resonance: 3.0, curve: 2.1, swell: 1.7, drive: 2.4, space: 0.36 },
    { key: "Sub", toneLevel: 0.92, shape: "sine", filterStart: 120, filterEnd: 1400, resonance: 1.2, curve: 1.4, swell: 1.2, drive: 1.5, space: 0.28 },
  ];

  for (const len of riserLengths) {
    for (const ch of riserChars) {
      add("riser", "riser", `Riser ${ch.key} ${len.key}`, {
        duration: len.duration, ...ch, toneStart: 110, toneEnd: 1400,
      }, ["riser", "build", "tension", ch.key.toLowerCase()]);
    }
  }

  // --- downers
  for (const len of riserLengths) {
    for (const ch of riserChars) {
      add("downer", "downer", `Downer ${ch.key} ${len.key}`, {
        duration: len.duration * 0.7, ...ch,
        filterStart: ch.filterEnd, filterEnd: ch.filterStart,
        toneStart: 1400, toneEnd: 90, fall: 1.4, curve: 1.2,
      }, ["downer", "fall", "drop", ch.key.toLowerCase()]);
    }
  }

  // --- UI
  const uiKinds = [
    { key: "Click", freq: 1800, decay: 120, shape: "sine", clickLevel: 0.9, duration: 0.09, space: 0 },
    { key: "Tick", freq: 2600, decay: 180, shape: "square", clickLevel: 0.7, duration: 0.06, space: 0 },
    { key: "Pop", freq: 620, decay: 55, shape: "sine", clickLevel: 0.25, duration: 0.16, bend: 1.9, space: 0.05 },
    { key: "Beep", freq: 1046, decay: 22, shape: "sine", clickLevel: 0.05, duration: 0.22, space: 0.04 },
    { key: "Confirm", freq: 784, decay: 14, shape: "sine", clickLevel: 0.1, duration: 0.34, bend: 1.5, space: 0.12 },
    { key: "Error", freq: 220, decay: 12, shape: "square", clickLevel: 0.2, duration: 0.38, bend: 0.62, space: 0.08 },
    { key: "Toggle", freq: 1320, decay: 90, shape: "triangle", clickLevel: 0.5, duration: 0.11, bend: 1.3, space: 0.02 },
    { key: "Hover", freq: 2200, decay: 200, shape: "sine", clickLevel: 0.15, duration: 0.05, space: 0 },
    { key: "Notification", freq: 880, decay: 9, shape: "sine", clickLevel: 0.08, duration: 0.55, bend: 1.26, space: 0.18 },
    { key: "Swipe", freq: 1500, decay: 40, shape: "triangle", clickLevel: 0.35, duration: 0.18, bend: 2.4, space: 0.06 },
  ];
  const uiVariants = [
    { key: "Soft", mul: 0.72 }, { key: "Standard", mul: 1 }, { key: "Sharp", mul: 1.45 },
    { key: "Low", mul: 0.85, pitch: 0.66 }, { key: "High", mul: 1.15, pitch: 1.58 },
  ];

  for (const k of uiKinds) {
    for (const v of uiVariants) {
      const pitch = v.pitch || (v.mul > 1 ? 1.12 : v.mul < 1 ? 0.9 : 1);
      add("ui", "ui", `UI ${k.key} ${v.key}`, {
        ...k, decay: k.decay * v.mul, freq: k.freq * pitch,
      }, ["ui", "interface", k.key.toLowerCase(), v.key.toLowerCase()]);
    }
  }

  // --- ambience
  const ambKinds = [
    { key: "Room Tone", cutoff: 900, lfoA: 0.07, lfoB: 0.11, depth: 0.10, space: 0.30 },
    { key: "Deep Drone", cutoff: 260, lfoA: 0.05, lfoB: 0.08, depth: 0.18, space: 0.55 },
    { key: "Air", cutoff: 4200, lfoA: 0.13, lfoB: 0.19, depth: 0.14, space: 0.42 },
    { key: "Rumble", cutoff: 140, lfoA: 0.04, lfoB: 0.06, depth: 0.22, space: 0.48 },
    { key: "Hiss", cutoff: 7800, lfoA: 0.21, lfoB: 0.29, depth: 0.09, space: 0.20 },
    { key: "Tension Bed", cutoff: 1800, lfoA: 0.09, lfoB: 0.15, depth: 0.26, space: 0.62 },
  ];
  const ambLengths = [
    { key: "Short", duration: 4 }, { key: "Loop", duration: 8 }, { key: "Long", duration: 15 },
  ];

  for (const k of ambKinds) {
    for (const len of ambLengths) {
      add("ambience", "ambience", `Ambience ${k.key} ${len.key}`, {
        ...k, duration: len.duration,
      }, ["ambience", "atmosphere", "bed", k.key.toLowerCase().replace(/\s+/g, "-")]);
    }
  }

  // --- glitch
  const glitchKinds = [
    { key: "Stutter", rate: 26, density: 0.35, bits: 12, duration: 0.6 },
    { key: "Data", rate: 64, density: 0.5, bits: 6, duration: 0.9 },
    { key: "Crush", rate: 14, density: 0.25, bits: 3, duration: 0.5 },
    { key: "Scan", rate: 40, density: 0.45, bits: 20, duration: 1.2 },
    { key: "Burst", rate: 90, density: 0.6, bits: 8, duration: 0.35 },
  ];
  for (const k of glitchKinds) {
    for (const v of ["Light", "Heavy"]) {
      addTakes("glitch", "glitch", `Glitch ${k.key} ${v}`, {
        ...k, density: v === "Heavy" ? k.density * 1.5 : k.density,
        bits: v === "Heavy" ? Math.max(2, k.bits / 2) : k.bits,
      }, ["glitch", "digital", "error", k.key.toLowerCase()], 2);
    }
  }

  // --- transitions: the whoosh-into-impact move, which is what most cuts want
  const transLengths = [
    { key: "Quick", duration: 0.7, hitPosition: 0.55 },
    { key: "Standard", duration: 1.2, hitPosition: 0.62 },
    { key: "Long", duration: 2.2, hitPosition: 0.70 },
  ];
  const transChars = [
    { key: "Whip", startFreq: 700, endFreq: 6800, tone: "white", resonance: 2.2, subStart: 90, subLevel: 0.8, space: 0.20 },
    { key: "Cinematic", startFreq: 300, endFreq: 4200, tone: "pink", resonance: 1.2, subStart: 70, subLevel: 1.1, space: 0.46 },
    { key: "Digital", startFreq: 1200, endFreq: 9000, tone: "white", resonance: 3.2, subStart: 120, subLevel: 0.5, space: 0.12 },
    { key: "Soft", startFreq: 400, endFreq: 3200, tone: "pink", resonance: 0.9, subStart: 100, subLevel: 0.6, space: 0.34 },
  ];

  for (const len of transLengths) {
    for (const ch of transChars) {
      addTakes("transition", "transition", `Transition ${ch.key} ${len.key}`, {
        ...len, ...ch,
      }, ["transition", "whoosh", "impact", ch.key.toLowerCase()], 3);
    }
  }

  // --- foley
  const foleyKinds = [
    { key: "Cloth", freq: 1800, sweep: -0.3, resonance: 0.8, attack: 0.02, decay: 14, drive: 1.2, space: 0.10, duration: 0.35 },
    { key: "Paper", freq: 3400, sweep: 0.2, resonance: 1.4, attack: 0.01, decay: 22, drive: 1.4, space: 0.08, duration: 0.28 },
    { key: "Footstep", freq: 620, sweep: -0.5, resonance: 1.1, attack: 0.005, decay: 26, drive: 1.8, space: 0.24, duration: 0.30 },
    { key: "Handling", freq: 1200, sweep: 0.1, resonance: 1.9, attack: 0.015, decay: 18, drive: 1.5, space: 0.14, duration: 0.40 },
    { key: "Switch", freq: 2600, sweep: -0.2, resonance: 2.6, attack: 0.004, decay: 40, drive: 2.0, space: 0.06, duration: 0.18 },
    { key: "Rustle", freq: 4200, sweep: 0.3, resonance: 0.7, attack: 0.03, decay: 9, drive: 1.1, space: 0.16, duration: 0.55 },
  ];
  for (const k of foleyKinds) {
    addTakes("foley", "foley", `Foley ${k.key}`, k,
      ["foley", "organic", k.key.toLowerCase()], 3);
  }

  return items;
}

let CATALOGUE = null;
function catalogue() {
  if (!CATALOGUE) CATALOGUE = buildCatalogue();
  return CATALOGUE;
}

/**
 * Render one catalogue entry to WAV bytes.
 * Seeded by name, so the same entry always produces the same file.
 */
function renderSFX(entry) {
  const rnd = mulberry32(seedFrom(entry.name));
  const mono = FAMILIES[entry.family](rnd, entry.params);
  return encodeWAV([mono], SR);
}

/**
 * Enumerate the SFX corpus. `content` is lazy so listing thousands of entries
 * does not synthesise thousands of buffers.
 */
function generateSFX({ limit = 0, families = null } = {}) {
  const out = [];

  for (const entry of catalogue()) {
    if (families && !families.includes(entry.family)) continue;
    out.push({
      name: entry.name,
      filename: entry.name.replace(/\s+/g, "_") + ".wav",
      type: "sfx",
      category: entry.subcategory,
      subcategory: entry.subcategory,
      family: entry.family,
      tags: entry.tags,
      duration: entry.params.duration,
      get content() { return renderSFX(entry); },
    });
    if (limit && out.length >= limit) break;
  }

  return out;
}

module.exports = {
  generateSFX,
  renderSFX,
  catalogue,
  FAMILIES,
  mulberry32,
  seedFrom,
  SR,
};
