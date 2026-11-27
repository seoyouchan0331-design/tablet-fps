/** 4-character room codes without look-alike characters (no 0/O, 1/I). */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const cryptoBytes = (n) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

export function makeRoomCode(randomBytes = cryptoBytes) {
  const b = randomBytes(4);
  let s = '';
  for (let i = 0; i < 4; i++) s += ROOM_ALPHABET[b[i] % ROOM_ALPHABET.length];
  return s;
}

export function normaliseRoomCode(s) {
  return String(s ?? '').trim().toUpperCase();
}

export function isRoomCode(s) {
  const c = normaliseRoomCode(s);
  return c.length === 4 && [...c].every((ch) => ROOM_ALPHABET.includes(ch));
}
