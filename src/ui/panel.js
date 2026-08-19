"use strict";
/**
 * Asset Browser panel.
 *
 * Talks to the core through a small host bridge, never directly to the
 * filesystem, so the same panel runs under UXP, under CEP, and in a plain
 * browser against an exported index for design work.
 *
 * The grid is virtualised: at 10k+ assets, putting every cell in the DOM makes
 * scrolling unusable, so only the visible rows plus a small buffer exist.
 */

/* --------------------------------------------------------------- host bridge */

/**
 * Resolve a data source. In Premiere the host injects window.sunHost; in a
 * browser we fall back to a static index so the panel is previewable.
 */
const host = (() => {
  if (typeof window !== "undefined" && window.sunHost) return window.sunHost;

  let cache = null;
  const load = async () => {
    if (cache) return cache;
    const response = await fetch("./index-preview.json");
    cache = await response.json();
    return cache;
  };

  return {
    preview: true,
    async query(opts) {
      const doc = await load();
      return runQuery(doc.assets, opts);
    },
    async facets(opts) {
      const doc = await load();
      return computeFacets(runQuery(doc.assets, { ...opts, limit: 0 }).results);
    },
    async collections() {
      const doc = await load();
      return doc.collections || [];
    },
    async settings() {
      const doc = await load();
      return doc.settings || {};
    },
    async toggleFavorite(id) {
      const doc = await load();
      const asset = doc.assets.find((a) => a.id === id);
      if (asset) asset.favorite = !asset.favorite;
      return asset ? asset.favorite : false;
    },
    async insert() { return { ok: false, error: "not connected to Premiere Pro" }; },
    async command() { return { ok: false, error: "development tools need the host" }; },
    thumbUrl(asset) { return asset.thumbnail ? "/library/" + asset.thumbnail : null; },
  };
})();

/** Client-side query, mirroring core/db/database.js for the preview path. */
function runQuery(assets, opts = {}) {
  const {
    text, type, category, tags, favorite, developmentOnly, collection,
    sort = "name", limit = 0, offset = 0,
  } = opts;

  const terms = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
  const wantTags = tags && tags.length ? tags : null;

  let results = assets.filter((a) => {
    if (a.quarantined) return false;
    if (type && a.type !== type) return false;
    if (category && a.category !== category) return false;
    if (favorite !== undefined && a.favorite !== favorite) return false;
    if (developmentOnly !== undefined && a.developmentOnly !== developmentOnly) return false;
    if (collection && !(a.collections || []).includes(collection)) return false;
    if (wantTags && !wantTags.every((t) => (a.tags || []).includes(t))) return false;
    if (terms.length) {
      const hay = `${a.name} ${a.type} ${a.category} ${a.subcategory || ""} ${(a.tags || []).join(" ")}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
    added: (a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")),
    type: (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    size: (a, b) => (b.bytes || 0) - (a.bytes || 0),
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
    used: (a, b) => (b.useCount || 0) - (a.useCount || 0),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  }[sort] || ((a, b) => a.name.localeCompare(b.name));

  results.sort(cmp);
  const total = results.length;
  if (offset) results = results.slice(offset);
  if (limit) results = results.slice(0, limit);
  return { total, results };
}

function computeFacets(results) {
  const tally = (key) => {
    const map = new Map();
    for (const a of results) {
      const v = a[key];
      if (v == null) continue;
      map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((x, y) => y[1] - x[1]).map(([value, count]) => ({ value, count }));
  };
  const tags = new Map();
  for (const a of results) for (const t of a.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
  return {
    type: tally("type"),
    category: tally("category"),
    tags: [...tags.entries()].sort((x, y) => y[1] - x[1]).slice(0, 40)
      .map(([value, count]) => ({ value, count })),
  };
}

/* ------------------------------------------------------------------- state */

const TYPE_COLORS = {
  mogrt: "#ff9a28", sfx: "#56beff", music: "#9682ff", transition: "#ff765c",
  lut: "#78dca0", colorpreset: "#78dca0", preset: "#c8aa78", caption: "#f0c85a",
  overlay: "#ff82be", background: "#6eb4dc", effect: "#aaa0ff", guide: "#96a0af",
  template: "#bebec8", video: "#82c8e6", image: "#c8b48c",
};

const state = {
  view: "all",
  text: "",
  type: null,
  category: null,
  tags: [],
  collection: null,
  sort: "name",
  gridSize: "medium",
  selected: null,
  results: [],
  total: 0,
  settings: {},
};

const CELL_SIZES = {
  small: { w: 128, h: 106 },
  medium: { w: 168, h: 132 },
  large: { w: 232, h: 172 },
};

const el = (id) => document.getElementById(id);

/* ----------------------------------------------------------------- helpers */

function formatBytes(n) {
  if (!n) return "-";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDuration(s) {
  if (s == null) return null;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function currentQuery(extra = {}) {
  const q = {
    text: state.text || undefined,
    type: state.type || undefined,
    category: state.category || undefined,
    tags: state.tags.length ? state.tags : undefined,
    collection: state.collection || undefined,
    sort: state.sort,
    ...extra,
  };
  if (state.view === "favorites") q.favorite = true;
  if (state.view === "mine") q.developmentOnly = false;
  if (state.view === "development") q.developmentOnly = true;
  if (state.view === "recent") q.sort = "used";
  return q;
}

/* -------------------------------------------------------------- virtual grid */

const grid = {
  viewport: null,
  sizer: null,
  container: null,
  columns: 1,
  rendered: new Map(),

  init() {
    this.viewport = el("viewport");
    this.sizer = el("sizer");
    this.container = el("grid");
    this.viewport.addEventListener("scroll", () => this.render());
    window.addEventListener("resize", () => this.layout());
  },

  get cell() { return CELL_SIZES[state.gridSize] || CELL_SIZES.medium; },

  layout() {
    const preferred = this.cell;
    const gap = 10;
    const width = this.viewport.clientWidth - 24;

    // Treat the configured size as a MINIMUM and let cells share the leftover
    // width. Fixed-width cells leave a ragged gutter on the right at most panel
    // widths, which looks like a bug even though it is arithmetic.
    this.columns = Math.max(1, Math.floor((width + gap) / (preferred.w + gap)));
    const cellWidth = Math.floor((width - gap * (this.columns - 1)) / this.columns);
    // Thumbnail is 16:9; the body strip below it is a constant height.
    const bodyHeight = preferred.h - Math.round(preferred.w * 9 / 16);
    const cellHeight = Math.round(cellWidth * 9 / 16) + bodyHeight;

    this.cellWidth = cellWidth;
    this.cellHeight = cellHeight;

    const rows = Math.ceil(state.results.length / this.columns);
    this.sizer.style.height = `${rows * (cellHeight + gap)}px`;
    document.documentElement.style.setProperty("--cell-w", `${cellWidth}px`);

    this.rendered.clear();
    this.container.innerHTML = "";
    this.render();
  },

  /** Render only the visible window plus two rows of buffer. */
  render() {
    const gap = 10;
    const cellWidth = this.cellWidth || this.cell.w;
    const rowHeight = (this.cellHeight || this.cell.h) + gap;
    const scrollTop = this.viewport.scrollTop;
    const height = this.viewport.clientHeight;

    const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
    const lastRow = Math.ceil((scrollTop + height) / rowHeight) + 2;
    const start = firstRow * this.columns;
    const end = Math.min(state.results.length, lastRow * this.columns);

    const needed = new Set();
    for (let i = start; i < end; i++) needed.add(i);

    // Drop cells that scrolled out, keep the rest: rebuilding all of them on
    // every scroll frame is what makes naive grids stutter.
    for (const [index, node] of this.rendered) {
      if (!needed.has(index)) {
        node.remove();
        this.rendered.delete(index);
      }
    }

    for (const index of needed) {
      if (this.rendered.has(index)) continue;
      const asset = state.results[index];
      if (!asset) continue;
      const node = this.createCell(asset, index);
      const row = Math.floor(index / this.columns);
      const col = index % this.columns;
      node.style.width = `${cellWidth}px`;
      node.style.transform = `translate(${col * (cellWidth + gap)}px, ${row * rowHeight}px)`;
      this.container.appendChild(node);
      this.rendered.set(index, node);
    }
  },

  createCell(asset, index) {
    const node = document.createElement("div");
    const isTextCard = asset.type === "caption" || (asset.type === "preset" && asset.category === "text");
    node.className = "cell" + (state.selected === asset.id ? " is-selected" : "") + (isTextCard ? " cell-text-card" : "");
    node.dataset.id = asset.id;
    node.dataset.index = index;
    node.draggable = true;

    const color = TYPE_COLORS[asset.type] || "#8c8c96";
    const thumb = host.thumbUrl(asset);
    const duration = formatDuration(asset.duration);

    const badges = [];
    if (asset.syntheticFixture) badges.push('<em class="badge badge-fixture">FIXTURE</em>');
    else if (asset.developmentOnly) badges.push('<em class="badge badge-dev">DEV</em>');
    else badges.push('<em class="badge badge-mine">MINE</em>');

    node.innerHTML = `
      <div class="cell-thumb${thumb && !isTextCard ? "" : " is-missing"}">
        ${isTextCard 
          ? `<div class="cell-thumb-text">${escapeHtml(asset.name.replace(/Preset|Caption|Text/gi, '').trim())}</div>`
          : thumb 
            ? `<img loading="lazy" src="${escapeHtml(thumb)}" alt="">`
            : `<svg width="26" height="26" style="opacity:.3"><use href="#sunMark"/></svg>`}
        <div class="cell-flags">${badges.join("")}</div>
        ${asset.favorite ? '<div class="cell-fav">&#9733;</div>' : ""}
        ${duration ? `<div class="cell-duration">${duration}</div>` : ""}
      </div>
      <div class="cell-body">
        <div class="cell-name" title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</div>
        <div class="cell-sub">
          <span style="color:${color}">&#9679;</span>
          ${escapeHtml(asset.type)}${asset.subcategory ? " / " + escapeHtml(asset.subcategory) : ""}
        </div>
      </div>`;

    node.addEventListener("click", () => selectAsset(asset.id));
    node.addEventListener("dblclick", () => insertAsset(asset.id));
    node.addEventListener("dragstart", (e) => {
      if (asset.path) {
        e.dataTransfer.setData("com.adobe.cep.dnd.file.0", asset.path);
      }
    });
    return node;
  },
};

/* ---------------------------------------------------------------- rendering */

async function refresh() {
  const query = currentQuery({ limit: 0 });
  const result = await host.query(query);

  state.results = result.results;
  state.total = result.total;

  el("result-count").textContent =
    `${result.total.toLocaleString()} asset${result.total === 1 ? "" : "s"}`;
  el("empty").hidden = result.total > 0;
  if (result.total === 0) {
    el("empty-text").textContent = state.text
      ? `No assets match "${state.text}".`
      : "No assets yet.";
  }

  grid.layout();
  renderActiveFilters();
  await refreshFacets();
}

async function refreshFacets() {
  const q = currentQuery({ limit: 0 });
  delete q.type; delete q.category; delete q.text; // We want the full tree for the current view
  const allResults = await host.query(q);
  
  const tree = new Map();
  for (const a of allResults.results) {
    if (!a.type) continue;
    if (!tree.has(a.type)) tree.set(a.type, new Map());
    const cats = tree.get(a.type);
    const cat = a.category || "General";
    cats.set(cat, (cats.get(cat) || 0) + 1);
  }

  const container = document.getElementById("tree-view");
  if (container) {
    container.innerHTML = "";
    for (const [type, cats] of Array.from(tree.entries()).sort((a,b) => a[0].localeCompare(b[0]))) {
      const details = document.createElement("details");
      details.className = "tree-node";
      if (state.type === type || !state.type) details.open = true;
      
      const typeTotal = Array.from(cats.values()).reduce((sum, count) => sum + count, 0);
      
      details.innerHTML = `
        <summary class="tree-summary" onclick="event.preventDefault(); this.parentElement.open = !this.parentElement.open;">
          <span><span class="tree-icon">▶</span>${escapeHtml(type.toUpperCase())}</span>
          <span class="count">${typeTotal}</span>
        </summary>
        <div class="tree-children"></div>
      `;
      
      const children = details.querySelector(".tree-children");
      
      const allBtn = document.createElement("button");
      allBtn.className = "tree-item" + (state.type === type && !state.category ? " is-active" : "");
      allBtn.innerHTML = `<span>All</span><span class="count">${typeTotal}</span>`;
      allBtn.addEventListener("click", () => {
        state.type = type; state.category = null; refresh();
      });
      children.appendChild(allBtn);
      
      for (const [cat, count] of Array.from(cats.entries()).sort((a,b) => a[0].localeCompare(b[0]))) {
        const btn = document.createElement("button");
        btn.className = "tree-item" + (state.type === type && state.category === cat ? " is-active" : "");
        btn.innerHTML = `<span>${escapeHtml(cat)}</span><span class="count">${count}</span>`;
        btn.addEventListener("click", () => {
          state.type = type; state.category = cat; refresh();
        });
        children.appendChild(btn);
      }
      container.appendChild(details);
    }
  }

  const facets = await host.facets(currentQuery({ limit: 0 }));

  const tagBox = el("facet-tags");
  tagBox.innerHTML = "";
  for (const tag of (facets.tags || []).slice(0, 24)) {
    const button = document.createElement("button");
    button.className = "tag" + (state.tags.includes(tag.value) ? " is-active" : "");
    button.textContent = tag.value;
    button.addEventListener("click", () => {
      const i = state.tags.indexOf(tag.value);
      if (i >= 0) state.tags.splice(i, 1); else state.tags.push(tag.value);
      refresh();
    });
    tagBox.appendChild(button);
  }

  const collections = await host.collections();
  const collBox = el("facet-collections");
  collBox.innerHTML = collections.length
    ? ""
    : '<div style="font-size:11px;color:var(--text-faint);padding:4px 8px">None yet</div>';
  for (const c of collections) {
    const button = document.createElement("button");
    button.className = "facet-item" + (state.collection === c.name ? " is-active" : "");
    button.innerHTML = `<span class="facet-swatch"></span>
      <span class="facet-label">${escapeHtml(c.name)}</span>
      <span class="count">${c.count || 0}</span>`;
    button.addEventListener("click", () => {
      state.collection = state.collection === c.name ? null : c.name;
      refresh();
    });
    collBox.appendChild(button);
  }
}

function renderActiveFilters() {
  const box = el("active-filters");
  const chips = [];

  const chip = (label, clear) => {
    chips.push({ label, clear });
  };

  if (state.type) chip(`type: ${state.type}`, () => { state.type = null; });
  if (state.category) chip(`category: ${state.category}`, () => { state.category = null; });
  if (state.collection) chip(`collection: ${state.collection}`, () => { state.collection = null; });
  for (const tag of state.tags) {
    chip(`tag: ${tag}`, () => { state.tags = state.tags.filter((t) => t !== tag); });
  }

  box.hidden = chips.length === 0;
  box.innerHTML = "";
  for (const c of chips) {
    const node = document.createElement("span");
    node.className = "chip";
    node.innerHTML = `${escapeHtml(c.label)}<button title="Remove">&times;</button>`;
    node.querySelector("button").addEventListener("click", () => { c.clear(); refresh(); });
    box.appendChild(node);
  }
}

/* ------------------------------------------------------------------ detail */

async function selectAsset(id) {
  state.selected = id;
  const asset = state.results.find((a) => a.id === id);
  if (!asset) return;

  for (const [, node] of grid.rendered) {
    node.classList.toggle("is-selected", node.dataset.id === id);
  }

  const detail = el("detail");
  detail.hidden = false;

  const thumb = host.thumbUrl(asset);
  el("detail-preview").innerHTML = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="">`
    : `<svg width="40" height="40" style="opacity:.3"><use href="#sunMark"/></svg>`;

  el("detail-name").textContent = asset.name;

  const badges = [];
  if (asset.syntheticFixture) {
    badges.push('<em class="badge badge-fixture">FIXTURE - NOT FUNCTIONAL</em>');
  } else if (asset.developmentOnly) {
    badges.push('<em class="badge badge-dev">DEV LIBRARY</em>');
  } else {
    badges.push('<em class="badge badge-mine">MY LIBRARY</em>');
  }
  el("detail-badges").innerHTML = badges.join("");

  const rows = [
    ["Type", `${asset.type}${asset.category ? " / " + asset.category : ""}${asset.subcategory ? " / " + asset.subcategory : ""}`],
    ["Size", formatBytes(asset.bytes)],
    ["Duration", formatDuration(asset.duration) || null],
    ["Dimensions", asset.width && asset.height ? `${asset.width} x ${asset.height}` : null],
    ["Source", asset.source],
    ["Author", asset.author],
    ["License", asset.license],
    ["Added", asset.addedAt ? String(asset.addedAt).slice(0, 10) : null],
    ["Used", asset.useCount ? `${asset.useCount} times` : null],
    ["File", asset.file],
    ["Hash", asset.sha256 ? asset.sha256.slice(0, 16) + "..." : null],
  ].filter(([, v]) => v != null && v !== "");

  el("detail-meta").innerHTML = rows.map(([label, value]) => {
    const mono = label === "Hash" || label === "File";
    return `<div><dt>${label}</dt><dd class="${mono ? "mono" : ""}">${escapeHtml(value)}</dd></div>`;
  }).join("") + (asset.sourceUrl
    ? `<div><dt>Link</dt><dd><a href="${escapeHtml(asset.sourceUrl)}" target="_blank" rel="noopener">Open source page</a></dd></div>`
    : "");

  el("detail-tags").innerHTML = (asset.tags || [])
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");

  el("act-favorite").textContent = asset.favorite ? "Unfavourite" : "Favourite";
  el("act-insert").disabled = !asset.file;
  
  if (!document.getElementById("view-edit").hidden) {
    renderEditView();
  }
}

function renderEditView() {
  const asset = state.results.find((a) => a.id === state.selected);
  const empty = el("edit-empty");
  const content = el("edit-content");
  
  if (!asset) {
    empty.hidden = false;
    content.hidden = true;
    return;
  }
  
  empty.hidden = true;
  content.hidden = false;
  el("edit-title").textContent = asset.name;
  
  const form = el("edit-form");
  form.innerHTML = "";
  
  // Simulated parameter rendering based on MOGRT parameter structures
  const params = asset.parameters || [
    { name: "Primary Text", type: "text", value: asset.name },
    { name: "Secondary Text", type: "text", value: "Subtitle" },
    { name: "Scale", type: "slider", value: 100 },
    { name: "Color", type: "color", value: "#ffffff" }
  ];
  
  for (const param of params) {
    const group = document.createElement("div");
    group.className = "form-group";
    if (param.type === "color") {
       group.innerHTML = `<label>${escapeHtml(param.name)}</label>
                          <input type="color" class="form-control" style="height:40px;padding:4px;" value="${param.value}">`;
    } else if (param.type === "slider") {
       group.innerHTML = `<label>${escapeHtml(param.name)}</label>
                          <input type="range" class="form-control" min="0" max="200" value="${param.value}">`;
    } else {
       group.innerHTML = `<label>${escapeHtml(param.name)}</label>
                          <input type="text" class="form-control" value="${escapeHtml(param.value || '')}">`;
    }
    form.appendChild(group);
  }
}

async function insertAsset(id) {
  const result = await host.insert(id);
  setStatus(result && result.ok
    ? "Inserted at playhead"
    : `Could not insert: ${(result && result.error) || "unknown error"}`);
}

function setStatus(text) {
  el("status-text").textContent = text;
}

/* ------------------------------------------------------------------- wiring */

function wire() {
  let searchTimer = null;
  el("search").addEventListener("input", (e) => {
    state.text = e.target.value;
    el("search-clear").hidden = !state.text;
    clearTimeout(searchTimer);
    // Debounced: a keystroke per query makes a 10k-asset library feel laggy.
    searchTimer = setTimeout(refresh, 140);
  });

  el("search-clear").addEventListener("click", () => {
    el("search").value = "";
    state.text = "";
    el("search-clear").hidden = true;
    refresh();
  });

  for (const button of document.querySelectorAll(".quick-item")) {
    button.addEventListener("click", () => {
      for (const b of document.querySelectorAll(".quick-item")) b.classList.remove("is-active");
      button.classList.add("is-active");
      state.view = button.dataset.view;
      refresh();
    });
  }

  for (const button of document.querySelectorAll(".tab-btn")) {
    button.addEventListener("click", () => {
      for (const b of document.querySelectorAll(".tab-btn")) b.classList.remove("is-active");
      button.classList.add("is-active");
      const tab = button.dataset.tab;
      el("view-browse").hidden = tab !== "browse";
      el("view-edit").hidden = tab !== "edit";
      if (tab === "edit") {
        renderEditView();
      }
    });
  }

  const editInsert = el("btn-edit-insert");
  if (editInsert) {
    editInsert.addEventListener("click", () => {
      if (state.selected) insertAsset(state.selected);
    });
  }

  el("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    refresh();
  });

  for (const button of document.querySelectorAll("#grid-size button")) {
    button.addEventListener("click", () => {
      for (const b of document.querySelectorAll("#grid-size button")) b.classList.remove("is-active");
      button.classList.add("is-active");
      state.gridSize = button.dataset.size;
      grid.layout();
    });
  }

  el("detail-close").addEventListener("click", () => { el("detail").hidden = true; });

  el("act-favorite").addEventListener("click", async () => {
    if (!state.selected) return;
    await host.toggleFavorite(state.selected);
    await refresh();
    selectAsset(state.selected);
  });

  el("act-insert").addEventListener("click", () => {
    if (state.selected) insertAsset(state.selected);
  });

  el("act-replace").addEventListener("click", async () => {
    const result = await host.command("replace", { id: state.selected });
    setStatus(result && result.ok ? "Asset replaced" : "Replace needs the Premiere host");
  });

  el("btn-import").addEventListener("click", async () => {
    const result = await host.command("import");
    setStatus(result && result.ok ? `Imported ${result.imported} assets` : "Import needs the Premiere host");
    if (result && result.ok) refresh();
  });

  for (const button of document.querySelectorAll("[data-cmd]")) {
    button.addEventListener("click", async () => {
      const cmd = button.dataset.cmd;
      setStatus(`Running ${cmd}...`);
      const result = await host.command(cmd);
      setStatus(result && result.ok ? `${cmd} complete` : `${cmd}: ${(result && result.error) || "unavailable"}`);
      if (result && result.ok) refresh();
    });
  }
}

/* --------------------------------------------------------------------- init */

async function init() {
  grid.init();
  wire();

  state.settings = await host.settings();

  // The development tools appear only when the mode is on AND the module is
  // present. Either being false is a normal state, not an error.
  el("dev-tools").hidden = !state.settings.developmentAssetMode;

  const counts = await Promise.all([
    host.query({ limit: 0 }),
    host.query({ favorite: true, limit: 0 }),
    host.query({ developmentOnly: false, limit: 0 }),
    host.query({ developmentOnly: true, limit: 0 }),
  ]);

  el("count-all").textContent = counts[0].total.toLocaleString();
  el("count-fav").textContent = counts[1].total.toLocaleString();
  el("count-mine").textContent = counts[2].total.toLocaleString();
  el("count-dev").textContent = counts[3].total.toLocaleString();
  el("count-recent").textContent = counts[0].results.filter((a) => a.useCount > 0).length;

  el("status-lib").textContent = host.preview
    ? "preview mode - not connected to Premiere Pro"
    : "connected";

  await refresh();
  setStatus(`${state.total.toLocaleString()} assets indexed`);
}

document.addEventListener("DOMContentLoaded", init);
