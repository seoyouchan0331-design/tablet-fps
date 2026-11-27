/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;

/** Real-world units are metres, seconds, kilograms. */
export const UNITS = {
  gravity: -9.81 * 2.1, // Games use exaggerated gravity; CoD-like feel.
  playerHeight: 1.78,
  playerCrouchHeight: 1.12,
  playerRadius: 0.32,
  eyeOffset: 0.12, // below top of capsule
};

export const QUALITY_PRESETS = {
  // Tablets / phones: integrated GPUs at DPR 2. Everything screen-space is off,
  // the pixel ratio is pinned to 1 and dynamic resolution trims the rest.
  mobile: {
    /** Tablet: the lite forward renderer (src/render/lite.js), no sky. */
    lite: true,
    renderScale: 0.75,
    /** Dynamic resolution starts at renderScale and may climb to this. */
    dynresMax: 1,
    /** Never shade more than this many pixels (iPad Retina is ~4 M at DPR 2). */
    pixelBudget: 2.3e6,
    maxPixelRatio: 2,
    shadowMapSize: 1024,
    cascades: 1,
    shadowDistance: 45,
    // Kept on: sky's aerial-perspective composite always reads depth, and
    // without it every pixel below the horizon fogs over. Cheap in the arena.
    prepass: true,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: false,
    anisotropy: 2,
    particleBudget: 800,
    decalBudget: 32,
  },
  low: {
    renderScale: 0.72,
    maxPixelRatio: 1.5,
    prepass: true,
    shadowMapSize: 1024,
    cascades: 3,
    shadowDistance: 60,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    anisotropy: 4,
    particleBudget: 2000,
    decalBudget: 64,
  },
  medium: {
    renderScale: 0.85,
    maxPixelRatio: 1.5,
    prepass: true,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 90,
    taa: true,
    gtao: true,
    ssr: false,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 8,
    particleBudget: 6000,
    decalBudget: 128,
  },
  high: {
    renderScale: 1.0,
    maxPixelRatio: 1.5,
    prepass: true,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 140,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 12000,
    decalBudget: 256,
  },
  ultra: {
    renderScale: 1.0,
    maxPixelRatio: 1.5,
    prepass: true,
    shadowMapSize: 4096,
    cascades: 4,
    shadowDistance: 200,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 24000,
    decalBudget: 512,
  },
};

export const DEFAULTS = {
  quality: 'ultra',
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensScale: 0.65,
  invertY: false,
  exposure: 1.0,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
  /** Touch controls + touch-first defaults. Set in main.js from detectTouch(). */
  touch: false,
  /** Adjust renderScale at runtime to hold the frame-rate target. */
  dynamicResolution: false,
  touchSensitivity: 0.0045,
  /** Touch aim assist: 'off' | 'low' | 'medium'. */
  aimAssist: 'low',
};

/**
 * True on a touch-first device (tablet with or without a keyboard, but no mouse).
 * `?touch=1` / `?touch=0` forces it either way.
 */
export function detectTouch(params) {
  const forced = params?.get?.('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const mm = (q) => globalThis.matchMedia?.(q)?.matches ?? false;
  const points = globalThis.navigator?.maxTouchPoints ?? 0;
  return mm('(pointer: coarse)') || (points > 0 && !mm('(any-pointer: fine)'));
}

/** Touch devices (tablets) boot on the mobile preset; everything else keeps ultra. */
export function pickDefaultQuality({ touch }) {
  return touch ? 'mobile' : DEFAULTS.quality;
}

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };
  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
  };
  return cfg;
}
