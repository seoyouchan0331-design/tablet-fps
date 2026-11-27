/**
 * How two players' devices find each other across the internet.
 *
 * WebRTC first tries a DIRECT path (STUN tells each side its public address and
 * the two punch through their routers). That works on most home Wi-Fi. Some
 * networks — many phone hotspots / mobile carriers, school and office Wi-Fi —
 * don't allow it; then the traffic must go through a RELAY (TURN server).
 *
 * PeerJS ships with Google STUN plus its own free TURN relays in the EU and
 * US. Those work but add a lot of ping from Asia. A closer relay can be
 * plugged in at build time from a Metered (metered.ca) TURN app:
 *
 *   VITE_METERED_APP=<app name>  VITE_METERED_KEY=<API key>
 *
 * (GitHub repository variables METERED_APP / METERED_KEY, see pages.yml).
 * Without them, or if the credential fetch fails, PeerJS's defaults are used.
 */
const STUN = { urls: 'stun:stun.l.google.com:19302' };

/**
 * @returns {Promise<RTCIceServer[]|null>} null = use PeerJS's own defaults
 */
export async function iceServers({ meteredApp, meteredKey, fetchFn = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (!meteredApp || !meteredKey || !fetchFn) return null;
  const url = `https://${meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(meteredKey)}`;
  try {
    const res = await Promise.race([
      fetchFn(url),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), timeoutMs)),
    ]);
    if (!res?.ok) return null;
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return null;
    return [STUN, ...list];
  } catch {
    return null;
  }
}

/** Build-time settings (Vite env); empty when not configured. */
export function buildIceConfig() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  return { meteredApp: env.VITE_METERED_APP || '', meteredKey: env.VITE_METERED_KEY || '' };
}

/**
 * From RTCPeerConnection.getStats(): is the live path direct or relayed?
 * @param {Map|RTCStatsReport} stats
 * @returns {'direct'|'relay'|'unknown'}
 */
export function routeFromStats(stats) {
  let pair = null;
  const byId = new Map();
  stats.forEach((s) => {
    byId.set(s.id ?? '', s);
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = s;
  });
  if (!pair) return 'unknown';
  const find = (id) => {
    for (const s of stats.values ? stats.values() : []) if (s.id === id) return s;
    return byId.get(id);
  };
  const l = find(pair.localCandidateId);
  const r = find(pair.remoteCandidateId);
  if (!l || !r) return 'unknown';
  return l.candidateType === 'relay' || r.candidateType === 'relay' ? 'relay' : 'direct';
}

/** Round-trip time smoothing: steady, but a single spike barely moves it. */
export function smoothRtt(prev, sample) {
  if (prev == null) return sample;
  const s = Math.min(sample, prev * 2 + 30); // clip spikes
  return prev + (s - prev) * 0.25;
}
