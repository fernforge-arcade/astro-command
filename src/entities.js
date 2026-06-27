// Entity data structures: Unit, Building, Resource, Projectile, Particle.
import { UNITS, BUILDINGS, TILE, TEAM } from './config.js';
import { nextId } from './util.js';

export class Unit {
  constructor(key, team, x, y) {
    const d = UNITS[key];
    this.kind = 'unit';
    this.id = nextId();
    this.key = key; this.def = d; this.team = team;
    this.x = x; this.y = y; this.angle = Math.random() * Math.PI * 2;
    this.vx = 0; this.vy = 0;
    this.radius = d.radius; this.speed = d.speed;
    this.maxHp = d.hp; this.hp = d.hp; this.armor = d.armor;
    this.sight = d.sight;
    this.state = 'idle';
    this.path = null; this.pathIdx = 0;
    this.moveGoal = null;          // {x,y} final destination
    this.target = null;            // entity being attacked
    this.attackTimer = 0;
    this.repathTimer = 0;
    this.gatherPatch = null;       // resource entity
    this.dropoff = null;           // building entity
    this.cargo = 0;
    this.gatherTimer = 0;
    this.buildTask = null;         // building being constructed
    this.holdPos = false;
    this.queue = [];               // queued orders (shift)
    this.selected = false;
    this.dead = false;
    this.hitFlash = 0;
    this.muzzle = 0;
    this.lastDamageFrom = null;
  }
  get isWorker() { return this.def.canGather; }
}

export class Building {
  constructor(key, team, tx, ty, prebuilt = false) {
    const d = BUILDINGS[key];
    this.kind = 'building';
    this.id = nextId();
    this.key = key; this.def = d; this.team = team;
    this.tx = tx; this.ty = ty; this.tw = d.tw; this.th = d.th;
    this.x = tx * TILE + (d.tw * TILE) / 2;
    this.y = ty * TILE + (d.th * TILE) / 2;
    this.radius = (Math.max(d.tw, d.th) * TILE) / 2;
    this.maxHp = d.hp; this.armor = d.armor; this.sight = d.sight;
    this.hp = prebuilt ? d.hp : Math.max(1, Math.round(d.hp * 0.08));
    this.constructing = !prebuilt;
    this.buildProgress = prebuilt ? 1 : 0;  // 0..1
    this.builderId = null;
    this.queue = [];               // production: {key, totalTime, timeLeft}
    this.rally = null;             // {x,y}
    this.attackTimer = 0;
    this.target = null;
    this.dead = false;
    this.hitFlash = 0;
    this.spawnPulse = 0;
  }
  footprintRect() { return { x: this.tx * TILE, y: this.ty * TILE, w: this.tw * TILE, h: this.th * TILE }; }
}

export class Resource {
  constructor(tx, ty, amount) {
    this.kind = 'resource';
    this.id = nextId();
    // Resources are neutral — without this, isEnemy() sees an undefined team and
    // treats a mineral patch as hostile, so a worker right-clicked onto it ATTACKS
    // the crystals instead of mining them (manual gather never collected anything).
    this.team = TEAM.NEUTRAL;
    this.tx = tx; this.ty = ty; this.tw = 1; this.th = 1;
    this.x = tx * TILE + TILE / 2; this.y = ty * TILE + TILE / 2;
    this.radius = TILE * 0.5;
    this.amount = amount; this.maxAmount = amount;
    this.dead = false;
    this.miners = 0;
  }
}

export class Projectile {
  constructor(x, y, target, opts) {
    this.kind = 'projectile';
    this.id = nextId();
    this.x = x; this.y = y;
    this.target = target;
    this.tx = target.x; this.ty = target.y;
    this.speed = opts.speed; this.damage = opts.damage;
    this.splash = opts.splash || 0;
    this.team = opts.team; this.color = opts.color || '#ffe08a';
    this.dead = false;
    this.trail = [];
  }
}

export class Particle {
  constructor(x, y, vx, vy, life, color, size, kind = 'spark') {
    this.kind = 'particle';
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life; this.color = color; this.size = size;
    this.ptype = kind; this.dead = false;
  }
}

// Damage application with armor + min damage floor.
export function applyDamage(target, raw, from) {
  const armor = target.armor || 0;
  const dmg = Math.max(1, raw - armor);
  target.hp -= dmg;
  target.hitFlash = 0.12;
  if (from) target.lastDamageFrom = from;
  if (target.hp <= 0) { target.hp = 0; target.dead = true; }
  return dmg;
}
