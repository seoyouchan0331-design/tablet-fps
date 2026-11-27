/**
 * Developer test panel — everything testable from one place, solo, on a
 * tablet. Enabled by `?dev=1` or `window.__DEV__ = true` (the dev artifact
 * sets it). Never shown to players.
 *
 *   MAP       load any map (practice keeps running on it)
 *   WEAPON    draw any gun
 *   PLAYER    god mode, infinite ammo, spawn A/B, game speed
 *   DUMMY     freeze, put it 10 m in front, its gun, fire/reload/crouch/aim,
 *             show hitboxes
 *   FEEDBACK  kill banner 1-5, every kill-sound pack, hit/headshot sounds,
 *             death recap, killcam toward the dummy, round-pick strip, scope
 *   STATS     fps, draw calls, triangles, map, position
 */
import * as THREE from 'three';
import { MAPS, MAP_IDS } from '../arena/layout.js';
import { KILL_PACKS, PACK_IDS } from '../audio/killsounds.js';

const CSS = `
.dev-btn { position: fixed; left: 8px; bottom: 8px; z-index: 60; padding: 8px 12px; border-radius: 10px; border: 2px solid #ff3df2;
  background: rgba(20,6,20,.85); color: #ffb3f7; font: 800 13px ui-monospace,monospace; letter-spacing: .1em; }
.dev-panel { position: fixed; left: 8px; bottom: 52px; z-index: 60; width: min(420px, 92vw); max-height: 70vh; overflow-y: auto;
  padding: 10px 12px; border-radius: 12px; border: 2px solid #ff3df2; background: rgba(12,4,14,.92); color: #f3dcf0;
  font: 12px ui-monospace,monospace; touch-action: pan-y; }
.dev-panel[hidden] { display: none; }
.dev-panel h4 { margin: 8px 0 4px; color: #ff8af0; font-size: 11px; letter-spacing: .14em; }
.dev-panel .r { display: flex; flex-wrap: wrap; gap: 5px; }
.dev-panel button { padding: 6px 9px; border-radius: 7px; border: 1px solid rgba(255,61,242,.5); background: #22102a; color: #f3dcf0;
  font: 700 11px ui-monospace,monospace; }
.dev-panel button.on { background: #ff3df2; color: #200020; }
.dev-panel .stats { white-space: pre; color: #c9b6c6; line-height: 1.4; }
`;

export function devEnabled(params) {
  return params.get('dev') === '1' || globalThis.__DEV__ === true;
}

export class DevPanel {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.btn = this._el('button', 'dev-btn', document.body, 'DEV');
    this.panel = this._el('div', 'dev-panel', document.body);
    this.panel.hidden = true;
    this.btn.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
      if (!this.panel.hidden) this.render();
    });
    this.flags = { god: false, ammo: false, freeze: false, hitboxes: false };
    this.speed = 1;
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
    window.__DEVPANEL__ = this;
  }

  _el(tag, cls, parent, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    parent.appendChild(n);
    return n;
  }

  _row(title) {
    this._el('h4', null, this.panel, title);
    return this._el('div', 'r', this.panel);
  }

  _b(row, label, fn, on = false, act) {
    const b = this._el('button', on ? 'on' : null, row, label);
    b.type = 'button';
    if (act) b.dataset.act = `dev-${act}`;
    b.addEventListener('click', () => {
      fn();
      this.render();
    });
    return b;
  }

  get practice() {
    return this.ctx.peek('practice');
  }

  get dummy() {
    return this.practice?.avatar;
  }

  /** Make sure we are in practice (the dev tools act on the practice scene). */
  _ensurePractice() {
    const m = this.ctx.peek('match');
    if (m && m.phase !== 'practice' && m.phase !== 'match') {
      m.lobby?.hide?.();
      m.phase = 'practice';
      this.ctx.peek('practice')?.setActive(true);
      this.ctx.peek('player')?.setControlEnabled?.(true);
    }
  }

  render() {
    const c = this.ctx;
    const f = this.flags;
    this.panel.replaceChildren();
    const world = c.peek('world');

    const mr = this._row('MAP');
    for (const id of MAP_IDS) {
      this._b(mr, MAPS[id].label, () => {
        this._ensurePractice();
        world.load(id);
        this._spawn(0);
        this._dummyInFront();
      }, world?.mapId === id, `map-${id}`);
    }

    const wr = this._row('WEAPON');
    const wp = c.peek('weapons');
    for (const id of ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) {
      this._b(wr, id.toUpperCase(), () => wp.setWeaponImmediate(id), wp?.activeId === id, `weapon-${id}`);
    }

    const pr = this._row('PLAYER');
    this._b(pr, 'GOD', () => (f.god = !f.god), f.god, 'god');
    this._b(pr, 'INF AMMO', () => (f.ammo = !f.ammo), f.ammo, 'ammo');
    this._b(pr, 'SPAWN A', () => this._spawn(0));
    this._b(pr, 'SPAWN B', () => this._spawn(1));
    for (const s of [0.25, 0.5, 1, 2]) this._b(pr, `${s}x`, () => (this.speed = s), this.speed === s, `speed-${s}`);

    const dr = this._row('DUMMY');
    this._b(dr, 'FREEZE', () => (f.freeze = !f.freeze), f.freeze, 'freeze');
    this._b(dr, '10 M AHEAD', () => this._dummyInFront(), false, 'dummy-ahead');
    this._b(dr, 'HITBOXES', () => (f.hitboxes = !f.hitboxes), f.hitboxes, 'hitboxes');
    this._b(dr, 'FIRE', () => this.dummy?.fire());
    this._b(dr, 'RELOAD', () => {
      this.dummy?.setReloading(true);
      setTimeout(() => this.dummy?.setReloading(false), 1600);
    });
    this._b(dr, 'CROUCH', () => this.dummy?.setCrouch(!(this.dummy?._crouchTarget > 0)), this.dummy?._crouchTarget > 0);
    this._b(dr, 'AIM UP', () => this.dummy?.setAim(0.6));
    this._b(dr, 'AIM LEVEL', () => this.dummy?.setAim(0));
    this._b(dr, 'REVIVE', () => {
      if (this.practice) this.practice.dummy.hp = 100;
      this.dummy?.setAlive(true);
    });
    const dw = this._row('DUMMY GUN');
    for (const id of ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) {
      this._b(dw, id.toUpperCase(), () => this.dummy?.setWeapon(id), this.dummy?.weapon === id);
    }

    const fr = this._row('FEEDBACK');
    const ui = c.peek('ui');
    const audio = c.peek('audio');
    const pack = c.settings?.killSound ?? 'neon';
    for (let l = 1; l <= 5; l++) {
      this._b(fr, `KILL ${l}`, () => {
        audio?.confirm?.('kill', { level: l, pack });
        ui?.killBanner?.show(l, l === 5, KILL_PACKS[pack].color);
      }, false, `kill-${l}`);
    }
    this._b(fr, 'HIT', () => audio?.confirm?.('hit'));
    this._b(fr, 'HEADSHOT', () => audio?.confirm?.('head'));
    this._b(fr, 'RECAP', () => {
      const m = c.peek('match');
      m?.deathRecap?.show({ weapon: 'sniper', headshot: true, distance: 18, hits: [{ amount: 100, headshot: true }], oppHp: 67 });
      setTimeout(() => m?.deathRecap?.hide(), 3000);
    }, false, 'recap');
    this._b(fr, 'KILLCAM', () => this._killcam(), false, 'killcam');
    this._b(fr, 'ROUND PICK', () => {
      const m = c.peek('match');
      m?.roundPick?.show(c.peek('weapons')?.activeId ?? 'rifle');
      setTimeout(() => m?.roundPick?.hide(), 4000);
    });
    const kr = this._row('KILL SOUND PACK');
    for (const id of PACK_IDS) {
      this._b(kr, KILL_PACKS[id].label, () => {
        if (c.settings) c.settings.killSound = id;
        audio?.setKillPack?.(id);
        audio?.confirm?.('kill', { level: 3, pack: id });
      }, pack === id);
    }

    this._el('h4', null, this.panel, 'STATS');
    this.stats = this._el('div', 'stats', this.panel, '');
  }

  _spawn(i) {
    const w = this.ctx.peek('world');
    const pl = this.ctx.peek('player');
    const s = w?.spawn(i);
    if (!s || !pl) return;
    pl.movement.teleport(s.position.x, w.groundHeight(s.position.x, s.position.z) + 0.03, s.position.z);
    pl.movement.yaw = s.yaw;
    pl.movement.pitch = 0;
  }

  /** Put the dummy 10 m in front of the player, facing them, and hold it there. */
  _dummyInFront() {
    const pl = this.ctx.peek('player');
    const pr = this.practice;
    const w = this.ctx.peek('world');
    if (!pl || !pr) return;
    const yaw = pl.movement.yaw;
    const x = pl.position.x - Math.sin(yaw) * 10, z = pl.position.z - Math.cos(yaw) * 10;
    this.flags.freeze = true;
    pr.dummy.hp = 100;
    pr.avatar.setAlive(true);
    pr.avatar.setPose(x, w.groundHeight(x, z), z, yaw + Math.PI);
  }

  _killcam() {
    const pl = this.ctx.peek('player');
    const av = this.dummy;
    if (!pl || !av) return;
    const from = { yaw: pl.movement.yaw + Math.PI * 0.8, pitch: 0 };
    let t = 0;
    const m = this.ctx.peek('match');
    import('../match/killcam.js').then(({ killcamAngles }) => {
      const step = () => {
        t += 1 / 60;
        const a = killcamAngles(pl.eyePosition, { x: av.position.x, y: av.position.y + av.headY * 0.85, z: av.position.z }, from, t / 0.6);
        pl.movement.yaw = a.yaw;
        pl.movement.pitch = a.pitch;
        if (t < 0.8) requestAnimationFrame(step);
      };
      step();
    });
    m?.deathRecap?.show({ weapon: 'rifle', headshot: false, distance: 10, hits: [{ amount: 33 }, { amount: 33 }, { amount: 34 }], oppHp: 100 });
    setTimeout(() => m?.deathRecap?.hide(), 2500);
  }

  _hitboxMeshes() {
    if (this._hb) return this._hb;
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3df2, wireframe: true, depthTest: false, transparent: true, opacity: 0.45 });
    const mk = () => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1, 4, 10), mat);
      m.renderOrder = 999;
      m.frustumCulled = false;
      this.ctx.scene.add(m);
      return m;
    };
    this._hb = { head: mk(), body: mk() };
    return this._hb;
  }

  _placeCapsule(mesh, c) {
    const a = new THREE.Vector3(c.ax, c.ay, c.az), b = new THREE.Vector3(c.bx, c.by, c.bz);
    const len = Math.max(1e-3, a.distanceTo(b));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.distanceTo(b) > 1e-4 ? b.clone().sub(a).normalize() : new THREE.Vector3(0, 1, 0));
    if (mesh.userData.r !== c.radius || Math.abs((mesh.userData.len ?? -1) - len) > 1e-3) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.CapsuleGeometry(c.radius, len, 2, 8);
      mesh.userData.r = c.radius;
      mesh.userData.len = len;
    }
  }

  _tick() {
    requestAnimationFrame(this._tick);
    const c = this.ctx;
    const f = this.flags;
    if (c.time) c.time.scale = this.speed;
    const pl = c.peek('player');
    if (f.god && pl?.health) {
      pl.health.value = pl.health.max ?? 100;
      pl.health.dead = false;
    }
    if (f.ammo) {
      const s = c.peek('weapons')?.state;
      if (s) {
        s.mag = s.def.magSize;
        s.chambered = true;
      }
    }
    const pr = this.practice;
    if (pr) {
      if (f.freeze && !pr._devHeld) {
        pr._devUpdate = pr.update;
        pr.update = (dt) => pr.avatar.tick(dt);
        pr._devHeld = true;
      } else if (!f.freeze && pr._devHeld) {
        pr.update = pr._devUpdate;
        pr._devHeld = false;
      }
    }
    if (f.hitboxes && this.dummy) {
      const hb = this._hitboxMeshes();
      hb.head.visible = hb.body.visible = this.dummy.alive;
      this._placeCapsule(hb.head, this.dummy.head);
      this._placeCapsule(hb.body, this.dummy.body);
    } else if (this._hb) {
      this._hb.head.visible = this._hb.body.visible = false;
    }
    if (this.stats && !this.panel.hidden && (this._n = (this._n ?? 0) + 1) % 15 === 0) {
      const r = c.peek('render')?.renderer?.info?.render;
      const p = pl?.position;
      const now = performance.now();
      const fps = this._lastT ? Math.round((15 * 1000) / (now - this._lastT)) : 0;
      this._lastT = now;
      this.stats.textContent =
        `map ${c.peek('world')?.mapId}  fps ~${fps}\n` +
        `draw calls ${r?.calls ?? '?'}  tris ${r?.triangles ?? '?'}\n` +
        `pos ${p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : '-'}  speed ${this.speed}x`;
    }
  }
}
