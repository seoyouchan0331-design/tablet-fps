/** The two weapons a player carries into a match: a primary and a secondary. */
export class Loadout {
  static PRIMARIES = ['rifle', 'smg', 'shotgun', 'sniper'];
  /** Secondaries: the pistol, or a second gun (not the primary again). */
  static SECONDARIES = ['pistol', 'smg', 'shotgun'];

  constructor(primary = 'rifle', secondary = 'pistol') {
    if (!Loadout.PRIMARIES.includes(primary)) throw new Error(`invalid primary "${primary}"`);
    this.primary = primary;
    this.secondary = Loadout.SECONDARIES.includes(secondary) && secondary !== primary ? secondary : 'pistol';
  }

  ids() {
    return [this.primary, this.secondary];
  }

  /** The weapon SWAP goes to from `id`. */
  other(id) {
    return id === this.primary ? this.secondary : this.primary;
  }
}
