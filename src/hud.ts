import * as THREE from 'three';
import type { Vehicle } from './vehicle';
import { WEAPONS } from './weapons';
import type { PickupKind } from './pickups';

const $ = (id: string) => document.getElementById(id)!;
const bar = (id: string) => $(id).firstElementChild as HTMLElement;
const FEED_TIME = 4;
const CAPTION_TIME = 3.5;
const RADAR_RANGE = 120; // m
const ARROW_RANGE = 160; // m
const MAX_ARROWS = 8;
const PICKUP_DOT: Record<PickupKind, string> = { health: '#3fd46b', weapon: '#ff5a36', special: '#b36bff' };

export interface HudFrame {
  me: Vehicle;
  foe: Vehicle | null;
  enemies: Vehicle[];
  boss: Vehicle | null;
  pickups: { kind: PickupKind; pos: THREE.Vector3 }[];
  camera: THREE.Camera;
  respawnIn: number;
  lives: number; // Infinity = not shown
  status: string; // "Opponents left 3" / "Wave 4 · 1250 pts" / spectate line
}

export class Hud {
  private feedItems: { text: string; t: number }[] = [];
  private captionT = 0;
  private hp = bar('hp');
  private heat = bar('heat');
  private foeHp = bar('foe-hp');
  private special = bar('special');
  private energy = bar('energy');
  private radar = ($('radar') as HTMLCanvasElement).getContext('2d')!;
  private arrows: HTMLElement[];

  constructor() {
    const box = $('arrows');
    box.innerHTML = '';
    this.arrows = Array.from({ length: MAX_ARROWS }, () => box.appendChild(Object.assign(document.createElement('div'), { className: 'arrow', textContent: '▲' })));
  }

  feed(text: string) {
    this.feedItems.unshift({ text, t: FEED_TIME });
    this.feedItems.length = Math.min(this.feedItems.length, 5);
  }

  /** Subtitle line for driver taunts (spec §11 accessibility). */
  caption(speaker: string, line: string) {
    if (!line) return;
    $('caption').innerHTML = '';
    $('caption').append(Object.assign(document.createElement('b'), { textContent: `${speaker}: ` }), `“${line}”`);
    this.captionT = CAPTION_TIME;
  }

  update(dt: number, f: HudFrame) {
    const { me, foe } = f;
    this.hp.style.width = `${(me.hp / me.maxHp) * 100}%`;
    this.hp.style.background = me.hp < me.maxHp * 0.25 ? '#ff4d3a' : '';
    $('me-name').textContent = me.def.name.toUpperCase() + (Number.isFinite(f.lives) ? `  ${'♥'.repeat(Math.max(0, f.lives))}` : '');
    this.special.style.width = `${me.special * 100}%`;
    $('special-label').textContent = me.ability?.active ? `${me.def.abilityName}!` : me.special >= 1 ? `${me.def.abilityName} READY · Shift / △` : me.def.abilityName;
    $('special').classList.toggle('ready', me.special >= 1);
    this.energy.style.width = `${me.energy}%`;
    $('energy-label').textContent = me.frozen > 0 ? `FROZEN ${me.frozen.toFixed(1)}s` : me.shield > 0 ? `SHIELD ${me.shield.toFixed(1)}s` : `ENERGY ${Math.floor(me.energy)}`;
    this.heat.style.width = `${me.heat * 100}%`;
    this.heat.style.background = me.overheated ? '#ff4d3a' : '';

    const shownFoe = f.boss?.alive ? f.boss : foe; // the boss bar stays up during the boss fight
    $('foe').style.visibility = shownFoe?.alive ? 'visible' : 'hidden';
    $('foe').classList.toggle('boss', !!shownFoe && shownFoe === f.boss);
    if (shownFoe) {
      $('foe-name').textContent = `${shownFoe.name} · ${shownFoe.def.name}`.toUpperCase();
      this.foeHp.style.width = `${(shownFoe.hp / shownFoe.maxHp) * 100}%`;
    }

    $('weapon').innerHTML = me.stun > 0 ? `JAMMED<small>weapons + steering offline ${me.stun.toFixed(1)}s</small>` : me.weapon
      ? `${WEAPONS[me.weapon].name} ×${me.ammo[me.weapon]}<small>${Object.keys(me.ammo).length} weapon type(s) · Q/E to switch</small>`
      : `Machine Gun<small>grab red crates for weapons</small>`;
    $('score').textContent = `${f.status} · Wrecks ${me.kills}`;

    for (const it of this.feedItems) it.t -= dt;
    this.feedItems = this.feedItems.filter((it) => it.t > 0);
    $('feed').replaceChildren(...this.feedItems.map((it) => Object.assign(document.createElement('div'), { textContent: it.text })));

    this.captionT -= dt;
    $('caption').style.opacity = this.captionT > 0 ? '1' : '0';

    $('msg').innerHTML = me.alive ? '' : Number.isFinite(f.lives) && f.lives <= 0 ? 'OUT OF LIVES' : `WRECKED<small>respawning in ${Math.max(0, f.respawnIn).toFixed(1)}s</small>`;
    this.drawRadar(f);
    this.drawArrows(f);
  }

  /** Top-right radar, player-forward is up (spec §11). */
  private drawRadar(f: HudFrame) {
    const c = this.radar;
    const size = c.canvas.width;
    const r = size / 2;
    c.clearRect(0, 0, size, size);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.beginPath();
    c.arc(r, r, r - 1, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.stroke();
    const yaw = new THREE.Euler().setFromQuaternion(f.me.rotation, 'YXZ').y;
    const toScreen = (p: THREE.Vector3) => {
      const dx = p.x - f.me.position.x;
      const dz = p.z - f.me.position.z;
      // Rotate world so the car's forward (+X at yaw) points up the radar.
      const fwd = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const right = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      const s = (r - 6) / RADAR_RANGE;
      const len = Math.hypot(fwd, right);
      const k = len * s > r - 6 ? (r - 6) / (len * s) : 1; // pin far things to the rim
      return [r + right * s * k, r - fwd * s * k] as const;
    };
    for (const p of f.pickups) {
      const [x, y] = toScreen(p.pos);
      c.fillStyle = PICKUP_DOT[p.kind];
      c.fillRect(x - 2, y - 2, 4, 4);
    }
    for (const e of f.enemies) {
      if (!e.alive) continue;
      const [x, y] = toScreen(e.position);
      c.fillStyle = e === f.boss ? '#ffd23f' : '#ff4d3a';
      c.beginPath();
      c.arc(x, y, e === f.boss ? 5 : 3.5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(r, r - 6);
    c.lineTo(r - 4, r + 4);
    c.lineTo(r + 4, r + 4);
    c.fill();
  }

  /** Edge-of-screen arrows toward enemies that are off-screen (spec §11). */
  private drawArrows(f: HudFrame) {
    let n = 0;
    const v = new THREE.Vector3();
    for (const e of f.enemies) {
      if (n >= MAX_ARROWS || !e.alive || e.position.distanceTo(f.me.position) > ARROW_RANGE) continue;
      v.copy(e.position).project(f.camera);
      const behind = v.z > 1;
      if (!behind && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95) continue; // on screen
      let x = behind ? -v.x : v.x;
      let y = behind ? -v.y : v.y;
      const m = Math.max(Math.abs(x), Math.abs(y)) || 1;
      x = (x / m) * 0.9;
      y = (y / m) * 0.85;
      const a = this.arrows[n++];
      a.style.display = 'block';
      a.style.left = `${(x * 0.5 + 0.5) * 100}%`;
      a.style.top = `${(-y * 0.5 + 0.5) * 100}%`;
      a.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(x, y)}rad)`;
      a.style.color = e === f.boss ? '#ffd23f' : '#ff4d3a';
    }
    for (; n < MAX_ARROWS; n++) this.arrows[n].style.display = 'none';
  }
}
