// Cuts the game's recorded audio samples out of CC0 field recordings listed in
// samples.json and writes them into public/assets/audio/ (bundled with the app, nothing is
// fetched at runtime). Re-run after editing the manifest:
//
//   node tools/audio/samples.mjs              # download (cached) + process everything
//   node tools/audio/samples.mjs engine-mid   # only the samples whose name matches
//
// Every source is BigSoundBank's lossless 48 kHz WAV. For each sample the script trims the
// recording, optionally flattens its pitch (a rev sweep resampled against its own tracked
// fundamental, so it holds one RPM), evens out its level, cuts out rumble under `highpass`,
// makes it a seamless loop or fades it as a one-shot, and normalizes it. It prints each
// sample's measured fundamental: core/audio's engine layers are tuned from those numbers.
// CREDITS.md is regenerated with every source, author and licence.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'public/assets/audio');
const CACHE = path.join(here, 'cache');
const manifest = JSON.parse(await fs.readFile(path.join(here, 'samples.json'), 'utf8'));
const only = process.argv[2];
const SR = 48000;

// ---- WAV in (16- or 24-bit PCM, mixed to mono) and out (16-bit mono) ----

function readWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null;
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = buf.toString('ascii', o, o + 4);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') fmt = { channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    if (id === 'data') {
      if (!fmt || (fmt.bits !== 16 && fmt.bits !== 24)) throw new Error('expected 16- or 24-bit PCM');
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const x = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.channels; c++) {
          const at = o + 8 + (i * fmt.channels + c) * bytes;
          s += bytes === 2 ? v.getInt16(at, true) / 32768 : ((v.getInt8(at + 2) << 16) | v.getUint16(at, true)) / 8388608;
        }
        x[i] = s / fmt.channels;
      }
      return { rate: fmt.rate, x };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

function writeWav(x, rate) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) {
    // TPDF dither under the 16-bit step.
    const d = (Math.random() - Math.random()) / 32768;
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((x[i] + d) * 32767))), 44 + i * 2);
  }
  return b;
}

// ---- Analysis ----

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(a * k);
        const s = Math.sin(a * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * c - im[i + k + len / 2] * s;
        const vi = re[i + k + len / 2] * s + im[i + k + len / 2] * c;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

// Magnitude spectrum of x[at .. at+win), Hann-windowed and zero-padded to `size`.
function spectrum(x, at, win, size) {
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < win; i++) re[i] = (x[at + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// Fundamental of x around `at` by harmonic product spectrum over [lo, hi] Hz: the frequency
// whose first five harmonics carry the most (log) energy. For an engine, configure lo/hi so
// it lands on twice the crank speed (rpm = 30 × f), the strongest line in these recordings.
function pitchAt(x, at, rate, lo, hi, win = 0.12) {
  const w = Math.round(win * rate);
  const size = 1 << Math.ceil(Math.log2(w * 4));
  const mag = spectrum(x, Math.max(0, at - (w >> 1)), w, size);
  const bin = rate / size;
  const amp = (f) => {
    const p = f / bin;
    const i = Math.floor(p);
    return i + 1 < mag.length ? mag[i] + (mag[i + 1] - mag[i]) * (p - i) : 0;
  };
  let best = lo;
  let score = -Infinity;
  for (let f = lo; f <= hi; f += 0.25) {
    let s = 0;
    for (let k = 1; k <= 5; k++) s += Math.log(amp(f * k) + 1e-9);
    if (s > score) {
      score = s;
      best = f;
    }
  }
  return best;
}

// Pitch track over the whole clip, every 10 ms, then median- and mean-smoothed so a single
// wrong pick (a gear whine, a sub-harmonic) cannot bend the resampling.
function pitchTrack(x, rate, lo, hi, from, to) {
  const hop = Math.round(0.01 * rate);
  const first = Math.max(0, Math.round(from * rate));
  const last = Math.min(x.length, Math.round(to * rate));
  const raw = [];
  for (let at = first; at < last; at += hop) raw.push(pitchAt(x, at, rate, lo, hi));
  const med = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 7), i + 8).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  const sm = med.map((_, i) => {
    const w = med.slice(Math.max(0, i - 5), i + 6);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  return (t) => {
    const p = (t * rate - first) / hop;
    const i = Math.max(0, Math.min(sm.length - 1, Math.floor(p)));
    const j = Math.min(sm.length - 1, i + 1);
    return sm[i] + (sm[j] - sm[i]) * Math.max(0, Math.min(1, p - i));
  };
}

const rmsOf = (x, a = 0, b = x.length) => {
  let e = 0;
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, b - a));
};
const db = (v) => (20 * Math.log10(v + 1e-12)).toFixed(1);

// ---- Processing ----

// Windowed-sinc read of x at fractional position p (8 taps each side, Blackman window).
function readAt(x, p) {
  const i = Math.floor(p);
  const f = p - i;
  let s = 0;
  for (let k = -7; k <= 8; k++) {
    const d = k - f;
    const v = x[i + k];
    if (v === undefined) continue;
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
    const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / 8.5) + 0.08 * Math.cos((2 * Math.PI * d) / 8.5);
    s += v * sinc * w;
  }
  return s;
}

// Resamples x so its tracked fundamental holds at `to` Hz: where the recording is below the
// target it is read faster, above it slower. Reads `seconds` of output starting at `start`.
function flatten(x, rate, track, to, start, seconds) {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  let p = start * rate;
  for (let i = 0; i < n; i++) {
    out[i] = readAt(x, p);
    p += to / track(p / rate);
  }
  return { y: out, end: p / rate };
}

// Evens out slow level changes (a rev sweep swelling toward the microphone) to the clip's own
// average, with a `window`-second RMS follower.
function level(y, rate, window) {
  const w = Math.round(window * rate);
  const target = rmsOf(y);
  const env = new Float32Array(y.length);
  let e = 0;
  const sq = y.map((v) => v * v);
  for (let i = 0; i < Math.min(w, y.length); i++) e += sq[i];
  for (let i = 0; i < y.length; i++) {
    const a = i - (w >> 1);
    const b = a + w;
    if (b < y.length && b >= w) e += sq[b] - (a - 1 >= 0 ? sq[a - 1] : 0);
    env[i] = Math.sqrt(Math.max(1e-12, e / w));
  }
  return y.map((v, i) => (v * target) / env[i]);
}

// Second-order Butterworth high-pass, forward and backward (zero phase).
function highpass(y, rate, fc) {
  const w = (2 * Math.PI * fc) / rate;
  const al = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + al;
  const b = [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0];
  const a = [(-2 * c) / a0, (1 - al) / a0];
  const run = (x) => {
    const o = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = v;
      o[i] = v;
    }
    return o;
  };
  return run(run(y).reverse()).reverse();
}

// Seamless loop: the last `xfade` seconds are crossfaded (equal power) over the start, so the
// end runs into the beginning without a click. The result is `xfade` shorter than the input.
function loop(y, rate, xfade) {
  const x = Math.round(xfade * rate);
  const n = y.length - x;
  const out = y.slice(0, n);
  for (let i = 0; i < x; i++) {
    const t = (i + 0.5) / x;
    out[i] = y[i] * Math.sin((t * Math.PI) / 2) + y[n + i] * Math.cos((t * Math.PI) / 2);
  }
  return out;
}

function fades(y, rate, fin, fout) {
  const a = Math.round(fin * rate);
  const b = Math.round(fout * rate);
  for (let i = 0; i < a; i++) y[i] *= i / a;
  for (let i = 0; i < b; i++) y[y.length - 1 - i] *= i / b;
  return y;
}

async function source(src) {
  await fs.mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, path.basename(new URL(src.url).pathname));
  try {
    return readWav(await fs.readFile(file));
  } catch {}
  const res = await fetch(src.url, { headers: { 'User-Agent': 'apex-overdrive-asset-fetch', Referer: src.page } });
  if (!res.ok) throw new Error(`${src.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(file, buf);
  return readWav(buf);
}

async function build(s) {
  const src = manifest.sources[s.source];
  const { rate, x } = await source(src);
  if (rate !== SR) throw new Error(`${s.name}: source is ${rate} Hz, expected ${SR}`);
  let y;
  let note = '';
  const len = s.length + (s.loop ?? 0);
  if (s.flatten) {
    const { to, lo, hi } = s.flatten;
    // Track a little past where the read can reach (a flat-pitched read of a rising sweep
    // covers up to twice the output length of source).
    const track = pitchTrack(x, rate, lo, hi, s.start - 0.2, s.start + len * 2 + 0.2);
    const r = flatten(x, rate, track, to, s.start, len);
    y = r.y;
    note = `flattened ${track(s.start).toFixed(1)}→${track(r.end).toFixed(1)} Hz to ${to} Hz (source ${s.start}-${r.end.toFixed(2)} s)`;
  } else {
    y = x.slice(Math.round(s.start * rate), Math.round((s.start + len) * rate));
  }
  if (s.highpass) y = highpass(y, rate, s.highpass);
  if (s.level) y = level(y, rate, s.level);
  if (s.loop) y = loop(y, rate, s.loop);
  else fades(y, rate, s.fadeIn ?? 0.004, s.fadeOut ?? 0.03);
  let mean = 0;
  for (const v of y) mean += v;
  mean /= y.length;
  y = y.map((v) => v - mean);
  // Normalize: loops to an RMS (so crossfaded layers match), one-shots to a peak.
  const g = s.rms ? s.rms / rmsOf(y) : (s.peak ?? 0.7) / y.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9);
  y = y.map((v) => v * g);
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.98) throw new Error(`${s.name}: peak ${peak.toFixed(2)} after normalizing; lower rms`);
  // Measured fundamental (the middle of the clip) and, for loops, the step at the seam.
  const f0 = s.pitch ? pitchAt(y, y.length >> 1, rate, s.pitch.lo, s.pitch.hi, Math.min(0.5, (y.length / rate) * 0.8)) : null;
  const seam = s.loop ? Math.abs(y[0] - y[y.length - 1]) : 0;
  await fs.writeFile(path.join(OUT, `${s.name}.wav`), writeWav(y, rate));
  console.log(
    `${s.name}.wav: ${(y.length / rate).toFixed(3)} s, rms ${db(rmsOf(y))} dBFS, peak ${db(peak)} dBFS` +
      (f0 ? `, f0 ${f0.toFixed(1)} Hz (rpm ${Math.round(f0 * 30)})` : '') +
      (s.loop ? `, seam step ${seam.toFixed(4)}` : '') +
      (note ? `\n  ${note}` : ''),
  );
}

function credits() {
  const rows = manifest.samples.map((s) => {
    const src = manifest.sources[s.source];
    return `| \`${s.name}.wav\` | [${src.title}](${src.page}) (#${src.id}) | ${src.author} | ${s.use} |`;
  });
  return `# Audio samples: sources and licences

Generated by \`node tools/audio/samples.mjs\` from \`tools/audio/samples.json\`. Do not edit by hand.

Every file here is cut from a field recording by Joseph Sardin on
[BigSoundBank](https://bigsoundbank.com), released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain, free for
commercial use, no attribution required; credited anyway: "Additional sounds: Joseph SARDIN -
BigSoundBank.com"). The script trimmed them, flattened the pitch of rev sweeps, evened their
level, looped or faded them and normalized them; they are 16-bit mono WAV at 48 kHz, bundled
into the app, so nothing downloads at runtime.

| File | Source | Author | Used for |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
}

await fs.mkdir(OUT, { recursive: true });
for (const s of manifest.samples) if (!only || s.name.includes(only)) await build(s);
await fs.writeFile(path.join(OUT, 'CREDITS.md'), credits());
