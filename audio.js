/*
 * Local audio extraction.
 * Turns a (possibly huge) video file into small 16 kHz mono WAV chunks
 * entirely inside the browser, so nothing large is ever uploaded.
 *
 * Fast path (MP4 / MOV / M4A): parse the moov box with mp4box.js, read only
 * the audio samples from disk and decode them with WebCodecs, streaming.
 * Fallback (anything else): decodeAudioData on the whole file.
 */
(function () {
  "use strict";

  const TARGET_RATE = 16000;
  const CHUNK_SECONDS = 600; // 10 min -> ~19 MB WAV, under the 25 MB API limit
  const SEARCH_SECONDS = 30; // look for a quiet spot in the last 30 s of a chunk
  const READ_WINDOW = 16 * 1024 * 1024;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------- WAV ---------- */
  function encodeWav(int16) {
    const header = new ArrayBuffer(44);
    const v = new DataView(header);
    const dataBytes = int16.length * 2;
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    v.setUint32(4, 36 + dataBytes, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, TARGET_RATE, true);
    v.setUint32(28, TARGET_RATE * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(36, "data");
    v.setUint32(40, dataBytes, true);
    return new Blob([header, int16], { type: "audio/wav" });
  }

  /* ---------- Chunker: collects 16 kHz samples, cuts at quiet spots ---------- */
  class Chunker {
    constructor() {
      this.limit = CHUNK_SECONDS * TARGET_RATE;
      this.buf = new Int16Array(this.limit);
      this.len = 0;
      this.offset = 0; // samples already emitted
      this.chunks = [];
    }

    push(f32) {
      let i = 0;
      while (i < f32.length) {
        const n = Math.min(f32.length - i, this.limit - this.len);
        for (let k = 0; k < n; k++) {
          let s = f32[i + k];
          s = s > 1 ? 1 : s < -1 ? -1 : s;
          this.buf[this.len + k] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.len += n;
        i += n;
        if (this.len >= this.limit) this.cut();
      }
    }

    quietestPoint() {
      const frame = Math.round(TARGET_RATE * 0.25);
      const step = Math.round(frame / 2);
      const start = Math.max(0, this.len - SEARCH_SECONDS * TARGET_RATE);
      let best = this.len, bestEnergy = Infinity;
      for (let p = start; p + frame <= this.len; p += step) {
        let e = 0;
        for (let k = p; k < p + frame; k++) e += this.buf[k] * this.buf[k];
        if (e < bestEnergy) { bestEnergy = e; best = p + Math.round(frame / 2); }
      }
      return best;
    }

    emit(n) {
      const pcm = this.buf.slice(0, n);
      this.chunks.push({
        blob: encodeWav(pcm),
        startSec: this.offset / TARGET_RATE,
        durationSec: n / TARGET_RATE,
      });
      this.offset += n;
      this.buf.copyWithin(0, n, this.len);
      this.len -= n;
    }

    cut() { this.emit(this.quietestPoint()); }

    finish() {
      if (this.len > TARGET_RATE * 0.5) this.emit(this.len);
      return this.chunks;
    }
  }

  /* ---------- Streaming down-sampler (box filter, fine for speech) ---------- */
  class Resampler {
    constructor(inputRate) {
      this.step = inputRate / TARGET_RATE;
      this.carry = new Float32Array(0);
      this.pos = 0;
    }

    process(input) {
      let data = input;
      if (this.carry.length) {
        data = new Float32Array(this.carry.length + input.length);
        data.set(this.carry);
        data.set(input, this.carry.length);
      }
      const step = this.step;
      const maxOut = Math.floor((data.length - this.pos) / step) + 1;
      const out = new Float32Array(Math.max(0, maxOut));
      let o = 0, pos = this.pos;
      while (Math.floor(pos + step) <= data.length) {
        const a = Math.floor(pos), b = Math.max(a + 1, Math.floor(pos + step));
        let sum = 0;
        for (let k = a; k < b; k++) sum += data[k];
        out[o++] = sum / (b - a);
        pos += step;
      }
      const keepFrom = Math.floor(pos);
      this.carry = data.slice(keepFrom);
      this.pos = pos - keepFrom;
      return out.subarray(0, o);
    }
  }

  function mixToMono(planes) {
    if (planes.length === 1) return planes[0];
    const n = planes[0].length, out = new Float32Array(n);
    for (const p of planes) for (let i = 0; i < n; i++) out[i] += p[i];
    for (let i = 0; i < n; i++) out[i] /= planes.length;
    return out;
  }

  /* ---------- MP4 fast path ---------- */
  async function readTopLevelBoxes(file) {
    const boxes = [];
    let off = 0;
    while (off + 8 <= file.size) {
      const v = new DataView(await file.slice(off, off + 16).arrayBuffer());
      let size = v.getUint32(0);
      const type = String.fromCharCode(v.getUint8(4), v.getUint8(5), v.getUint8(6), v.getUint8(7));
      let header = 8;
      if (size === 1) { size = Number(v.getBigUint64(8)); header = 16; }
      else if (size === 0) size = file.size - off;
      if (size < header) throw new Error("Invalid MP4 box structure");
      boxes.push({ type, off, size });
      off += size;
    }
    return boxes;
  }

  function findDescriptor(desc, tag) {
    if (!desc) return null;
    if (desc.tag === tag) return desc;
    for (const d of desc.descs || []) {
      const found = findDescriptor(d, tag);
      if (found) return found;
    }
    return null;
  }

  async function extractMp4(file, onProgress) {
    if (typeof MP4Box === "undefined") throw new Error("mp4box.js not loaded");
    const boxes = await readTopLevelBoxes(file);
    const moov = boxes.find((b) => b.type === "moov");
    if (!moov) throw new Error("No moov box");

    // mp4box needs ftyp + moov; feed just those two boxes (sample offsets stay absolute)
    const ftyp = boxes.find((b) => b.type === "ftyp");
    const parts = ftyp ? [file.slice(ftyp.off, ftyp.off + ftyp.size)] : [];
    parts.push(file.slice(moov.off, moov.off + moov.size));
    const moovBuf = await new Blob(parts).arrayBuffer();
    moovBuf.fileStart = 0;
    const mp4 = MP4Box.createFile();
    let info = null;
    mp4.onReady = (i) => { info = i; };
    mp4.onError = (e) => { throw new Error("MP4 parse error: " + e); };
    mp4.appendBuffer(moovBuf);
    mp4.flush();
    if (!info) throw new Error("MP4 metadata not parsed");

    const track = info.audioTracks && info.audioTracks[0];
    if (!track) throw new Error("NO_AUDIO_TRACK");

    const trak = mp4.getTrackById(track.id);
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    let description;
    if (entry.esds && entry.esds.esd) {
      const dsi = findDescriptor(entry.esds.esd, 0x05);
      if (dsi && dsi.data) description = new Uint8Array(dsi.data);
    }
    const config = {
      codec: track.codec,
      sampleRate: track.audio.sample_rate,
      numberOfChannels: track.audio.channel_count,
      description,
    };
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error("Codec not supported: " + track.codec);

    const samples = mp4.getTrackSamplesInfo(track.id);
    if (!samples.length) throw new Error("Audio track is empty");

    const chunker = new Chunker();
    let resampler = null;
    let decodeError = null;

    const decoder = new AudioDecoder({
      output: (ad) => {
        try {
          if (!resampler) resampler = new Resampler(ad.sampleRate);
          const planes = [];
          for (let c = 0; c < ad.numberOfChannels; c++) {
            const p = new Float32Array(ad.numberOfFrames);
            ad.copyTo(p, { planeIndex: c, format: "f32-planar" });
            planes.push(p);
          }
          chunker.push(resampler.process(mixToMono(planes)));
        } catch (e) {
          decodeError = e;
        } finally {
          ad.close();
        }
      },
      error: (e) => { decodeError = e; },
    });
    decoder.configure(config);

    let wStart = 0, wEnd = 0, wBuf = null;
    for (let i = 0; i < samples.length; i++) {
      if (decodeError) throw decodeError;
      const s = samples[i];
      if (!wBuf || s.offset < wStart || s.offset + s.size > wEnd) {
        wStart = s.offset;
        wEnd = Math.min(file.size, s.offset + Math.max(READ_WINDOW, s.size));
        wBuf = await file.slice(wStart, wEnd).arrayBuffer();
      }
      decoder.decode(new EncodedAudioChunk({
        type: "key",
        timestamp: Math.round((s.cts * 1e6) / s.timescale),
        duration: Math.round((s.duration * 1e6) / s.timescale),
        data: new Uint8Array(wBuf, s.offset - wStart, s.size),
      }));
      while (decoder.decodeQueueSize > 64) await sleep(2);
      if (i % 400 === 0) onProgress && onProgress(i / samples.length);
    }
    await decoder.flush();
    decoder.close();
    if (decodeError) throw decodeError;
    onProgress && onProgress(1);
    return chunker.finish();
  }

  /* ---------- Fallback: decode the whole file at once ---------- */
  async function extractWithDecodeAudioData(file, onProgress) {
    onProgress && onProgress(0.05);
    const buf = await file.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new Ctx(1, 1, TARGET_RATE);
    let audio;
    try {
      audio = await ctx.decodeAudioData(buf);
    } catch (e) {
      throw new Error("DECODE_FAILED");
    }
    onProgress && onProgress(0.6);
    const chunker = new Chunker();
    const planes = [];
    for (let c = 0; c < audio.numberOfChannels; c++) planes.push(audio.getChannelData(c));
    const STEP = TARGET_RATE * 30;
    for (let i = 0; i < audio.length; i += STEP) {
      const part = planes.map((p) => p.subarray(i, Math.min(audio.length, i + STEP)));
      // decodeAudioData already resampled to 16 kHz (the context's rate)
      chunker.push(mixToMono(part));
    }
    onProgress && onProgress(1);
    return chunker.finish();
  }

  function looksLikeMp4(file) {
    return /\.(mp4|m4v|mov|m4a|3gp|3g2)$/i.test(file.name) ||
      /^(video\/(mp4|quicktime|3gpp)|audio\/(mp4|x-m4a|m4a))$/i.test(file.type);
  }

  async function extractAudioChunks(file, onProgress) {
    const webCodecs = typeof AudioDecoder !== "undefined" && typeof EncodedAudioChunk !== "undefined";
    if (webCodecs && looksLikeMp4(file)) {
      try {
        return { chunks: await extractMp4(file, onProgress), method: "webcodecs" };
      } catch (e) {
        if (e && e.message === "NO_AUDIO_TRACK") throw e;
        console.warn("Fast MP4 path failed, falling back:", e);
      }
    }
    return { chunks: await extractWithDecodeAudioData(file, onProgress), method: "decodeAudioData" };
  }

  window.AudioExtract = { extractAudioChunks, TARGET_RATE, CHUNK_SECONDS };
})();
