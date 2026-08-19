import React, { useState, useEffect, useCallback, useRef } from 'react';

const VERSION = '0.5.0';
const host = window.sunHost || null;

/* ────────────────────── Inline SVG Icons (no external deps needed) ─── */
const Icon = ({ d, size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);

const Icons = {
  search:    (p) => <Icon {...p} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />,
  x:         (p) => <Icon {...p} d="M18 6L6 18M6 6l12 12" />,
  settings:  (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p.className||''}}><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  chevron:   (p) => <Icon {...p} d="M9 18l6-6-6-6" />,
  heart:     (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:p.filled?"currentColor":"none",stroke:"currentColor",strokeWidth:"2",className:p.className||''}}><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z"/></svg>,
  play:      (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"currentColor",stroke:"none",className:p.className||''}}><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  folder:    (p) => <Icon {...p} d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />,
  clock:     (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p.className||''}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  star:      (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:p.filled?"currentColor":"none",stroke:"currentColor",strokeWidth:"2",className:p.className||''}}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  film:      (p) => <Icon {...p} d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5M2 2h20v20H2z" />,
  music:     (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p.className||''}}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  download:  (p) => <Icon {...p} d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  grid:      (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p.className||''}}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  plus:      (p) => <Icon {...p} d="M12 5v14M5 12h14" />,
  layers:    (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p.className||''}}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>,
  type:      (p) => <Icon {...p} d="M4 7V4h16v3M9 20h6M12 4v16" />,
  wand:      (p) => <Icon {...p} d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9" />,
  palette:   (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",className:p.className||''}}><circle cx="13.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor"/><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor"/><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>,
  sparkle:   (p) => <svg {...{width:p.size||16,height:p.size||16,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",className:p.className||''}}><path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/></svg>,
};

/* ────────────────────── SUN Logo ─────────────────────────────────── */
const SunLogo = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <defs>
      <linearGradient id="sc" x1="0.22" y1="0.06" x2="0.82" y2="0.98">
        <stop offset="0" stopColor="#FFE07A"/><stop offset="0.42" stopColor="#FFB328"/><stop offset="1" stopColor="#F0641C"/>
      </linearGradient>
      <linearGradient id="sr" x1="0.5" y1="1" x2="0.5" y2="0">
        <stop offset="0" stopColor="#FFB733"/><stop offset="1" stopColor="#FF8A1E"/>
      </linearGradient>
    </defs>
    <g transform="translate(32 32)">
      <g fill="url(#sr)">
        {[0,60,120,180,240,300].map(r=><path key={r} d="M-2.5-18.6L-1.05-28.4Q0-29.9 1.05-28.4L2.5-18.6Z" transform={`rotate(${r})`}/>)}
        <g opacity=".85">{[30,90,150,210,270,330].map(r=><path key={r} d="M-1.9-18.6L-0.85-24.6Q0-25.8 0.85-24.6L1.9-18.6Z" transform={`rotate(${r})`}/>)}</g>
      </g>
      <circle r="15" fill="url(#sc)"/>
      <path d="M-10.4-6.2A12.1 12.1 0 016.2-10.4A15 15 0 00-10.4-6.2Z" fill="#FFF3C4" opacity=".45"/>
    </g>
  </svg>
);

/* ────────────────────── Helpers ──────────────────────────────────── */
function cn(...args) { return args.filter(Boolean).join(' '); }

const typeIconMap = { mogrt: 'film', transition: 'sparkle', caption: 'type', preset: 'wand', sfx: 'music', music: 'music', lut: 'palette', overlay: 'layers', effect: 'sparkle' };

function TypeIcon({ type, size = 14, className = '' }) {
  const key = typeIconMap[type] || 'folder';
  const Fn = Icons[key] || Icons.folder;
  return <Fn size={size} className={className} />;
}

/* ────────────────────── MAIN APP ─────────────────────────────────── */
export default function App() {
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [activeView, setActiveView] = useState('all');
  const [typeFilter, setTypeFilter] = useState(null);
  const [catFilter, setCatFilter] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [facetTree, setFacetTree] = useState(new Map());
  const [stats, setStats] = useState({ all: 0, fav: 0, recent: 0 });
  const [status, setStatus] = useState('Ready');
  const [sortBy, setSortBy] = useState('name');
  const [draggingId, setDraggingId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [collections, setCollections] = useState([]);
  const [editingCollection, setEditingCollection] = useState(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [activeTab, setActiveTab] = useState('browse'); // 'browse' | 'edit'
  const [mogrtParams, setMogrtParams] = useState(null);
  const [mogrtError, setMogrtError] = useState(null);
  const searchRef = useRef(null);
  const ghostRef = useRef(null);

  /* ── Data fetching ─────────────────────────────────────────────── */
  const fetchAssets = useCallback(async () => {
    if (!host) return;
    try {
      const q = { limit: 0, text: search || undefined };
      if (typeFilter) q.type = typeFilter;
      if (catFilter) q.category = catFilter;
      if (activeView === 'favorites') q.favorite = true;
      if (activeView.startsWith('collection:')) {
          q.collection = activeView.replace('collection:', '');
      }

      const res = await host.query(q);
      let items = res.results || [];

      if (host.collections) {
          const colls = await host.collections();
          setCollections(colls || []);
      }

      // Sort
      items.sort((a, b) => {
        if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
        if (sortBy === 'type') return (a.type || '').localeCompare(b.type || '');
        if (sortBy === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
        return 0;
      });

      setAssets(items);
      setTotal(res.total || 0);

      // Build facet tree from ALL results (unfiltered)
      const allRes = await host.query({ limit: 0 });
      const tree = new Map();
      for (const a of (allRes.results || [])) {
        if (!a.type) continue;
        if (!tree.has(a.type)) tree.set(a.type, new Map());
        const cat = a.category || 'General';
        const cats = tree.get(a.type);
        cats.set(cat, (cats.get(cat) || 0) + 1);
      }
      setFacetTree(tree);

      // Stats
      setStats({
        all: allRes.total || 0,
        fav: ((await host.query({ favorite: true, limit: 0 })) || {}).total || 0,
        recent: 0,
      });
    } catch (e) {
      console.error('[SUN] fetch error:', e);
    }
  }, [search, typeFilter, catFilter, activeView, sortBy]);

  useEffect(() => {
    const t = setTimeout(fetchAssets, 120);
    return () => clearTimeout(t);
  }, [fetchAssets]);

  /* ── Drag & Drop ───────────────────────────────────────────────── */
  const handleDragStart = useCallback((e, asset) => {
    setDraggingId(asset.id);

    // Set the file path for Premiere Pro's native drop handler
    let absPath = null;
    if (host && host.toAbsolute && asset.file) {
      absPath = host.toAbsolute(asset.file);
    }
    if (absPath) {
      e.dataTransfer.setData('com.adobe.cep.dnd.file.0', absPath);
      e.dataTransfer.effectAllowed = 'copy';
    }

    setStatus(`Dragging: ${asset.name}`);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setStatus('Ready');
  }, []);

  /* ── Insert ────────────────────────────────────────────────────── */
  const handleInsert = useCallback(async (id) => {
    if (!host) return;
    setStatus('Inserting...');
    const result = await host.insert(id);
    if (result && result.ok) {
      setStatus('Inserted successfully');
    } else {
      setStatus(result?.error || 'Insert failed');
    }
    setTimeout(() => setStatus('Ready'), 3000);
  }, []);

  /* ── Favourite ─────────────────────────────────────────────────── */
  const handleFav = useCallback(async (id) => {
    if (!host || !host.toggleFavorite) return;
    await host.toggleFavorite(id);
    fetchAssets();
  }, [fetchAssets]);

  /* ── Import ────────────────────────────────────────────────────── */
  const handleImport = useCallback(async () => {
    if (!host) return;
    setStatus('Selecting files...');
    let opts = {};
    if (activeView.startsWith('collection:')) {
        opts.collection = activeView.replace('collection:', '');
    }
    const r = await host.command('import-dialog', opts);
    if (r?.ok) {
        setStatus(`Imported ${r.imported || 0} assets`);
        fetchAssets();
    } else {
        setStatus(r?.error || 'Import cancelled or failed');
    }
    setTimeout(() => setStatus('Ready'), 3000);
  }, [fetchAssets, activeView]);

  const handleTemplateImport = useCallback(async () => {
    if (!host) return;
    setStatus('Waiting for file...');
    const r = await host.command('import-dialog');
    if (r?.ok) {
        setStatus(`Template imported!`);
        setShowTemplateModal(false);
        fetchAssets();
    } else {
        setStatus(r?.error || 'Import cancelled');
    }
    setTimeout(() => setStatus('Ready'), 3000);
  }, [fetchAssets]);

  /* ── Sidebar click ─────────────────────────────────────────────── */
  const setView = (view) => {
    setActiveView(view);
    setTypeFilter(null);
    setCatFilter(null);
  };

  const setTypeAndCat = (type, cat) => {
    setActiveView('all');
    setTypeFilter(type);
    setCatFilter(cat || null);
  };

  /* ── Collections API ────────────────────────────────────────────── */
  const handleCreateCollection = async (name) => {
      if (!name || !host || !host.createCollection) return;
      await host.createCollection(name);
      setEditingCollection(null);
      setNewCollectionName('');
      fetchAssets();
  };
  const handleDeleteCollection = async (name) => {
      if (!host || !host.deleteCollection || !confirm(`Delete folder "${name}"? Assets will not be deleted.`)) return;
      await host.deleteCollection(name);
      if (activeView === `collection:${name}`) setView('all');
      fetchAssets();
  };
  const handleRenameCollection = async (oldName, newName) => {
      if (!newName || !host || !host.renameCollection) return;
      await host.renameCollection(oldName, newName);
      if (activeView === `collection:${oldName}`) setView(`collection:${newName}`);
      setEditingCollection(null);
      fetchAssets();
  };

  /* ── MOGRT Editing ──────────────────────────────────────────────── */
  const fetchMogrtParams = useCallback(async () => {
      if (!host || !host.getMogrtParams) return;
      setStatus('Loading clip parameters...');
      setMogrtError(null);
      const res = await host.getMogrtParams();
      if (res && res.ok && res.params) {
          setMogrtParams(res.params);
          setStatus('Clip loaded');
      } else {
          setMogrtParams(null);
          setMogrtError(res?.error || 'Failed to load clip parameters');
          setStatus('Ready');
      }
  }, []);

  const updateMogrtParam = useCallback(async (index, value) => {
      if (!host || !host.updateMogrtParam) return;
      
      // Optimistic update in UI
      setMogrtParams(prev => {
          if (!prev) return prev;
          const next = [...prev];
          next[index] = { ...next[index], value };
          return next;
      });

      const res = await host.updateMogrtParam(index, value);
      if (!res?.ok) {
          console.error('Failed to update parameter', res?.error);
      }
  }, []);

  // Helper to convert array [R,G,B,A] to hex for input type="color"
  const rgbaToHex = (arr) => {
      if (!Array.isArray(arr) || arr.length < 3) return '#000000';
      const r = Math.round(arr[0]).toString(16).padStart(2, '0');
      const g = Math.round(arr[1]).toString(16).padStart(2, '0');
      const b = Math.round(arr[2]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
  };
  const hexToRgba = (hex) => {
      const h = hex.replace('#', '');
      return [
          parseInt(h.substring(0,2), 16),
          parseInt(h.substring(2,4), 16),
          parseInt(h.substring(4,6), 16),
          255
      ];
  };

  /* ── Thumbnail helper ──────────────────────────────────────────── */
  const getThumb = (asset) => {
    if (host && host.thumbUrl) return host.thumbUrl(asset);
    return null;
  };

  /* ════════════════════════ RENDER ═══════════════════════════════ */
  return (
    <div className="h-full w-full flex flex-col bg-[#0a0a0b] text-zinc-200 text-[13px] overflow-hidden select-none">
      {/* Drag ghost element */}
      <div ref={ghostRef} className="drag-ghost" aria-hidden="true" />

      {/* ─── TOP BAR ──────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-3 py-2 bg-[#0f0f11] border-b border-zinc-800/60 shrink-0">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <SunLogo size={22} />
          <span className="font-bold text-[14px] tracking-tight bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            SUN Plugin
          </span>
          <span className="text-[10px] text-zinc-500 font-medium">v{VERSION}</span>
        </div>

        {/* Search */}
        <div className="flex-1 max-w-xs relative mx-2">
          <Icons.search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search assets..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 bg-zinc-900 border border-zinc-800 rounded-2xl text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors">
              <Icons.x size={13} />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex bg-zinc-900 rounded-xl p-0.5 border border-zinc-800/80 mr-4">
              <button onClick={() => setActiveTab('browse')} className={cn('px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all', activeTab === 'browse' ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300')}>Browse</button>
              <button onClick={() => { setActiveTab('edit'); fetchMogrtParams(); }} className={cn('px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all', activeTab === 'edit' ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300')}>Edit</button>
          </div>
          <button onClick={() => setShowTemplateModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-200 font-semibold rounded-2xl text-[12px] hover:bg-zinc-700 active:scale-[0.97] transition-all border border-zinc-700">
            <Icons.wand size={13} /> Create Template
          </button>
          <button onClick={handleImport} className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-600 text-black font-semibold rounded-2xl text-[12px] hover:brightness-110 active:scale-[0.97] transition-all">
            <Icons.download size={13} /> Import
          </button>
          <button onClick={() => setShowSettings(true)} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-xl transition-all">
            <Icons.settings size={15} />
          </button>
        </div>
      </header>

      {/* ─── MAIN AREA ────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ─── SIDEBAR ──────────────────────────────────────── */}
        <aside className="w-48 bg-[#0d0d0f] border-r border-zinc-800/40 flex flex-col overflow-y-auto shrink-0">
          {/* Quick links */}
          <div className="p-2.5 flex flex-col gap-0.5">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold px-2 mb-1">Library</p>
            {[
              { key: 'all',       label: 'All Assets',  icon: Icons.layers,  count: stats.all },
              { key: 'favorites', label: 'Favourites',  icon: (p) => <Icons.heart {...p} filled={false} />, count: stats.fav },
            ].map(item => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-xl text-left transition-all group',
                  activeView === item.key && !typeFilter
                    ? 'bg-zinc-800/80 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                )}
              >
                <item.icon size={14} className={cn(activeView === item.key && !typeFilter ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-400')} />
                <span className="flex-1 truncate text-[12px]">{item.label}</span>
                <span className="text-[10px] text-zinc-600 tabular-nums">{item.count}</span>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="mx-3 border-t border-zinc-800/40" />

          {/* User Folders */}
          <div className="p-2.5 flex flex-col gap-0.5">
            <div className="flex items-center justify-between px-2 mb-1 group">
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">My Folders</p>
                <button onClick={() => setEditingCollection('NEW')} className="text-zinc-500 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100">
                    <Icons.plus size={12} />
                </button>
            </div>
            {editingCollection === 'NEW' && (
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-zinc-800/40">
                    <Icons.folder size={14} className="text-amber-500/50" />
                    <input autoFocus type="text" value={newCollectionName} onChange={e => setNewCollectionName(e.target.value)} onKeyDown={e => { if(e.key==='Enter') handleCreateCollection(newCollectionName); else if(e.key==='Escape') setEditingCollection(null); }} onBlur={() => handleCreateCollection(newCollectionName)} className="flex-1 bg-transparent text-[12px] text-zinc-200 outline-none" placeholder="Folder Name..." />
                </div>
            )}
            {collections.map(col => {
                const isActive = activeView === `collection:${col.name}`;
                const isEditing = editingCollection === col.name;
                return (
                  <div key={col.name} className={cn('group flex items-center justify-between px-2 py-1.5 rounded-xl transition-all', isActive ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40')}>
                      {isEditing ? (
                          <div className="flex items-center gap-2 flex-1">
                              <Icons.folder size={14} className="text-amber-400" />
                              <input autoFocus type="text" defaultValue={col.name} onKeyDown={e => { if(e.key==='Enter') handleRenameCollection(col.name, e.target.value); else if(e.key==='Escape') setEditingCollection(null); }} onBlur={e => handleRenameCollection(col.name, e.target.value)} className="flex-1 bg-transparent text-[12px] text-zinc-200 outline-none" />
                          </div>
                      ) : (
                          <>
                              <button onClick={() => setView(`collection:${col.name}`)} className="flex items-center gap-2 flex-1 text-left">
                                  <Icons.folder size={14} className={isActive ? 'text-amber-400' : 'text-zinc-500 group-hover:text-amber-400/50'} />
                                  <span className="flex-1 truncate text-[12px]">{col.name}</span>
                                  <span className="text-[10px] text-zinc-600 tabular-nums">{col.count}</span>
                              </button>
                              <div className="hidden group-hover:flex items-center gap-1 ml-1 shrink-0">
                                  <button onClick={(e) => { e.stopPropagation(); setEditingCollection(col.name); }} className="text-zinc-500 hover:text-zinc-300 p-0.5"><Icons.wand size={10} /></button>
                                  <button onClick={(e) => { e.stopPropagation(); handleDeleteCollection(col.name); }} className="text-zinc-500 hover:text-rose-400 p-0.5"><Icons.x size={10} /></button>
                              </div>
                          </>
                      )}
                  </div>
                );
            })}
          </div>

          {/* Divider */}
          <div className="mx-3 border-t border-zinc-800/40" />

          {/* Category tree */}
          <div className="p-2.5 flex flex-col gap-0.5 flex-1">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold px-2 mb-1">Categories</p>
            {Array.from(facetTree.entries()).map(([type, cats]) => {
              const typeTotal = Array.from(cats.values()).reduce((a, b) => a + b, 0);
              const isActive = typeFilter === type;
              return (
                <details key={type} open={isActive} className="group">
                  <summary
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-xl cursor-pointer transition-all',
                      isActive ? 'bg-zinc-800/60 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
                    )}
                    onClick={(e) => { e.preventDefault(); setTypeAndCat(isActive && !catFilter ? null : type, null); }}
                  >
                    <Icons.chevron size={10} className="tree-chevron text-zinc-600 shrink-0" />
                    <TypeIcon type={type} size={13} className={cn(isActive ? 'text-amber-400' : 'text-zinc-500')} />
                    <span className="flex-1 truncate text-[12px] capitalize">{type}</span>
                    <span className="text-[10px] text-zinc-600 tabular-nums">{typeTotal}</span>
                  </summary>
                  <div className="ml-5 pl-2.5 border-l border-zinc-800/30 flex flex-col gap-0.5 mt-0.5 mb-1 animate-fade-in">
                    {Array.from(cats.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([cat, count]) => (
                      <button
                        key={cat}
                        onClick={() => setTypeAndCat(type, cat)}
                        className={cn(
                          'flex items-center justify-between px-2 py-1 rounded-lg text-[11px] transition-all text-left',
                          typeFilter === type && catFilter === cat
                            ? 'bg-zinc-800/60 text-zinc-100 font-medium'
                            : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
                        )}
                      >
                        <span className="truncate capitalize">{cat}</span>
                        <span className="text-[10px] text-zinc-600 tabular-nums ml-2">{count}</span>
                      </button>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </aside>

        {/* ─── CONTENT ──────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0b] relative">
          
          {activeTab === 'edit' && (
              <div className="absolute inset-0 z-10 bg-[#0a0a0b] flex flex-col animate-fade-in overflow-y-auto">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/50 sticky top-0 bg-[#0a0a0b]/90 backdrop-blur-md z-20">
                      <h2 className="text-[16px] font-bold text-zinc-100 flex items-center gap-2">
                          <Icons.wand size={18} className="text-amber-500" />
                          Edit Active Clip
                      </h2>
                      <button onClick={fetchMogrtParams} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-[12px] font-medium transition-all">
                          Refresh Selected
                      </button>
                  </div>
                  
                  <div className="p-6 max-w-3xl w-full mx-auto flex flex-col gap-6">
                      {mogrtError && (
                          <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                              <Icons.film size={48} className="text-zinc-700" />
                              <p className="text-[14px] text-zinc-400 font-medium">{mogrtError}</p>
                              <p className="text-[12px] text-zinc-600 max-w-xs">Select a Motion Graphics Template on your Premiere Pro timeline, then click Refresh.</p>
                          </div>
                      )}

                      {mogrtParams && mogrtParams.length === 0 && !mogrtError && (
                          <p className="text-zinc-500 italic">This clip has no editable parameters.</p>
                      )}

                      {mogrtParams && mogrtParams.length > 0 && (
                          <div className="flex flex-col gap-5">
                              {mogrtParams.map((p, i) => (
                                  <div key={p.index} className="flex flex-col gap-1.5 border-b border-zinc-800/30 pb-4 last:border-0">
                                      <label className="text-[12px] font-semibold text-zinc-400 uppercase tracking-wider">{p.name}</label>
                                      
                                      {p.type === 'text' && (
                                          <input 
                                              type="text" 
                                              value={p.value} 
                                              onChange={(e) => updateMogrtParam(i, e.target.value)}
                                              className="bg-[#121214] border border-zinc-800 rounded-xl px-3 py-2 text-[13px] text-zinc-200 focus:outline-none focus:border-amber-500/40 w-full shadow-inner"
                                          />
                                      )}
                                      
                                      {p.type === 'color' && (
                                          <div className="flex items-center gap-3">
                                              <input 
                                                  type="color" 
                                                  value={rgbaToHex(p.value)} 
                                                  onChange={(e) => updateMogrtParam(i, hexToRgba(e.target.value))}
                                                  className="w-10 h-10 bg-[#121214] border border-zinc-800 rounded-xl cursor-pointer p-0.5 shrink-0"
                                              />
                                              <span className="text-[12px] text-zinc-500 font-mono uppercase">{rgbaToHex(p.value)}</span>
                                          </div>
                                      )}

                                      {p.type === 'checkbox' && (
                                          <label className="flex items-center gap-3 cursor-pointer">
                                              <input 
                                                  type="checkbox" 
                                                  checked={p.value === true || p.value === 'true' || p.value === 1}
                                                  onChange={(e) => updateMogrtParam(i, e.target.checked)}
                                                  className="accent-amber-500 w-4 h-4 cursor-pointer"
                                              />
                                              <span className="text-[13px] text-zinc-300">Enable</span>
                                          </label>
                                      )}

                                      {p.type === 'slider' && (
                                          <div className="flex items-center gap-3">
                                              <input 
                                                  type="range" 
                                                  value={p.value || 0}
                                                  min={0}
                                                  max={p.value > 100 ? p.value * 2 : 100}
                                                  onChange={(e) => updateMogrtParam(i, parseFloat(e.target.value))}
                                                  className="flex-1 accent-amber-500"
                                              />
                                              <input 
                                                  type="number"
                                                  value={p.value || 0}
                                                  onChange={(e) => updateMogrtParam(i, parseFloat(e.target.value))}
                                                  className="w-20 bg-[#121214] border border-zinc-800 rounded-lg px-2 py-1.5 text-[12px] text-zinc-200 focus:outline-none focus:border-amber-500/40 tabular-nums"
                                              />
                                          </div>
                                      )}
                                      
                                      {p.type === 'unknown' && (
                                          <span className="text-[11px] text-zinc-600 bg-zinc-900 px-2 py-1 rounded-md inline-block w-fit">
                                              Unsupported parameter type. Edit in Premiere Pro Properties panel.
                                          </span>
                                      )}
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/30 shrink-0">
            <span className="text-[12px] text-zinc-500">
              <span className="text-zinc-300 font-semibold">{assets.length}</span> assets
              {activeView.startsWith('collection:') && <span className="text-zinc-600"> in folder <span className="text-amber-500/70 capitalize">{activeView.replace('collection:', '')}</span></span>}
              {typeFilter && <span className="text-zinc-600"> in <span className="text-amber-500/70 capitalize">{typeFilter}</span></span>}
              {catFilter && <span className="text-zinc-600"> / <span className="text-amber-500/70 capitalize">{catFilter}</span></span>}
            </span>
            <div className="flex items-center gap-2">
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1 text-[11px] text-zinc-400 focus:outline-none cursor-pointer"
              >
                <option value="name">Name</option>
                <option value="type">Type</option>
                <option value="added">Date added</option>
              </select>
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-3">
            {assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-4">
                <SunLogo size={48} />
                <p className="text-[13px]">No assets found</p>
                <p className="text-[11px] text-zinc-700 max-w-[240px] text-center">
                  Import your assets or turn on Development Asset Mode to generate a test library.
                </p>
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                {assets.map(asset => {
                  const thumb = getThumb(asset);
                  const isSel = selected && selected.id === asset.id;
                  const isCaption = asset.type === 'caption' || (asset.type === 'preset' && asset.category === 'text');

                  return (
                    <div
                      key={asset.id}
                      draggable
                      onDragStart={e => handleDragStart(e, asset)}
                      onDragEnd={handleDragEnd}
                      onClick={() => { setSelected(asset); setShowDetail(true); }}
                      onDoubleClick={() => handleInsert(asset.id)}
                      className={cn(
                        'group flex flex-col rounded-2xl overflow-hidden cursor-pointer transition-all duration-200',
                        'bg-zinc-900/80 border hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20 hover:scale-[1.02]',
                        isSel ? 'card-selected border-amber-500/50' : 'border-zinc-800/50',
                        draggingId === asset.id && 'opacity-50 scale-95',
                        isCaption && 'col-span-2',
                        'animate-fade-in'
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative w-full aspect-video bg-zinc-950 flex items-center justify-center overflow-hidden">
                        {thumb ? (
                          <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                        ) : isCaption ? (
                          <div className="flex items-center justify-center p-3 text-center">
                            <span className="text-zinc-300 font-bold text-[14px] tracking-tight leading-snug uppercase">
                              {asset.name.replace(/Preset|Caption|Text|Captions|SRT|VTT/gi, '').trim() || asset.name}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5">
                            <TypeIcon type={asset.type} size={24} className="text-zinc-700" />
                          </div>
                        )}

                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center gap-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleInsert(asset.id); }}
                            className="w-9 h-9 flex items-center justify-center bg-amber-500 rounded-full text-black hover:bg-amber-400 transition-all hover:scale-110 active:scale-95"
                          >
                            <Icons.plus size={16} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFav(asset.id); }}
                            className="w-8 h-8 flex items-center justify-center bg-zinc-800 rounded-full text-zinc-300 hover:text-rose-400 hover:bg-zinc-700 transition-all hover:scale-110"
                          >
                            <Icons.heart size={14} filled={asset.favorite} />
                          </button>
                        </div>

                        {/* Type badge */}
                        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="px-1.5 py-0.5 bg-black/60 backdrop-blur-sm rounded-lg text-[9px] text-zinc-300 uppercase font-semibold tracking-wider">
                            {asset.type}
                          </span>
                        </div>
                      </div>

                      {/* Info */}
                      <div className="px-3 py-2.5 flex flex-col gap-0.5">
                        <span className="text-[12px] font-medium text-zinc-200 truncate">{asset.name}</span>
                        <span className="text-[10px] text-zinc-600 truncate capitalize">{asset.category || asset.type}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ─── DETAIL PANEL ─────────────────────────────────── */}
        {showDetail && selected && (
          <aside className="w-64 bg-[#0d0d0f] border-l border-zinc-800/40 flex flex-col overflow-y-auto shrink-0 animate-fade-in">
            {/* Close */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/30">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Details</span>
              <button onClick={() => setShowDetail(false)} className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded-lg hover:bg-zinc-800 transition-all">
                <Icons.x size={14} />
              </button>
            </div>

            {/* Preview */}
            <div className="p-3">
              <div className="w-full aspect-video bg-zinc-950 rounded-2xl overflow-hidden flex items-center justify-center border border-zinc-800/30">
                {getThumb(selected) ? (
                  <img src={getThumb(selected)} alt="" className="w-full h-full object-contain" />
                ) : (
                  <TypeIcon type={selected.type} size={32} className="text-zinc-700" />
                )}
              </div>
            </div>

            {/* Name & Info */}
            <div className="px-3 pb-3 flex flex-col gap-2">
              <h3 className="text-[14px] font-bold text-zinc-100 leading-tight">{selected.name}</h3>
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 bg-zinc-800 rounded-xl text-[10px] text-zinc-400 capitalize">{selected.type}</span>
                <span className="px-2 py-0.5 bg-zinc-800 rounded-xl text-[10px] text-zinc-400 capitalize">{selected.category}</span>
                {selected.favorite && <span className="px-2 py-0.5 bg-rose-900/30 rounded-xl text-[10px] text-rose-400">♥ Favourite</span>}
              </div>
            </div>

            {/* Actions */}
            <div className="px-3 pb-4 flex flex-col gap-2">
              <button
                onClick={() => handleInsert(selected.id)}
                className="w-full py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-black font-semibold rounded-2xl text-[12px] hover:brightness-110 active:scale-[0.98] transition-all"
              >
                Import to Timeline
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => handleFav(selected.id)}
                  className="flex-1 py-1.5 bg-zinc-800 text-zinc-300 rounded-2xl text-[11px] hover:bg-zinc-700 transition-all flex items-center justify-center gap-1.5"
                >
                  <Icons.heart size={12} filled={selected.favorite} className={selected.favorite ? 'text-rose-400' : ''} />
                  {selected.favorite ? 'Unfavourite' : 'Favourite'}
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-3 border-t border-zinc-800/30" />

            {/* Quick Edit Hint */}
            <div className="p-4 flex flex-col gap-2 bg-amber-500/5 m-3 rounded-xl border border-amber-500/10">
                <p className="text-[11px] text-amber-500/80 font-semibold flex items-center gap-1.5 uppercase tracking-wide">
                    <Icons.wand size={12} /> Live Edit
                </p>
                <p className="text-[11px] text-zinc-400">
                    After inserting this template, switch to the <strong>Edit</strong> tab at the top of the plugin to customize its colors, text, and settings natively.
                </p>
            </div>

            {/* Tags */}
            {selected.tags && selected.tags.length > 0 && (
              <>
                <div className="mx-3 border-t border-zinc-800/30" />
                <div className="p-3 flex flex-col gap-2">
                  <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-semibold">Tags</p>
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.slice(0, 12).map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-zinc-900 border border-zinc-800/50 rounded-xl text-[10px] text-zinc-500">{tag}</span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {/* ─── STATUS BAR ───────────────────────────────────────── */}
      <footer className="flex items-center justify-between px-3 py-1 bg-[#0a0a0b] border-t border-zinc-800/30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] text-zinc-500">{status}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-600">
          <span>{total} total</span>
          <span className="text-zinc-800">|</span>
          <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent font-semibold">
            SUN Plugin v{VERSION}
          </span>
        </div>
      </footer>

      {/* ─── SETTINGS MODAL ───────────────────────────────────── */}
      {showSettings && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#121214] border border-zinc-800/80 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
              <span className="font-bold text-[14px] text-zinc-100">Settings</span>
              <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-zinc-300">
                <Icons.x size={16} />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4 text-[12px]">
              <div className="flex flex-col gap-1.5">
                <label className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Library Root Folder</label>
                <div className="flex items-center gap-2">
                  <input readOnly value="Documents/Sun Plugin/Library" className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-300 focus:outline-none" />
                  <button className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-all">Change</button>
                </div>
              </div>
              
              <div className="flex flex-col gap-1.5 mt-2">
                <label className="text-zinc-400 font-semibold uppercase tracking-wider text-[10px]">Preferences</label>
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input type="checkbox" defaultChecked className="accent-amber-500 w-3 h-3" />
                  Show tooltips on hover
                </label>
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input type="checkbox" defaultChecked className="accent-amber-500 w-3 h-3" />
                  Auto-scan library on startup
                </label>
              </div>

              <div className="mt-4 pt-4 border-t border-zinc-800/50 flex flex-col items-center gap-2">
                <SunLogo size={32} />
                <span className="text-[11px] text-zinc-500">SUN Plugin v{VERSION}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── CREATE TEMPLATE MODAL ─────────────────────────────── */}
      {showTemplateModal && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#121214] border border-zinc-800/80 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50">
              <span className="font-bold text-[14px] text-zinc-100 flex items-center gap-2"><Icons.wand size={16} className="text-amber-500" /> Create Template</span>
              <button onClick={() => setShowTemplateModal(false)} className="text-zinc-500 hover:text-zinc-300">
                <Icons.x size={16} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4 text-[13px] text-zinc-300 overflow-y-auto max-h-[70vh]">
              <p>Adobe Premiere Pro scripts cannot automatically export timeline elements. To create a template, export it natively first:</p>
              
              <div className="flex flex-col gap-3 bg-zinc-900/50 p-4 rounded-xl border border-zinc-800/50">
                
                <div>
                  <h4 className="text-amber-500 font-bold text-[12px] uppercase tracking-wider mb-1">To Export an Effect Preset (.prfpset)</h4>
                  <ol className="list-decimal list-outside ml-4 space-y-1 text-zinc-400">
                    <li>In the <strong>Effect Controls</strong> panel, select the effect(s) you want to save.</li>
                    <li>Right-click and choose <strong>Save Preset...</strong></li>
                    <li>Go to your <strong>Effects</strong> panel, find your new preset under <i>Presets</i>.</li>
                    <li>Right-click it and choose <strong>Export Presets...</strong> to save the file.</li>
                  </ol>
                </div>

                <div className="border-t border-zinc-800/50 pt-3">
                  <h4 className="text-amber-500 font-bold text-[12px] uppercase tracking-wider mb-1">To Export a Graphic/Text (.mogrt)</h4>
                  <ol className="list-decimal list-outside ml-4 space-y-1 text-zinc-400">
                    <li>Select your graphic or text clip in the timeline.</li>
                    <li>In the top menu, go to <strong>Graphics and Titles</strong> &gt; <strong>Export As Motion Graphics Template...</strong></li>
                    <li>Save the file to your computer.</li>
                  </ol>
                </div>

              </div>

              <div className="flex items-center gap-3 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                <Icons.download size={20} className="text-amber-500 shrink-0" />
                <p className="text-zinc-300 text-[12px]">Finally, click <strong>Browse & Ingest File</strong> below to select the file you just exported. It will instantly be added to your SUN library!</p>
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setShowTemplateModal(false)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-all font-medium">Cancel</button>
                <button onClick={handleTemplateImport} className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-black font-semibold rounded-xl hover:brightness-110 active:scale-[0.97] shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2">
                  <Icons.download size={14} /> Browse & Ingest File
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
