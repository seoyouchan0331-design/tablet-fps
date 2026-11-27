/**
 * Shotgun pellet pattern. One pellet on the aim point, the rest on a sunflower
 * (golden-angle) spiral so the cone is evenly covered, with a little jitter and
 * a random roll so no two shots are identical. Offsets are in units of the cone
 * radius (0 centre .. 1 edge); the caller scales them by tan(spread).
 *
 * @param {number} n pellets
 * @param {{float:()=>number}} rng
 * @returns {{x:number,y:number}[]}
 */
export function pelletOffsets(n, rng) {
  const out = [{ x: 0, y: 0 }];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const roll = rng.float() * Math.PI * 2;
  for (let i = 1; i < n; i++) {
    const r = Math.min(1, Math.sqrt((i + 0.35) / n) * (0.92 + rng.float() * 0.08));
    const a = roll + i * golden + (rng.float() - 0.5) * 0.25;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
}
