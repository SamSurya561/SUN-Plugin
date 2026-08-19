"use strict";
/**
 * WAV encoding and lightweight audio analysis.
 *
 * The encoder writes canonical 16-bit PCM RIFF/WAVE, which is what the
 * synthetic SFX generator emits and what Premiere imports without transcoding.
 * The reader is only deep enough to pull duration and a peak envelope for
 * waveform thumbnails; Sun Plugin never decodes audio for playback itself.
 */

const HEADER_BYTES = 44;

/**
 * Encode interleaved float channels (-1..1) as 16-bit PCM WAV.
 * @param {Float32Array[]} channels
 */
function encodeWAV(channels, sampleRate = 48000) {
  const numChannels = channels.length;
  if (numChannels === 0) throw new Error("encodeWAV: no channels");
  const frames = channels[0].length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const out = new Uint8Array(HEADER_BYTES + dataBytes);
  const dv = new DataView(out.buffer);

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true);            // PCM fmt chunk size
  dv.setUint16(20, 1, true);             // format: PCM
  dv.setUint16(22, numChannels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * blockAlign, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true);            // bits per sample
  ascii(36, "data");
  dv.setUint32(40, dataBytes, true);

  let p = HEADER_BYTES;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < numChannels; c++) {
      // Clamp before scaling: a float overshoot must not wrap around to full
      // negative scale, which is the classic loud-click bug.
      const v = Math.max(-1, Math.min(1, channels[c][f]));
      dv.setInt16(p, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
      p += 2;
    }
  }

  return out;
}

/** Read enough of a WAV header to describe the file. Returns null if not a WAV. */
function readWAVInfo(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 44) return null;

  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;

  // Walk the chunk list rather than assuming canonical layout; real-world files
  // carry LIST/INFO chunks before the data chunk.
  while (offset + 8 <= b.length) {
    const id = tag(offset);
    const size = dv.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: dv.getUint16(offset + 8, true),
        channels: dv.getUint16(offset + 10, true),
        sampleRate: dv.getUint32(offset + 12, true),
        bitsPerSample: dv.getUint16(offset + 22, true),
      };
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataSize = Math.min(size, b.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt || dataOffset < 0) return null;

  const bytesPerFrame = fmt.channels * (fmt.bitsPerSample / 8);
  const frames = bytesPerFrame > 0 ? Math.floor(dataSize / bytesPerFrame) : 0;

  return {
    ...fmt,
    frames,
    dataOffset,
    dataSize,
    duration: fmt.sampleRate > 0 ? frames / fmt.sampleRate : 0,
  };
}

/**
 * Peak envelope for a waveform thumbnail: `buckets` pairs of min/max, both
 * normalised to -1..1. Only 16-bit PCM is analysed; anything else returns null
 * and the caller falls back to a generic audio thumbnail.
 */
function peakEnvelope(bytes, buckets = 160) {
  const info = readWAVInfo(bytes);
  if (!info || info.bitsPerSample !== 16 || info.format !== 1 || info.frames === 0) return null;

  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const perBucket = Math.max(1, Math.floor(info.frames / buckets));
  const out = [];

  for (let i = 0; i < buckets; i++) {
    let min = 0;
    let max = 0;
    const start = i * perBucket;
    const end = Math.min(info.frames, start + perBucket);
    for (let f = start; f < end; f++) {
      // Channel 0 only: a mono envelope reads better at thumbnail size anyway.
      const off = info.dataOffset + f * info.channels * 2;
      if (off + 1 >= b.length) break;
      const v = dv.getInt16(off, true) / 32768;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out.push([min, max]);
  }

  return out;
}

module.exports = { encodeWAV, readWAVInfo, peakEnvelope, HEADER_BYTES };
