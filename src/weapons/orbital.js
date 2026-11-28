/**
 * OrbitalSystem — the orbital laser, a power weapon a map places
 * (layout.power: { x, y, z }).
 *
 * It appears on its spot (a slow glowing orb in a light column). Whoever
 * walks into it holds it: a LASER button shows (key F). Pressing it calls a
 * beam down from the sky for BEAM.time seconds: the beam's foot follows the
 * crosshair's point on the world, but lags behind it (BEAM.speed m/s), and
 * burns anyone within BEAM.radius of it. Everyone sees the beam coming.
 * Die holding it and it drops where you fell, for a little while.
 *
 * Who decides:
 *   - in a party match, the host (party/index.js `_hostPower`): spawns,
 *     pickups, the beam's life and its damage; this system draws what the
 *     host says (`setState`) and, for the holder, aims the beam and reports
 *     its foot (`party.orbitalAim`);
 *   - alone (practice), this system runs the same life cycle locally (no
 *     damage: there is nobody to burn).
 */
import * as THREE from 'three';

export const BEAM = { time: 6, speed: 7, radius: 1.8, tick: 0.25, damage: 12, every: 90, first: 30, drop: 10, warn: 10 };

const CSS = `
.ow-orbital { position: fixed; right: calc(7% + 270px); bottom: calc(26% + 150px); z-index: 30;
  min-width: 112px; height: 52px; border-radius: 26px; border: 2px solid #ff5a3c;
  background: rgba(40,8,4,.72); color: #ffd9cf; font: 800 15px "Inter","Helvetica Neue",Arial,sans-serif;
  letter-spacing: .08em; display: none; align-items: center; justify-content: center; padding: 0 18px;
  box-shadow: 0 0 18px rgba(255,90,60,.55); touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer; }
.ow-orbital.on { display: flex; }
.ow-orbital.firing { background: #ff5a3c; color: #1a0400; }
`;

export class OrbitalSystem {
  static id = 'orbital';
  static deps = ['world', 'player', 'physics'];

  async init(ctx) {
    this.ctx = ctx;
    this._map = null;
    /** What everyone sees: { at: [x,y,z] | null, holder: id | null, beam: [x,y,z] | null } */
    this.state = { at: null, holder: null, beam: null };
    this.me = 'me'; // my id in this state (a party id in a match)
    this._aim = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._local = null; // practice: { next, until }

    const root = (this.root = new THREE.Group());
    root.name = 'orbital';
    ctx.scene.add(root);
    const red = (this._red = new THREE.MeshBasicMaterial({ color: 0xff5a3c, toneMapped: false }));
    const glow = (this._glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a5c, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    // the pickup: an orb in a column of light
    this._orbGeo = new THREE.IcosahedronGeometry(0.42, 1);
    this._colGeo = new THREE.CylinderGeometry(0.55, 0.7, 6, 20, 1, true);
    this.orb = new THREE.Group();
    const orb = new THREE.Mesh(this._orbGeo, red);
    orb.position.y = 1.1;
    const col = new THREE.Mesh(this._colGeo, glow);
    col.position.y = 3;
    this.orb.add(orb, col);
    this.orb.visible = false;
    this._orbMesh = orb;
    // the beam: a core and a halo from high in the sky to its foot, a ring on the ground
    this._coreGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 16, 1, true);
    this._haloGeo = new THREE.CylinderGeometry(1.4, 1.8, 1, 24, 1, true);
    this._ringGeo = new THREE.RingGeometry(BEAM.radius - 0.15, BEAM.radius, 40);
    this._ringGeo.rotateX(-Math.PI / 2);
    this.beam = new THREE.Group();
    const core = new THREE.Mesh(this._coreGeo, new THREE.MeshBasicMaterial({ color: 0xfff0e8, toneMapped: false }));
    const halo = new THREE.Mesh(this._haloGeo, glow);
    const ring = new THREE.Mesh(this._ringGeo, red);
    this._beamParts = { core, halo, ring };
    this.beam.add(core, halo, ring);
    this.beam.visible = false;
    root.add(this.orb, this.beam);

    // the LASER button (touch) and key F
    this._style = document.createElement('style');
    this._style.textContent = CSS;
    document.head.appendChild(this._style);
    this.button = document.createElement('div');
    this.button.className = 'ow-orbital';
    this.button.textContent = 'LASER';
    this.button.dataset.act = 'orbital';
    document.body.appendChild(this.button);
    this._onPress = (e) => {
      e.preventDefault?.();
      e.stopPropagation?.();
      this.fire();
    };
    this.button.addEventListener('pointerdown', this._onPress);
    this._onKey = (e) => {
      if (e.code === 'KeyF' && !e.repeat) this.fire();
    };
    addEventListener('keydown', this._onKey);
  }

  /** Is a party match deciding (not this system)? */
  _party() {
    return this.ctx.peek('party')?.phase === 'match' ? this.ctx.peek('party') : null;
  }

  /** The host's word (party): what to draw and who holds it. */
  setState(s, me) {
    const was = this.state;
    this.state = { at: s.at ?? null, holder: s.holder ?? null, beam: s.beam ?? null };
    this.me = me;
    // my own beam: the host only relays it; keep my local foot so it doesn't jump back
    if (this.state.holder === me && was.beam && this.state.beam) this.state.beam = was.beam;
    if (this.state.holder === me && !was.beam && this.state.beam) this._aimFrom(this.state.beam);
  }

  /** Press: the holder calls the beam down. */
  fire() {
    const s = this.state;
    if (s.holder !== this.me || s.beam) return;
    const party = this._party();
    if (party) return party.orbitalFire();
    // practice
    const P = this.ctx.peek('player')?.position;
    if (!P) return;
    s.beam = [P.x, P.y, P.z];
    this._aimFrom(s.beam);
    this._local.until = this._clock + BEAM.time;
  }

  _aimFrom(b) {
    this._foot = new THREE.Vector3(b[0], b[1], b[2]);
  }

  /** Where the crosshair meets the world. */
  _crosshairPoint() {
    const player = this.ctx.peek('player');
    const physics = this.ctx.peek('physics');
    if (!player || !physics) return null;
    const eye = player.eyePosition, f = player.forward;
    const hit = physics.raycast(eye.x, eye.y, eye.z, f.x, f.y, f.z, 80, physics.MASK?.WORLD);
    if (hit?.hit) return this._aim.copy(hit.point);
    // aiming at the sky: the point straight ahead, dropped to the deck
    return this._aim.set(eye.x + f.x * 30, 0, eye.z + f.z * 30);
  }

  _practice(dt) {
    const L = this.ctx.peek('world')?.layout;
    const s = this.state;
    this._local ??= { next: this._clock + 3, until: 0 };
    const loc = this._local;
    if (!L?.power) return;
    this.me = 'me';
    if (!s.at && s.holder == null && this._clock >= loc.next) s.at = [L.power.x, L.power.y, L.power.z];
    const P = this.ctx.peek('player')?.position;
    if (s.at && P && Math.hypot(P.x - s.at[0], P.z - s.at[2]) < 1.3 && Math.abs(P.y - s.at[1]) < 1.5) {
      s.at = null;
      s.holder = 'me';
      this.ctx.peek('ui')?.banner?.show?.('Orbital laser', 'Press LASER');
    }
    if (s.beam && this._clock >= loc.until) {
      s.beam = null;
      s.holder = null;
      loc.next = this._clock + 10; // practice: back soon
    }
  }

  update(dt, ctx) {
    this._clock = (this._clock ?? 0) + dt;
    const world = ctx.peek('world');
    if (world?.mapId !== this._map) {
      this._map = world?.mapId;
      this.state = { at: null, holder: null, beam: null };
      this._local = null;
    }
    const party = this._party();
    if (!party && world?.layout?.power) this._practice(dt);
    else if (!party) this.state = { at: null, holder: null, beam: null };

    const s = this.state;
    // my beam: its foot chases the crosshair
    if (s.beam && s.holder === this.me && this._foot) {
      const want = this._crosshairPoint();
      if (want) {
        const d = this._dir.subVectors(want, this._foot);
        const len = d.length();
        const step = BEAM.speed * dt;
        if (len > step) this._foot.addScaledVector(d, step / len);
        else this._foot.copy(want);
      }
      s.beam = [this._foot.x, this._foot.y, this._foot.z];
      party?.orbitalAim?.(s.beam);
    }

    // draw
    this.orb.visible = !!s.at;
    if (s.at) {
      this.orb.position.set(s.at[0], s.at[1], s.at[2]);
      this._orbMesh.rotation.y += dt * 1.5;
      this._orbMesh.position.y = 1.1 + Math.sin(this._clock * 2.2) * 0.12;
    }
    this.beam.visible = !!s.beam;
    if (s.beam) {
      const H = 90;
      const { core, halo, ring } = this._beamParts;
      this.beam.position.set(s.beam[0], s.beam[1], s.beam[2]);
      core.scale.set(1 + Math.sin(this._clock * 30) * 0.15, H, 1 + Math.sin(this._clock * 30) * 0.15);
      core.position.y = H / 2;
      halo.scale.set(1, H, 1);
      halo.position.y = H / 2;
      ring.position.y = 0.06;
      ring.rotation.y += dt * 2;
    }
    const mine = s.holder === this.me;
    this.button.classList.toggle('on', mine && !ctx.peek('player')?.health?.dead);
    this.button.classList.toggle('firing', mine && !!s.beam);
    this.button.textContent = mine && s.beam ? 'FIRING' : 'LASER';
  }

  dispose() {
    this.ctx.scene.remove(this.root);
    this.button.removeEventListener('pointerdown', this._onPress);
    removeEventListener('keydown', this._onKey);
    this.button.remove();
    this._style.remove();
    for (const g of [this._orbGeo, this._colGeo, this._coreGeo, this._haloGeo, this._ringGeo]) g.dispose();
    this._red.dispose();
    this._glowMat.dispose();
    this._beamParts.core.material.dispose();
  }
}
