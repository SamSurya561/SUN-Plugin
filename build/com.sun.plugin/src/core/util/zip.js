"use strict";
/**
 * ZIP reading and writing.
 *
 * UXP ships no archive support, and .mogrt / .prfpset / .aep are all ZIP
 * containers, so Sun Plugin carries its own. Node gets node:zlib; the UXP path
 * uses the pure-JS inflate below.
 *
 * Reading is deliberately split in two:
 *   listEntries()   parses only the central directory - no decompression, so it
 *                   is safe to run on a completely untrusted archive and is what
 *                   the import audit uses to decide accept/quarantine.
 *   extractEntry()  decompresses one entry, and is only ever called after the
 *                   audit has passed.
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function nodeZlib() {
  try {
    if (typeof require !== "function") return null;
    if (typeof process === "undefined" || !process.versions || !process.versions.node) return null;
    return require("zlib");
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ inflate */

/** Canonical Huffman decoding table from a list of code lengths. */
function buildHuffman(lengths) {
  let maxBits = 0;
  for (const l of lengths) if (l > maxBits) maxBits = l;
  if (maxBits === 0) return { counts: new Int32Array(1), symbols: new Int32Array(0), maxBits: 0 };

  const counts = new Int32Array(maxBits + 1);
  for (const l of lengths) if (l > 0) counts[l]++;

  const offsets = new Int32Array(maxBits + 2);
  for (let b = 1; b <= maxBits; b++) offsets[b + 1] = offsets[b] + counts[b];

  const symbols = new Int32Array(offsets[maxBits + 1]);
  for (let s = 0; s < lengths.length; s++) {
    if (lengths[s] > 0) symbols[offsets[lengths[s]]++] = s;
  }

  return { counts, symbols, maxBits };
}

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.bitBuf = 0;
    this.bitCount = 0;
  }

  bits(n) {
    while (this.bitCount < n) {
      if (this.pos >= this.bytes.length) throw new Error("inflate: out of input");
      this.bitBuf |= this.bytes[this.pos++] << this.bitCount;
      this.bitCount += 8;
    }
    const v = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCount -= n;
    return v;
  }

  decode(table) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= table.maxBits; len++) {
      code |= this.bits(1);
      const count = table.counts[len];
      if (code - first < count) return table.symbols[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error("inflate: bad Huffman code");
  }

  alignToByte() {
    this.bitBuf = 0;
    this.bitCount = 0;
  }
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

let FIXED_LIT = null;
let FIXED_DIST = null;

function fixedTables() {
  if (!FIXED_LIT) {
    const lit = new Uint8Array(288);
    for (let i = 0; i < 144; i++) lit[i] = 8;
    for (let i = 144; i < 256; i++) lit[i] = 9;
    for (let i = 256; i < 280; i++) lit[i] = 7;
    for (let i = 280; i < 288; i++) lit[i] = 8;
    FIXED_LIT = buildHuffman(lit);
    FIXED_DIST = buildHuffman(new Uint8Array(30).fill(5));
  }
  return [FIXED_LIT, FIXED_DIST];
}

/**
 * Pure-JS raw DEFLATE decoder (RFC 1951). `expectedSize` pre-allocates the
 * output; it grows if the archive under-reports.
 */
function inflateRawJS(bytes, expectedSize = 0) {
  const br = new BitReader(bytes);
  let out = new Uint8Array(Math.max(expectedSize, 1024));
  let len = 0;

  const ensure = (extra) => {
    if (len + extra <= out.length) return;
    let size = out.length * 2;
    while (size < len + extra) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(out.subarray(0, len));
    out = bigger;
  };

  for (;;) {
    const final = br.bits(1);
    const type = br.bits(2);

    if (type === 0) {
      br.alignToByte();
      if (br.pos + 4 > bytes.length) throw new Error("inflate: truncated stored block");
      const blockLen = bytes[br.pos] | (bytes[br.pos + 1] << 8);
      br.pos += 4; // skip LEN and NLEN
      ensure(blockLen);
      out.set(bytes.subarray(br.pos, br.pos + blockLen), len);
      len += blockLen;
      br.pos += blockLen;
    } else if (type === 1 || type === 2) {
      let litTable;
      let distTable;

      if (type === 1) {
        [litTable, distTable] = fixedTables();
      } else {
        const hlit = br.bits(5) + 257;
        const hdist = br.bits(5) + 1;
        const hclen = br.bits(4) + 4;

        const clens = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) clens[CLEN_ORDER[i]] = br.bits(3);
        const clTable = buildHuffman(clens);

        const lens = new Uint8Array(hlit + hdist);
        for (let i = 0; i < lens.length; ) {
          const sym = br.decode(clTable);
          if (sym < 16) {
            lens[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new Error("inflate: repeat with no previous length");
            const prev = lens[i - 1];
            let n = 3 + br.bits(2);
            while (n-- > 0 && i < lens.length) lens[i++] = prev;
          } else if (sym === 17) {
            let n = 3 + br.bits(3);
            while (n-- > 0 && i < lens.length) lens[i++] = 0;
          } else {
            let n = 11 + br.bits(7);
            while (n-- > 0 && i < lens.length) lens[i++] = 0;
          }
        }

        litTable = buildHuffman(lens.subarray(0, hlit));
        distTable = buildHuffman(lens.subarray(hlit));
      }

      for (;;) {
        const sym = br.decode(litTable);
        if (sym < 256) {
          ensure(1);
          out[len++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LENGTH_BASE.length) throw new Error("inflate: bad length symbol");
          const length = LENGTH_BASE[li] + br.bits(LENGTH_EXTRA[li]);
          const dsym = br.decode(distTable);
          if (dsym >= DIST_BASE.length) throw new Error("inflate: bad distance symbol");
          const dist = DIST_BASE[dsym] + br.bits(DIST_EXTRA[dsym]);
          if (dist > len) throw new Error("inflate: distance before start of output");
          ensure(length);
          let from = len - dist;
          for (let i = 0; i < length; i++) out[len++] = out[from++];
        }
      }
    } else {
      throw new Error("inflate: reserved block type");
    }

    if (final) break;
  }

  return out.subarray(0, len);
}

function inflateRaw(bytes, expectedSize = 0) {
  const z = nodeZlib();
  if (z) return new Uint8Array(z.inflateRawSync(Buffer.from(bytes)));
  return inflateRawJS(bytes, expectedSize);
}

function deflateRaw(bytes) {
  const z = nodeZlib();
  if (z) return new Uint8Array(z.deflateRawSync(Buffer.from(bytes), { level: 9 }));
  return null; // caller falls back to a stored entry
}

/* --------------------------------------------------------------------- read */

function utf8Decode(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function utf8Encode(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/**
 * Parse the central directory. Never decompresses, so this is safe on hostile
 * input and is what the import audit runs first.
 *
 * Returns { ok, entries, error }.
 */
function listEntries(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 22) return { ok: false, entries: [], error: "too small to be a ZIP" };

  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

  // The EOCD sits at the end, after a comment of up to 64K.
  let eocd = -1;
  const scanFrom = Math.max(0, b.length - 22 - 65535);
  for (let i = b.length - 22; i >= scanFrom; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, entries: [], error: "no end-of-central-directory record" };

  const count = dv.getUint16(eocd + 10, true);
  const cenOffset = dv.getUint32(eocd + 16, true);

  if (count === 0xffff || cenOffset === 0xffffffff) {
    return { ok: false, entries: [], error: "ZIP64 archives are not supported" };
  }
  if (cenOffset >= b.length) {
    return { ok: false, entries: [], error: "central directory offset out of range" };
  }

  const entries = [];
  let p = cenOffset;

  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== CEN_SIG) {
      return { ok: false, entries, error: `corrupt central directory at entry ${i}` };
    }

    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const uncompressedSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const externalAttr = dv.getUint32(p + 38, true);
    const localOffset = dv.getUint32(p + 42, true);

    if (p + 46 + nameLen > b.length) {
      return { ok: false, entries, error: "entry name runs past end of file" };
    }

    const name = utf8Decode(b.subarray(p + 46, p + 46 + nameLen));

    // Unix mode lives in the high 16 bits; 0xA000 marks a symlink, which we
    // refuse outright rather than trying to resolve.
    const unixMode = (externalAttr >>> 16) & 0xffff;
    const isSymlink = (unixMode & 0xf000) === 0xa000;

    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      isDirectory: name.endsWith("/") || uncompressedSize === 0 && name.endsWith("/"),
      isSymlink,
      isEncrypted: (flags & 0x01) !== 0,
    });

    p += 46 + nameLen + extraLen + commentLen;
  }

  return { ok: true, entries, error: null };
}

/** Decompress one entry. Only call after the audit has accepted the archive. */
function extractEntry(bytes, entry) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);

  if (entry.isEncrypted) throw new Error("encrypted ZIP entries are not supported");
  if (dv.getUint32(entry.localOffset, true) !== LOC_SIG) throw new Error("bad local header");

  const nameLen = dv.getUint16(entry.localOffset + 26, true);
  const extraLen = dv.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const raw = b.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) return inflateRaw(raw, entry.uncompressedSize);
  throw new Error(`unsupported compression method ${entry.method}`);
}

/* -------------------------------------------------------------------- write */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP from [{ name, data }]. `data` may be a string or a Uint8Array.
 * Used to author .mogrt fixtures and to package exported metadata.
 */
function createZip(files) {
  const prepared = files.map((f) => {
    const data = typeof f.data === "string" ? utf8Encode(f.data) : new Uint8Array(f.data);
    const nameBytes = utf8Encode(f.name);
    const deflated = data.length > 64 ? deflateRaw(data) : null;
    const useDeflate = deflated !== null && deflated.length < data.length;
    return {
      nameBytes,
      data,
      payload: useDeflate ? deflated : data,
      method: useDeflate ? 8 : 0,
      crc: crc32(data),
    };
  });

  let total = 0;
  for (const p of prepared) total += 30 + p.nameBytes.length + p.payload.length + 46 + p.nameBytes.length;
  total += 22;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let off = 0;
  const offsets = [];

  for (const p of prepared) {
    offsets.push(off);
    dv.setUint32(off, LOC_SIG, true);
    dv.setUint16(off + 4, 20, true);        // version needed
    dv.setUint16(off + 6, 0x0800, true);    // UTF-8 names
    dv.setUint16(off + 8, p.method, true);
    dv.setUint16(off + 10, 0, true);        // mod time
    dv.setUint16(off + 12, 0x0021, true);   // mod date (1980-01-01)
    dv.setUint32(off + 14, p.crc, true);
    dv.setUint32(off + 18, p.payload.length, true);
    dv.setUint32(off + 22, p.data.length, true);
    dv.setUint16(off + 26, p.nameBytes.length, true);
    dv.setUint16(off + 28, 0, true);
    off += 30;
    out.set(p.nameBytes, off); off += p.nameBytes.length;
    out.set(p.payload, off); off += p.payload.length;
  }

  const cenStart = off;
  prepared.forEach((p, i) => {
    dv.setUint32(off, CEN_SIG, true);
    dv.setUint16(off + 4, 20, true);
    dv.setUint16(off + 6, 20, true);
    dv.setUint16(off + 8, 0x0800, true);
    dv.setUint16(off + 10, p.method, true);
    dv.setUint16(off + 12, 0, true);
    dv.setUint16(off + 14, 0x0021, true);
    dv.setUint32(off + 16, p.crc, true);
    dv.setUint32(off + 20, p.payload.length, true);
    dv.setUint32(off + 24, p.data.length, true);
    dv.setUint16(off + 28, p.nameBytes.length, true);
    dv.setUint16(off + 30, 0, true);
    dv.setUint16(off + 32, 0, true);
    dv.setUint16(off + 34, 0, true);
    dv.setUint16(off + 36, 0, true);
    dv.setUint32(off + 38, 0, true);
    dv.setUint32(off + 42, offsets[i], true);
    off += 46;
    out.set(p.nameBytes, off); off += p.nameBytes.length;
  });

  dv.setUint32(off, EOCD_SIG, true);
  dv.setUint16(off + 4, 0, true);
  dv.setUint16(off + 6, 0, true);
  dv.setUint16(off + 8, prepared.length, true);
  dv.setUint16(off + 10, prepared.length, true);
  dv.setUint32(off + 12, cenStart === 0 ? off : off - cenStart, true);
  dv.setUint32(off + 16, cenStart, true);
  dv.setUint16(off + 20, 0, true);
  off += 22;

  return out.subarray(0, off);
}

module.exports = {
  listEntries,
  extractEntry,
  createZip,
  inflateRaw,
  inflateRawJS,
  deflateRaw,
  crc32,
  utf8Encode,
  utf8Decode,
};
