/**
 * Offline synthesis of the duel's only two kinds of sound: gunshots and
 * footsteps. Everything is rendered once into Float32Arrays when audio starts,
 * so playing a shot is a single AudioBufferSourceNode — nothing for an iPad to
 * compute per shot, and no live noise generators that could hiss.
 *
 * A shot is four short layers, each band-limited so nothing reads as static:
 *   click   ~3 ms high transient — the "snap" that makes it feel immediate
 *   crack   band-passed burst at the weapon's pitch — its character
 *   thump   a falling sine — the punch in the chest
 *   tail    low-passed decay — a short boom, not a reverb wash
 * then a soft saturator, a 30 Hz high-pass (no sub rumble), a fade to exact
 * zero and peak normalisation.
 */

/** Per-weapon recipes. Times in seconds, frequencies in Hz. */
export const SHOT_PROFILES = {
  rifle: { len: 0.42, click: 0.5, crackHz: 1900, crackQ: 0.9, crackTau: 0.016, crack: 0.85,
    f0: 150, f1: 55, thumpTau: 0.045, thump: 0.95, tailHz: 950, tailTau: 0.075, tail: 0.42, drive: 1.6, peak: 0.9 },
  smg: { len: 0.3, click: 0.45, crackHz: 2500, crackQ: 1.0, crackTau: 0.011, crack: 0.8,
    f0: 170, f1: 72, thumpTau: 0.03, thump: 0.6, tailHz: 1250, tailTau: 0.05, tail: 0.3, drive: 1.5, peak: 0.82 },
  pistol: { len: 0.34, click: 0.55, crackHz: 2200, crackQ: 1.0, crackTau: 0.013, crack: 0.8,
    f0: 160, f1: 62, thumpTau: 0.036, thump: 0.75, tailHz: 1050, tailTau: 0.06, tail: 0.36, drive: 1.6, peak: 0.86 },
  shotgun: { len: 0.62, click: 0.45, crackHz: 1150, crackQ: 0.75, crackTau: 0.026, crack: 0.8,
    f0: 115, f1: 40, thumpTau: 0.085, thump: 1.25, tailHz: 620, tailTau: 0.14, tail: 0.6, drive: 1.9, peak: 0.93 },
  sniper: { len: 0.85, click: 0.65, crackHz: 2700, crackQ: 0.8, crackTau: 0.02, crack: 1.0,
    f0: 125, f1: 38, thumpTau: 0.08, thump: 1.2, tailHz: 720, tailTau: 0.2, tail: 0.55, drive: 1.9, peak: 0.94 },
};

/** Weapon id / def / class name -> recipe. Unknown guns sound like the rifle. */
export function profileFor(w) {
  const k = String((typeof w === 'string' ? w : w?.id ?? w?.class) ?? '').toLowerCase();
  if (SHOT_PROFILES[k]) return SHOT_PROFILES[k];
  if (/shot/.test(k)) return SHOT_PROFILES.shotgun;
  if (/snip/.test(k)) return SHOT_PROFILES.sniper;
  if (/smg/.test(k)) return SHOT_PROFILES.smg;
  if (/pistol/.test(k)) return SHOT_PROFILES.pistol;
  return SHOT_PROFILES.rifle;
}

/* ------------------------------------------------------------------ dsp -- */

function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad, run in place. type: 'lp' | 'hp' | 'bp' */
function biquad(buf, type, f, q, sr) {
  const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
  b0 /= a0; b1 /= a0; b2 /= a0;
  const c1 = a1 / a0, c2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
  return buf;
}

function noise(n, rnd) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = rnd() * 2 - 1;
  return b;
}

/** Add `src * env(t)` into `out`, where env is a 0.4 ms attack then exp(-t/tau). */
function addDecay(out, src, gain, tau, sr, start = 0) {
  const atk = sr * 0.0004;
  for (let i = 0; i < src.length && i + start < out.length; i++) {
    const e = (i < atk ? i / atk : 1) * Math.exp(-i / (tau * sr));
    out[i + start] += src[i] * e * gain;
  }
}

/** Common end of chain: saturate, high-pass, fade to exact zero, normalise. */
function finish(out, sr, drive, peakTo, fadeS) {
  const k = Math.tanh(drive);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * drive) / k;
  biquad(out, 'hp', 30, 0.707, sr);
  const fade = Math.floor(sr * fadeS);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= (i / fade) ** 2;
  out[out.length - 1] = 0;
  let p = 0;
  for (let i = 0; i < out.length; i++) p = Math.max(p, Math.abs(out[i]));
  if (p > 0) for (let i = 0; i < out.length; i++) out[i] *= peakTo / p;
  return out;
}

/* ----------------------------------------------------------------- shots -- */

/** @returns {Float32Array} mono samples at `sr` */
export function synthShot(p, sr, seed = 1) {
  const rnd = mulberry(seed * 9973 + 17);
  const n = Math.floor(p.len * sr);
  const out = new Float32Array(n);
  const vary = (amt) => 1 + (rnd() * 2 - 1) * amt; // per-variant colour

  // click
  addDecay(out, biquad(noise(Math.floor(sr * 0.006), rnd), 'hp', 2500, 0.7, sr), p.click, 0.0012, sr);
  // crack
  const crackLen = Math.min(n, Math.floor(sr * p.crackTau * 7));
  addDecay(out, biquad(noise(crackLen, rnd), 'bp', p.crackHz * vary(0.06), p.crackQ, sr), p.crack * 2.2, p.crackTau, sr);
  // thump: exponential pitch drop f0 -> f1
  const thumpLen = Math.min(n, Math.floor(sr * p.thumpTau * 7));
  const th = new Float32Array(thumpLen);
  const f0 = p.f0 * vary(0.04);
  let ph = 0;
  for (let i = 0; i < thumpLen; i++) {
    const t = i / sr;
    const f = p.f1 + (f0 - p.f1) * Math.exp(-t / (p.thumpTau * 0.6));
    ph += (2 * Math.PI * f) / sr;
    th[i] = Math.sin(ph);
  }
  addDecay(out, th, p.thump, p.thumpTau, sr);
  // tail: two-pole low-passed decay, starting just after the crack
  const tailStart = Math.floor(sr * 0.004);
  const tailLen = n - tailStart;
  const tail = biquad(biquad(noise(tailLen, rnd), 'lp', p.tailHz * vary(0.05), 0.6, sr), 'lp', p.tailHz * 1.4, 0.6, sr);
  addDecay(out, tail, p.tail * 3, p.tailTau, sr, tailStart);

  return finish(out, sr, p.drive, p.peak, Math.min(0.12, p.len * 0.3));
}

/* ------------------------------------------------------------- footsteps -- */

const STEP = {
  walk: { len: 0.12, thump: 0.5, f0: 95, scuff: 0.32, scuffHz: 950, peak: 0.34 },
  run: { len: 0.12, thump: 0.6, f0: 100, scuff: 0.42, scuffHz: 1100, peak: 0.45 },
  crouch: { len: 0.1, thump: 0.4, f0: 90, scuff: 0.18, scuffHz: 800, peak: 0.18 },
  land: { len: 0.22, thump: 0.9, f0: 80, scuff: 0.45, scuffHz: 700, peak: 0.62 },
};

/** A rubber sole on concrete: low heel thud + a soft, short scuff. */
export function synthStep(kind, sr, seed = 1) {
  const s = STEP[kind] ?? STEP.walk;
  const rnd = mulberry(seed * 7919 + 3);
  const n = Math.floor(s.len * sr);
  const out = new Float32Array(n);
  const tau = s.len * 0.2;
  const th = new Float32Array(n);
  let ph = 0;
  const f0 = s.f0 * (0.92 + rnd() * 0.16);
  for (let i = 0; i < n; i++) {
    const f = 55 + (f0 - 55) * Math.exp(-i / (sr * tau * 0.5));
    ph += (2 * Math.PI * f) / sr;
    th[i] = Math.sin(ph);
  }
  addDecay(out, th, s.thump, tau, sr);
  const sc = biquad(biquad(noise(Math.floor(sr * 0.05), rnd), 'bp', s.scuffHz * (0.9 + rnd() * 0.2), 1.1, sr), 'lp', 3000, 0.7, sr);
  addDecay(out, sc, s.scuff * 2, 0.012, sr, Math.floor(sr * 0.003));
  return finish(out, sr, 1.2, s.peak, 0.03);
}
