/**
 * StatsSystem — the player's record, kept on this device (localStorage).
 *
 * Counts only online play (duels and parties, bots included): kills,
 * deaths, headshot kills, matches and wins. XP from them gives a level,
 * shown next to the player's name in rooms and on the main menu.
 *
 * Fed by events every match already emits:
 *   'damage:dealt' { confirmed, killed, target, headshot }  a confirmed kill
 *                                                           (mine, or of me)
 *   'match:result' { win }                                  a match ended
 */
const KEY = 'tfps.stats';
export const XP = { kill: 100, headshot: 50, match: 150, win: 400 };

/** Level from XP: 300 XP for level 2, then each level a little further. */
export function levelFor(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 300)) + 1;
}

/** XP where a level starts. */
export const xpForLevel = (lv) => 300 * (lv - 1) ** 2;

const blank = () => ({ kills: 0, deaths: 0, headshots: 0, matches: 0, wins: 0, xp: 0 });

/** Percent / ratio lines for screens. */
export function summary(s) {
  const lv = levelFor(s.xp);
  return {
    level: lv,
    kd: s.deaths ? s.kills / s.deaths : s.kills,
    hs: s.kills ? (100 * s.headshots) / s.kills : 0,
    winRate: s.matches ? (100 * s.wins) / s.matches : 0,
    toNext: xpForLevel(lv + 1) - s.xp,
    ...s,
  };
}

export class StatsSystem {
  static id = 'stats';
  static deps = ['player'];

  async init(ctx) {
    this.ctx = ctx;
    this.data = this._load();
    this._offs = [
      ctx.events.on('damage:dealt', (e) => this._onDamage(e)),
      ctx.events.on('match:result', (e) => this._onResult(e)),
    ];
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (d && typeof d === 'object') return { ...blank(), ...d };
    } catch {
      /* private mode, or junk */
    }
    return blank();
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode: the record lives for this visit only */
    }
  }

  get level() {
    return levelFor(this.data.xp);
  }

  summary() {
    return summary(this.data);
  }

  _onDamage(e) {
    if (!e?.confirmed || !e.killed) return;
    const player = this.ctx.peek('player');
    const d = this.data;
    if (e.target === player || e.target?.isPlayer) {
      d.deaths++;
    } else {
      d.kills++;
      d.xp += XP.kill;
      if (e.headshot) {
        d.headshots++;
        d.xp += XP.headshot;
      }
    }
    this._save();
  }

  _onResult(e) {
    const d = this.data;
    d.matches++;
    d.xp += XP.match;
    if (e?.win) {
      d.wins++;
      d.xp += XP.win;
    }
    this._save();
  }

  dispose() {
    for (const off of this._offs) off?.();
  }
}
