/** The two weapons a player carries into a match: a primary and the pistol. */
export class Loadout {
  static PRIMARIES = ['rifle', 'smg'];

  constructor(primary = 'rifle') {
    if (!Loadout.PRIMARIES.includes(primary)) throw new Error(`invalid primary "${primary}"`);
    this.primary = primary;
    this.secondary = 'pistol';
  }

  ids() {
    return [this.primary, this.secondary];
  }

  /** The weapon SWAP goes to from `id`. */
  other(id) {
    return id === this.primary ? this.secondary : this.primary;
  }
}
