/**
 * Duel wire protocol. Every message is a flat JSON object with a `type` from
 * MSG; bodies are plain data. `decode` is the single gate for anything that
 * came off the network: it returns null instead of throwing.
 */
export const MSG = Object.freeze({
  HELLO: 'hello',
  SETTINGS: 'settings',
  LOADOUT: 'loadout',
  READY: 'ready',
  STATE: 'state',
  FIRE: 'fire',
  HIT: 'hit',
  HP: 'hp',
  ROUND: 'round',
  MATCH: 'match',
  REMATCH: 'rematch',
  BYE: 'bye',
  PING: 'ping',
  PONG: 'pong',
  NADE: 'nade',
  CHAT: 'chat',
  HEAL: 'heal',
});

const TYPES = new Set(Object.values(MSG));

export function encode(type, body = {}) {
  return JSON.stringify({ ...body, type });
}

export function decode(str) {
  let o;
  try {
    o = typeof str === 'string' ? JSON.parse(str) : str;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o) || !TYPES.has(o.type)) return null;
  return o;
}
