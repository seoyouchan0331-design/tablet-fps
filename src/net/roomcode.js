/** Room codes without look-alike characters (no 0/O, 1/I): 4 characters for a duel, 5 for a party. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const cryptoBytes = (n) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

/** A duel room code (4 characters), or a party one (`n` = 5). */
export function makeRoomCode(randomBytes = cryptoBytes, n = 4) {
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ROOM_ALPHABET[b[i] % ROOM_ALPHABET.length];
  return s;
}

/** Party rooms (3-8 players) have 5-character codes. */
export function isPartyCode(s) {
  const c = normaliseRoomCode(s);
  return c.length === 5 && [...c].every((ch) => ROOM_ALPHABET.includes(ch));
}

export function normaliseRoomCode(s) {
  return String(s ?? '').trim().toUpperCase();
}

export function isRoomCode(s) {
  const c = normaliseRoomCode(s);
  return c.length === 4 && [...c].every((ch) => ROOM_ALPHABET.includes(ch));
}
