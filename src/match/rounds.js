/**
 * Rounds mode — the duel's rules as a pure state machine, run by the host.
 *
 *   countdown (3 s) -> live (30 s) -> roundEnd (3 s pause) -> countdown ...
 *                                  \-> matchEnd once someone reaches winTarget
 *
 * One life per round. The first accepted kill ends the round (a second kill in
 * the same round — a trade — is ignored). If the timer runs out, the player with
 * more HP wins the round; equal HP is a draw and scores nothing. Sides swap
 * every round.
 *
 * Every transition returns Event objects for the host to broadcast:
 *   { type: 'countdown'|'live'|'roundEnd'|'matchEnd', round, score, winner? }
 */
export class RoundsMode {
  constructor({ winTarget = 5, roundTime = 30, countdown = 3, pause = 3 } = {}) {
    this.winTarget = winTarget;
    this.roundTime = roundTime;
    this.countdown = countdown;
    this.pause = pause;
    this.state = 'idle';
    this.round = 0;
    this.score = { host: 0, guest: 0 };
    this.timeLeft = 0;
    this.winner = null;
  }

  start() {
    this.round = 0;
    this.score = { host: 0, guest: 0 };
    this.winner = null;
    return this._nextRound();
  }

  _ev(type, extra = {}) {
    return { type, round: this.round, score: { ...this.score }, ...extra };
  }

  _nextRound() {
    this.round++;
    this.state = 'countdown';
    this.timeLeft = this.countdown;
    return [this._ev('countdown', { time: this.countdown })];
  }

  /** @param {{host:number, guest:number}} [hp] used only when the round timer expires */
  tick(dt, hp) {
    if (this.state === 'idle' || this.state === 'matchEnd') return [];
    this.timeLeft -= dt;
    if (this.timeLeft > 1e-9) return [];
    if (this.state === 'countdown') {
      this.state = 'live';
      this.timeLeft = this.roundTime;
      return [this._ev('live', { time: this.roundTime })];
    }
    if (this.state === 'live') {
      const h = hp?.host ?? 0;
      const g = hp?.guest ?? 0;
      return this._endRound(h > g ? 'host' : g > h ? 'guest' : null);
    }
    if (this.state === 'roundEnd') return this._nextRound();
    return [];
  }

  /** @param {'host'|'guest'} victim */
  kill(victim) {
    if (this.state !== 'live') return [];
    return this._endRound(victim === 'host' ? 'guest' : 'host');
  }

  _endRound(winner) {
    if (winner) this.score[winner]++;
    const out = [this._ev('roundEnd', { winner })];
    if (winner && this.score[winner] >= this.winTarget) {
      this.state = 'matchEnd';
      this.winner = winner;
      out.push(this._ev('matchEnd', { winner }));
    } else {
      this.state = 'roundEnd';
      this.timeLeft = this.pause;
    }
    return out;
  }

  /** Spawn index (0 or 1) for a role this round; sides swap each round. */
  spawnFor(role) {
    const flip = Math.max(0, this.round - 1) % 2;
    return role === 'host' ? flip : 1 - flip;
  }
}
