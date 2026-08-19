"use strict";
/**
 * Favourites and collections.
 *
 * Both are keyed on the asset id, never on the file path. That is what lets an
 * asset be replaced, moved or re-downloaded without a user losing the
 * organisation they built around it.
 */

/* ------------------------------------------------------------- favourites */

function toggleFavorite(db, id) {
  const asset = db.get(id);
  if (!asset) return null;
  asset.favorite = !asset.favorite;
  asset.updatedAt = new Date().toISOString();
  db.dirty = true;
  return asset.favorite;
}

function setFavorite(db, id, value) {
  const asset = db.get(id);
  if (!asset) return null;
  asset.favorite = Boolean(value);
  asset.updatedAt = new Date().toISOString();
  db.dirty = true;
  return asset.favorite;
}

function listFavorites(db, opts = {}) {
  return db.query({ ...opts, favorite: true });
}

/* ------------------------------------------------------------ collections */

function createCollection(db, name, description = null) {
  const key = String(name).trim();
  if (!key) throw new Error("collection name cannot be empty");
  if (db.collections.has(key)) return db.collections.get(key);

  const collection = {
    name: key,
    description,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.collections.set(key, collection);
  db.dirty = true;
  return collection;
}

function deleteCollection(db, name) {
  if (!db.collections.has(name)) return false;
  db.collections.delete(name);
  // Detach the membership too, or assets keep a reference to a collection that
  // no longer exists and filters silently return nothing.
  for (const asset of db.assets.values()) {
    const i = asset.collections.indexOf(name);
    if (i >= 0) {
      asset.collections.splice(i, 1);
      asset.updatedAt = new Date().toISOString();
    }
  }
  db.dirty = true;
  return true;
}

function renameCollection(db, from, to) {
  const collection = db.collections.get(from);
  if (!collection) return false;
  const target = String(to).trim();
  if (!target || db.collections.has(target)) return false;

  db.collections.delete(from);
  collection.name = target;
  collection.updatedAt = new Date().toISOString();
  db.collections.set(target, collection);

  for (const asset of db.assets.values()) {
    const i = asset.collections.indexOf(from);
    if (i >= 0) asset.collections[i] = target;
  }
  db.dirty = true;
  return true;
}

function addToCollection(db, id, name) {
  const asset = db.get(id);
  if (!asset) return false;
  if (!db.collections.has(name)) createCollection(db, name);
  if (!asset.collections.includes(name)) {
    asset.collections.push(name);
    asset.updatedAt = new Date().toISOString();
    db.collections.get(name).updatedAt = asset.updatedAt;
    db.dirty = true;
  }
  return true;
}

function removeFromCollection(db, id, name) {
  const asset = db.get(id);
  if (!asset) return false;
  const i = asset.collections.indexOf(name);
  if (i < 0) return false;
  asset.collections.splice(i, 1);
  asset.updatedAt = new Date().toISOString();
  db.dirty = true;
  return true;
}

function listCollections(db) {
  const counts = new Map();
  for (const asset of db.assets.values()) {
    for (const c of asset.collections) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return [...db.collections.values()]
    .map((c) => ({ ...c, count: counts.get(c.name) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ usage */

/** Record that an asset was actually used, which drives "recent" and sorting. */
function markUsed(db, id) {
  const asset = db.get(id);
  if (!asset) return null;
  asset.useCount += 1;
  asset.lastUsedAt = new Date().toISOString();
  asset.updatedAt = asset.lastUsedAt;
  db.dirty = true;
  return asset;
}

function listRecent(db, limit = 40) {
  return db.all()
    .filter((a) => a.lastUsedAt && !a.quarantined)
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)))
    .slice(0, limit);
}

/* ----------------------------------------------------------- corrections */

/**
 * A user correction sticks: it survives rescans and re-downloads, because the
 * inference engine being overruled once means it will be wrong the same way
 * every time.
 */
function correctCategory(db, id, { type, category, subcategory }) {
  const asset = db.get(id);
  if (!asset) return null;

  db.deindexAsset(asset);
  if (type) asset.type = type;
  if (category) asset.category = category;
  if (subcategory !== undefined) asset.subcategory = subcategory;
  asset.userCorrected = true;
  asset.categorySource = "user";
  asset.categoryConfidence = 1;
  asset.updatedAt = new Date().toISOString();
  db.indexAsset(asset);
  db.dirty = true;
  return asset;
}

function addTags(db, id, tags) {
  const asset = db.get(id);
  if (!asset) return null;
  db.deindexAsset(asset);
  for (const t of tags) {
    const tag = String(t).toLowerCase().trim();
    if (tag && !asset.tags.includes(tag)) asset.tags.push(tag);
  }
  asset.tags.sort();
  asset.updatedAt = new Date().toISOString();
  db.indexAsset(asset);
  db.dirty = true;
  return asset;
}

function removeTags(db, id, tags) {
  const asset = db.get(id);
  if (!asset) return null;
  db.deindexAsset(asset);
  const drop = new Set(tags.map((t) => String(t).toLowerCase()));
  asset.tags = asset.tags.filter((t) => !drop.has(t));
  asset.updatedAt = new Date().toISOString();
  db.indexAsset(asset);
  db.dirty = true;
  return asset;
}

module.exports = {
  toggleFavorite, setFavorite, listFavorites,
  createCollection, deleteCollection, renameCollection,
  addToCollection, removeFromCollection, listCollections,
  markUsed, listRecent,
  correctCategory, addTags, removeTags,
};
