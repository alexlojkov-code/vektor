// Музыка и звуковой дизайн промо-ролика: синтез в Node без библиотек → promo/out/audio.wav (48 кГц, стерео).
// 120 BPM, фа минор. Таймкоды событий совпадают с renderAt(t) в index.html.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 48000, LEN = 42, N = SR * LEN;
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// шины: музыка (с приглушением под бочку), бочка/ударные, эффекты, посыл в реверберацию
const bus = () => [new Float32Array(N), new Float32Array(N)];
const MUS = bus(), DRM = bus(), SFX = bus(), REV = bus();
let seed = 1234567;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
const mtof = m => 440 * 2 ** ((m - 69) / 12);

// фильтр с переменной частотой (TPT state-variable)
function svf() {
  let ic1 = 0, ic2 = 0;
  return (x, fc, q = .707) => {
    const g = Math.tan(Math.PI * Math.min(fc, SR * .45) / SR), k = 1 / q;
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  };
}
// пишет голос: fn(i, tt) → [l, r] либо число (моно с панорамой)
function voice(B, t0, dur, fn, { pan = 0, gain = 1, send = 0 } = {}) {
  const s0 = Math.max(0, Math.round(t0 * SR)), s1 = Math.min(N, Math.round((t0 + dur) * SR));
  const pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = s0; i < s1; i++) {
    const v = fn(i - s0, (i - s0) / SR);
    let l, r;
    if (Array.isArray(v)) [l, r] = v; else { l = v * pl * 1.414; r = v * pr * 1.414; }
    B[0][i] += l * gain; B[1][i] += r * gain;
    if (send) { REV[0][i] += l * gain * send; REV[1][i] += r * gain * send; }
  }
}
const saw = ph => 2 * (ph - Math.floor(ph + .5));
const sq = ph => (ph % 1) < .5 ? 1 : -1;

/* ---------- инструменты ---------- */
const KICKS = [];
function kick(t, g = 1) {
  KICKS.push(t);
  let ph = 0;
  voice(DRM, t, .5, (i, tt) => {
    const f = 46 + 110 * Math.exp(-tt * 28);
    ph += f / SR;
    return (Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 7.5) + (tt < .004 ? rnd() * .5 : 0)) * .95;
  }, { gain: g });
}
function clap(t, g = 1) {
  const f = svf();
  voice(DRM, t, .4, (i, tt) => {
    const env = (tt < .03 ? Math.exp(-((tt % .01) * 300)) : 0) + Math.exp(-tt * 14) * .8;
    return f(rnd(), 1300, 1.2).bp * env;
  }, { gain: .55 * g, send: .25 });
}
function hat(t, open = false, g = 1, pan = .25) {
  const f = svf();
  voice(DRM, t, open ? .35 : .08, (i, tt) => f(rnd(), 8000, .8).hp * Math.exp(-tt * (open ? 11 : 55)), { gain: .16 * g, pan });
}
function crash(t, g = 1) {
  const f = svf();
  voice(DRM, t, 2.2, (i, tt) => f(rnd(), 5200, .6).hp * Math.exp(-tt * 2.2), { gain: .2 * g, send: .3 });
}
function snare(t, g = 1) {
  const f = svf(); let ph = 0;
  voice(DRM, t, .25, (i, tt) => { ph += 190 / SR; return (f(rnd(), 2500, .9).bp * 1.3 + Math.sin(2 * Math.PI * ph) * .4) * Math.exp(-tt * 20); }, { gain: .35 * g, send: .15 });
}
function bass(t, m, dur, g = 1) {
  const f = svf(); let ph = 0; const fr = mtof(m);
  voice(MUS, t, dur + .05, (i, tt) => {
    ph += fr / SR;
    const env = Math.min(1, tt / .005) * Math.exp(-tt * 3) * (tt > dur ? Math.exp(-(tt - dur) * 60) : 1);
    const x = saw(ph) * .6 + Math.sin(2 * Math.PI * ph) * .7;
    return f(x, 180 + 900 * Math.exp(-tt * 14), 1.1).lp * env;
  }, { gain: .5 * g });
}
function pad(t, notes, dur, g = 1, bright = 1) {
  notes.forEach((m, j) => [-0.11, 0, 0.12].forEach((det, k) => {
    const f = svf(); let ph = rnd() * .5 + .5; const fr = mtof(m + det);
    voice(MUS, t, dur + 1.2, (i, tt) => {
      ph += fr / SR;
      const env = Math.min(1, tt / .35) * (tt > dur ? Math.exp(-(tt - dur) * 3.2) : 1);
      return f(saw(ph), (900 + 700 * Math.sin(tt * 1.3 + j)) * bright, .8).lp * env;
    }, { gain: .045 * g, pan: (k - 1) * .6, send: .35 });
  }));
}
function pluck(t, m, g = 1, pan = 0) {
  const f = svf(); let ph = 0; const fr = mtof(m);
  voice(MUS, t, .5, (i, tt) => { ph += fr / SR; return f(saw(ph) * .7 + sq(ph * 1.003) * .3, 600 + 3200 * Math.exp(-tt * 16), 1.4).lp * Math.exp(-tt * 9); }, { gain: .11 * g, pan, send: .3 });
}
// «глитч»-аккорд для ударов слов: квадратная волна с понижением разрядности
function stab(t, notes, g = 1, pan = 0) {
  voice(SFX, t, .22, (i, tt) => {
    let x = 0; notes.forEach(m => { x += sq(mtof(m) * tt) * .25; });
    const crush = Math.round(x * 6) / 6;
    return crush * Math.exp(-tt * 16) * (Math.floor(tt * 90) % 3 === 2 ? .3 : 1);
  }, { gain: .2 * g, pan, send: .2 });
}

/* ---------- звуковой дизайн ---------- */
function impact(t, size = 1, pan = 0) {
  let ph = 0; const f = svf();
  voice(SFX, t, 1.8 * size, (i, tt) => {
    ph += (32 + 70 * Math.exp(-tt * 9)) / SR;
    const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * (3.2 / size));
    const crack = f(rnd(), 2400 * Math.exp(-tt * 5) + 200, .7).lp * Math.exp(-tt * 9);
    return boom * .9 + crack * .7;
  }, { gain: .5 * size, pan, send: .35 });
}
function thud(t, g = 1, pan = 0) {
  let ph = 0; const f = svf();
  voice(SFX, t, .35, (i, tt) => { ph += (70 + 90 * Math.exp(-tt * 30)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 14) + f(rnd(), 900, .7).lp * Math.exp(-tt * 40) * .6; }, { gain: .45 * g, pan, send: .12 });
}
function whoosh(t, dur, g = 1, from = 300, to = 4500, panFrom = -.7, panTo = .7) {
  const f = svf();
  voice(SFX, t, dur, (i, tt) => {
    const u = tt / dur, env = Math.sin(Math.PI * Math.min(1, u ** .7)) ** 2;
    const v = f(rnd(), from * (to / from) ** u, 2.2).bp * env * 1.6;
    const p = panFrom + (panTo - panFrom) * u, a = (p + 1) * Math.PI / 4;
    return [v * Math.cos(a) * 1.414, v * Math.sin(a) * 1.414];
  }, { gain: .32 * g, send: .2 });
}
function riser(t, dur, g = 1) {
  const f = svf(); let ph = 0;
  voice(SFX, t, dur, (i, tt) => {
    const u = tt / dur;
    ph += (110 + 330 * u * u) / SR;
    return (f(rnd(), 400 + 7000 * u * u, 3).bp * 1.4 + saw(ph) * .08) * u ** 2;
  }, { gain: .3 * g, send: .3 });
}
function click(t, g = 1, pan = 0) {
  const f = svf();
  voice(SFX, t, .05, (i, tt) => f(rnd(), 3800, 2).bp * Math.exp(-tt * 160) * 2.4 + Math.sin(2 * Math.PI * 1800 * tt) * Math.exp(-tt * 220) * .5, { gain: .42 * g, pan });
}
function key(t, g = 1) {
  const f = svf(), fc = 2600 + rnd() * 1400;
  voice(SFX, t, .04, (i, tt) => f(rnd(), fc, 3).bp * Math.exp(-tt * 260) * 2, { gain: .18 * g, pan: rnd() * .3 });
}
function tick(t, g = 1, m = 96) {
  voice(SFX, t, .05, (i, tt) => Math.sin(2 * Math.PI * mtof(m) * tt) * Math.exp(-tt * 120), { gain: .1 * g, pan: .2 });
}
function ding(t, notes, g = 1) {
  notes.forEach((m, j) => voice(SFX, t + j * .07, 1.4, (i, tt) => {
    const fr = mtof(m);
    return Math.sin(2 * Math.PI * fr * tt + 1.8 * Math.sin(2 * Math.PI * fr * 2 * tt) * Math.exp(-tt * 6)) * Math.exp(-tt * 3.5);
  }, { gain: .14 * g, pan: j ? .3 : -.3, send: .4 }));
}
function drone(t, dur, m) {
  let ph = 0; const f = svf();
  voice(MUS, t, dur, (i, tt) => { ph += mtof(m) / SR; const env = Math.min(1, tt / 1.5) * Math.min(1, (dur - tt) / .08); return (Math.sin(2 * Math.PI * ph) * .8 + f(rnd(), 220, .7).lp * .5) * env; }, { gain: .22 });
}

/* ---------- аранжировка ---------- */
const BEAT = .5, BAR = 2;
// аккорды по тактам с 6 с: Fm9 · Dbmaj7 · Abmaj7 · Eb
const CH = [{ root: 41, pad: [53, 56, 60, 63, 67] }, { root: 37, pad: [49, 53, 56, 60] }, { root: 44, pad: [56, 60, 63, 67] }, { root: 39, pad: [51, 55, 58, 63] }];
const chordAt = t => CH[Math.floor((t - 6) / BAR) % 4];

// 0–6: хаос
drone(0, 5.9, 29);
for (let t = 0; t < 5.9; t += .125) hat(t, false, t % .5 === 0 ? .8 : .45, .4);
[.5, 1, 1.5, 2, 2.5, 3, 3.5].forEach((t, i) => { stab(t, [[53, 56, 60], [52, 55, 61], [53, 58, 61], [51, 56, 60]][i % 4], 1, i % 2 ? .5 : -.5); thud(t, .7, i % 2 ? .4 : -.4); });
impact(4, .7, -.2); stab(4, [41, 48, 53], 1.2);
impact(4.5, .8, .2); stab(4.5, [40, 47, 52], 1.2);
riser(4.6, 1.3, 1);
whoosh(5.42, .32, 1.3, 600, 9000, -.9, .9); impact(5.55, .9);

// 6: дроп
impact(6, 1.4); crash(6, 1.2);
for (let b = 6; b < 24; b += BAR) {
  const c = chordAt(b);
  pad(b, c.pad, BAR - .05, 1, b < 10 ? .8 : 1);
  for (let k = 0; k < 4; k++) kick(b + k * BEAT);
  clap(b + BEAT); clap(b + 3 * BEAT);
  for (let k = 0; k < 8; k++) { hat(b + k * .25 + .25, k === 7, .8, k % 2 ? .3 : -.2); bass(b + k * .25, c.root + (k === 6 ? 12 : 0), .2); }
  if (b >= 10) for (let k = 0; k < 16; k++) { const ns = c.pad, m = ns[k % ns.length] + (Math.floor(k / ns.length) % 2 ? 12 : 0); pluck(b + k * .125, m, b >= 12 && b < 14 ? .55 : .9, k % 2 ? .4 : -.4); }
}
// сцена 2
[0, 1, 2, 3, 4, 5].forEach(i => click(6.35 + i * .07 + .3, .5, (i - 2.5) * .2));
thud(7.0, 1); whoosh(6.95, .4, .5, 300, 3000);
for (let i = 0; i < 30; i++) key(7.15 + i * .02, .5);
whoosh(9.4, .62, 1.2, 200, 7000, 0, 0); impact(10, .6);
// сцена 3–4
for (let i = 0; i < 9; i++) tick(10.05 + i * .15 * (1 - i * .06), .6, 88 + i);
impact(11.5, .55, -.4);
click(12.15, 1);
const PROMPT = 'Составь PR-кампанию к открытию второй кофейни';
for (let i = 0; i < PROMPT.length; i++) key(12.25 + (i / PROMPT.length) * 1.5 + rnd() * .01, PROMPT[i] === ' ' ? 1.3 : 1);
click(14.0, 1.1); whoosh(14.05, .4, .45, 800, 5000, .3, -.2);
for (let t = 14.5; t < 17.2; t += .09) tick(t, .22, 100 + Math.floor((t * 7) % 5) * 2);
click(18.4, 1.1); ding(18.42, [77, 84], .5);
[18.45, 18.95, 19.45].forEach((t, i) => { whoosh(t, .55, .9, 400, 6000, -.6 + i * .1, .7); thud(t + .55, .9, .5); });
impact(20.1, .45, .4);
click(22.0, 1); ding(22.05, [72, 79], .9);
whoosh(23.45, .55, 1, 5000, 300, .8, -.8);
// сцена 5: брейкдаун и удар
pad(24, [53, 56, 60, 63], 2, .9, .45);
[24.05, 24.37, 24.69].forEach(t => thud(t, 1));
for (let t = 24.15; t < 25.2; t += .045) tick(t, .5, 98);
for (let k = 0; k < 16; k++) { const t = 25 + k * (k < 8 ? .0625 * 2 : .0625); if (t < 26) snare(t, .4 + k * .04); }
for (let t = 25.25; t < 26; t += .03 + (t - 25.25) * .04) tick(t, .7, 103);
riser(25, 1, 1.1);
impact(26, 1.5); crash(26, 1.3);
for (let b = 26; b < 36; b += BAR) {
  const c = chordAt(b);
  pad(b, c.pad, BAR - .05, 1.05, 1.1);
  for (let k = 0; k < 4; k++) kick(b + k * BEAT);
  clap(b + BEAT); clap(b + 3 * BEAT);
  for (let k = 0; k < 8; k++) { hat(b + k * .25 + .25, k === 7, .9, k % 2 ? .3 : -.2); bass(b + k * .25, c.root + (k % 4 === 3 ? 12 : 0), .2); }
  for (let k = 0; k < 16; k++) { const ns = c.pad; pluck(b + k * .125, ns[(k * 3) % ns.length] + 12, .55, k % 2 ? .5 : -.5); }
}
whoosh(27.35, 1.1, .7, 500, 2500, -.9, .9);
impact(28, .7, -.4); stab(28, [53, 60, 65], .8);
[30, 32, 34].forEach((t, i) => { impact(t, .9, [-.4, 0, .4][i]); crash(t, .5); thud(t, 1); });
whoosh(29.45, .55, .8, 300, 6000, .8, -.8); whoosh(31.6, .5, .7, 400, 5000, -.6, .6); whoosh(33.6, .5, .7, 400, 5000, -.6, .6);
riser(35.1, .9, .9);
// сцена 7: финал
impact(36, 1.6); crash(36, 1.4);
pad(36, [41, 48, 53, 56, 60, 67], 3.6, 1.6, 1.1);
bass(36, 29, 3.5, 1.2);
[53, 56, 60, 63, 67, 72].forEach((m, i) => pluck(36.25 + i * .25, m + 12, .8, i % 2 ? .4 : -.4));
thud(37.5, .7);
click(38, 1.2); ding(38.02, [72, 79, 84], 1.1);
pad(38, [44, 48, 51, 55], 1.8, .8, .8);
pad(40, [41, 48, 53, 56, 60], 1, .9, .7);

/* ---------- приглушение музыки под бочку ---------- */
const duck = new Float32Array(N).fill(1);
for (const t of KICKS) { const s0 = Math.round(t * SR); for (let i = 0; i < SR * .3 && s0 + i < N; i++) duck[s0 + i] = Math.min(duck[s0 + i], 1 - .55 * Math.exp(-i / SR * 9)); }

/* ---------- реверберация (гребенчатые + всепропускающие фильтры) ---------- */
function reverb(x, offs) {
  const combs = [1557, 1617, 1491, 1422].map(d => ({ b: new Float32Array(d + offs), i: 0, f: 0 }));
  const aps = [556, 441].map(d => ({ b: new Float32Array(d + offs), i: 0 }));
  const y = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    let s = 0;
    for (const c of combs) { const o = c.b[c.i]; c.f = o * .75 + c.f * .25; c.b[c.i] = x[n] + c.f * .84; c.i = (c.i + 1) % c.b.length; s += o; }
    for (const a of aps) { const o = a.b[a.i]; const v = -s + o; a.b[a.i] = s + o * .5; a.i = (a.i + 1) % a.b.length; s = v; }
    y[n] = s * .25;
  }
  return y;
}
const RL = reverb(REV[0], 0), RR = reverb(REV[1], 23);

/* ---------- сведение ---------- */
const L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i++) {
  L[i] = MUS[0][i] * duck[i] + DRM[0][i] * .9 + SFX[0][i] + RL[i] * .6;
  R[i] = MUS[1][i] * duck[i] + DRM[1][i] * .9 + SFX[1][i] + RR[i] * .6;
}
// мягкое ограничение и нормализация до −1 dBFS, плавный хвост в последние 0,4 с
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * .45); R[i] = Math.tanh(R[i] * .45); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const norm = .89 / peak;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (SR * .4));
  pcm.writeInt16LE(Math.round(L[i] * norm * fade * 32767), i * 4);
  pcm.writeInt16LE(Math.round(R[i] * norm * fade * 32767), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
writeFileSync(OUT + 'audio.wav', Buffer.concat([h, pcm]));
console.log(`audio.wav: ${LEN} с, пик до нормализации ${peak.toFixed(2)}`);
