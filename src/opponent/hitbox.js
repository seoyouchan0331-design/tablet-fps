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
