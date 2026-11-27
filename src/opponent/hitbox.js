/**
 * Duel hitboxes and damage. Shared by the practice dummy (Phase 1) and the
 * networked opponent (Phase 2). Heights are metres above the feet.
 *
 * Radii are scaled up 15 % over a realistic body: touch aiming is coarse, and
 * "I clearly hit him" must hold on a tablet.
 */
export const HITBOX_BASE = {
  head: { radius: 0.13, y: 1.62 },
  body: { radius: 0.24, y0: 0.35, y1: 1.38 },
};

const S = 1.15;

export const HITBOX = {
  scale: S,
  head: { radius: HITBOX_BASE.head.radius * S, y: HITBOX_BASE.head.y },
  body: { radius: HITBOX_BASE.body.radius * S, y0: HITBOX_BASE.body.y0, y1: HITBOX_BASE.body.y1 },
};

export const MAX_HP = 100;
export const HEADSHOT_MULT = 2;

/** One hit. Returns the new hp, whether this hit killed, and damage actually dealt. */
export function applyDamage(hp, base, part) {
  if (hp <= 0) return { hp: 0, killed: false, amount: 0 };
  const raw = part === 'head' ? base * HEADSHOT_MULT : base;
  const amount = Math.min(hp, raw);
  const next = hp - amount;
  return { hp: next, killed: next <= 0, amount };
}

/** Crouched heights (metres above the feet); the player's crouch eye is ~1.02 m. */
export const HITBOX_CROUCH = { headY: 1.06, bodyY1: 0.84 };

/**
 * Hitbox heights for a crouch amount k (0 standing .. 1 fully crouched).
 * @returns {{headY:number, bodyY0:number, bodyY1:number}}
 */
export function hitboxAt(k) {
  const t = Math.min(1, Math.max(0, k));
  return {
    headY: HITBOX.head.y + (HITBOX_CROUCH.headY - HITBOX.head.y) * t,
    bodyY0: HITBOX.body.y0,
    bodyY1: HITBOX.body.y1 + (HITBOX_CROUCH.bodyY1 - HITBOX.body.y1) * t,
  };
}
