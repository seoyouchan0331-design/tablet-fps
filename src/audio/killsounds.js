/**
 * Hit and kill confirmation sounds.
 *
 * Like the kill sounds that come with weapon skins in modern tactical
 * shooters, they come in packs the player picks in Controls, and each kill in
 * a match climbs a step higher (1..5) so a run of kills builds. The 5th kill
 * adds a "final" layer on top.
 *
 *   neon     synthesised here: a rising chime arpeggio, one more note per kill
 *   chime    bell + glass        (100 CC0 SFX, OpenGameArt)
 *   arcade   coin + fanfare      (The Essential Retro Video Game SFX
 *                                 Collection, Juhani Junkala, CC0)
 *   impact   metal hit + gong    (100 CC0 SFX, OpenGameArt)
 *
 * Every pack shares the body-hit tick; the headshot ding is per pack.
 * Files live in public/sfx/ui (see public/sfx/LICENSE-sfx.md).
 */

export const KILL_PACKS = {
  neon: { label: 'NEON', color: '#3df2ff', files: null },
  chime: { label: 'CHIME', color: '#ffd75e', files: { kill: 'chime_kill', final: 'chime_final', head: 'chime_head' } },
  arcade: { label: 'ARCADE', color: '#7dff6b', files: { kill: 'arcade_kill', final: 'arcade_final', head: 'arcade_head' } },
  impact: { label: 'IMPACT', color: '#ff6a3d', files: { kill: 'impact_kill', final: 'impact_final', head: 'impact_head' } },
};
export const PACK_IDS = Object.keys(KILL_PACKS);

/** Kill number in this match -> level 1..5. */
export function killLevel(n) {
  return Math.max(1, Math.min(5, Math.floor(n) || 1));
}

/** Semitones per level: a major pentatonic climb (0 2 4 7 9). */
const STEPS = [0, 2, 4, 7, 9];
/** Playback rate for a sample at `level` (each kill a step higher). */
export function killRate(level) {
  return 2 ** (STEPS[killLevel(level) - 1] / 12);
}

/* ------------------------------------------------------------- synthesis -- */

function finish(out, peakTo) {
  const fade = Math.min(out.length, 600);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= (i / fade) ** 2;
  out[out.length - 1] = 0;
  let p = 0;
  for (let i = 0; i < out.length; i++) p = Math.max(p, Math.abs(out[i]));
  if (p > 0) for (let i = 0; i < out.length; i++) out[i] *= peakTo / p;
  return out;
}

/** A bell-ish note: sine + a quieter octave + a soft inharmonic shimmer. */
function note(out, sr, start, f, dur, gain) {
  const n = Math.floor(dur * sr);
  const s0 = Math.floor(start * sr);
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.002) * Math.exp(-t / (dur * 0.32));
    const w = 2 * Math.PI * f * t;
    out[s0 + i] += gain * env * (Math.sin(w) + 0.35 * Math.sin(2 * w) + 0.12 * Math.sin(2.76 * w));
  }
}

const ROOT = 880; // A5

/** Neon kill: `level` notes rising up the pentatonic, the last one held. */
export function synthKill(level, sr) {
  const l = killLevel(level);
  const gap = 0.055;
  const tail = 0.32 + l * 0.04;
  const out = new Float32Array(Math.floor(sr * ((l - 1) * gap + tail)));
  for (let i = 0; i < l; i++) {
    const f = ROOT * 2 ** (STEPS[i] / 12);
    const last = i === l - 1;
    note(out, sr, i * gap, f, last ? tail : 0.16, last ? 1 : 0.6);
    if (last && l === 5) note(out, sr, i * gap, f * 1.5, tail, 0.45); // the 5th adds a fifth on top
  }
  return finish(out, 0.9);
}

/** Body hit: a tiny dry tick. */
export function synthHitTick(sr) {
  const out = new Float32Array(Math.floor(sr * 0.04));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t / 0.008);
  }
  return finish(out, 0.45);
}

/** Headshot: a bright two-partial ding, clearly not the body tick. */
export function synthHeadDing(sr) {
  const out = new Float32Array(Math.floor(sr * 0.22));
  note(out, sr, 0, 2637, 0.22, 1); // E7
  note(out, sr, 0, 3951, 0.12, 0.4);
  return finish(out, 0.7);
}
