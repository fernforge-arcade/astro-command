// Core simulation: world state + all systems (movement, combat, economy, AI hooks).
import {
  TILE, TEAM, UNITS, BUILDINGS, MAP_SIZES, DIFFICULTY,
  START_MINERALS, START_SUPPLY_CAP, SUPPLY_HARD_CAP,
  MINERAL_PER_TRIP, MINERAL_PATCH_AMOUNT, BUILDABLE,
} from './config.js';
import { Grid, TERRAIN } from './grid.js';
import { Fog } from './fog.js';
import { Camera } from './camera.js';
import { findPath } from './pathfinding.js';
import { Unit, Building, Resource, Projectile, Particle, applyDamage } from './entities.js';
import {
  clamp, dist, dist2, angleTo, rotateToward, makeRng, randRange, randInt, pick, TAU,
} from './util.js';
import { Sfx } from './audio.js';
import { AI } from './ai.js';

// Uniform spatial hash for cheap neighbor queries among units.
class SpatialHash {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
  clear() { this.map.clear(); }
  insert(u) {
    const cx = Math.floor(u.x / this.cell), cy = Math.floor(u.y / this.cell);
    const k = this._key(cx, cy);
    let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); }
    b.push(u);
  }
  build(units) { this.clear(); for (const u of units) this.insert(u); }
  query(x, y, r, out) {
    out.length = 0;
    const c0x = Math.floor((x - r) / this.cell), c1x = Math.floor((x + r) / this.cell);
    const c0y = Math.floor((y - r) / this.cell), c1y = Math.floor((y + r) / this.cell);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const b = this.map.get(this._key(cx, cy));
      if (b) for (const u of b) out.push(u);
    }
    return out;
  }
}

export class Game {
  constructor(opts) {
    this.difficulty = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.difficultyKey = opts.difficulty || 'normal';
    const size = MAP_SIZES[opts.mapSize] || MAP_SIZES.medium;
    this.W = size.w; this.H = size.h;
    this.seed = opts.seed || (Date.now() & 0xffffffff);
    this.rng = makeRng(this.seed);

    this.grid = new Grid(this.W, this.H);
    this.fog = new Fog(this.W, this.H);
    this.camera = new Camera();
    this.camera.setWorld(this.W, this.H);

    this.units = [];
    this.buildings = [];
    this.resources = [];
    this.projectiles = [];
    this.particles = [];
    this.hash = new SpatialHash(TILE * 2.2);
    this._neighbors = [];

    this.players = {
      [TEAM.PLAYER]: { minerals: START_MINERALS, supplyUsed: 0, supplyCap: 0, name: 'You' },
      [TEAM.ENEMY]: { minerals: START_MINERALS, supplyUsed: 0, supplyCap: 0, name: 'Enemy' },
    };

    this.selection = [];
    this.stats = { playerDeliveries: 0 }; // mineral drop-offs by the player (used by tutorial)
    this.controlGroups = {}; // 1..9 -> array of unit ids
    this.time = 0;
    this.fogTimer = 0;
    this.gameOver = null;     // 'victory' | 'defeat'
    this.paused = false;

    this.pendingBuild = null; // {key} placement mode for player
    this.toasts = [];         // {text, kind, t}
    this.pings = [];          // minimap/alert pings {x,y,t,color}
    this.lastAttackedAlert = 0;

    this._generateMap(opts);
    this.ai = new AI(this, TEAM.ENEMY, this.difficulty);

    // Center camera on player's command center.
    const cc = this.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command');
    if (cc) this.camera.centerOn(cc.x, cc.y);
  }

  // ---------------------------------------------------------------- Map gen
  _generateMap(opts) {
    const g = this.grid, rng = this.rng;
    for (let i = 0; i < g.terrain.length; i++) g.terrain[i] = TERRAIN.GRASS;

    // Scatter rock clusters as obstacles (avoid map edges spawn areas later).
    const clusters = Math.floor((this.W * this.H) / 230);
    for (let c = 0; c < clusters; c++) {
      const cx = randInt(rng, 6, this.W - 7), cy = randInt(rng, 6, this.H - 7);
      const n = randInt(rng, 2, 6);
      for (let k = 0; k < n; k++) {
        const x = clamp(cx + randInt(rng, -2, 2), 0, this.W - 1);
        const y = clamp(cy + randInt(rng, -2, 2), 0, this.H - 1);
        g.setTerrain(x, y, TERRAIN.ROCK);
      }
    }
    // Dirt patches for visual variety.
    for (let c = 0; c < clusters * 2; c++) {
      const cx = randInt(rng, 2, this.W - 3), cy = randInt(rng, 2, this.H - 3);
      for (let k = 0; k < randInt(rng, 3, 8); k++) {
        const x = clamp(cx + randInt(rng, -2, 2), 0, this.W - 1);
        const y = clamp(cy + randInt(rng, -2, 2), 0, this.H - 1);
        if (g.terrain[g.idx(x, y)] === TERRAIN.GRASS) g.terrain[g.idx(x, y)] = TERRAIN.DIRT;
      }
    }

    // Player base bottom-left, enemy top-right (mirrored).
    const margin = 7;
    const pBase = { tx: margin, ty: this.H - margin - 3 };
    const eBase = { tx: this.W - margin - 3, ty: margin };
    // Clear rock around bases.
    this._clearArea(pBase.tx - 3, pBase.ty - 3, 9, 9);
    this._clearArea(eBase.tx - 3, eBase.ty - 3, 9, 9);

    this._spawnBase(TEAM.PLAYER, pBase);
    this._spawnBase(TEAM.ENEMY, eBase);

    // A few neutral mineral expansions around the middle.
    const exps = 3;
    for (let i = 0; i < exps; i++) {
      const ex = randInt(rng, 14, this.W - 15), ey = randInt(rng, 14, this.H - 15);
      this._clearArea(ex - 2, ey - 2, 5, 5);
      this._spawnMineralLine(ex, ey, randInt(rng, 4, 6));
    }
  }
  _clearArea(tx, ty, w, h) {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
      if (this.grid.inBounds(x, y)) {
        const i = this.grid.idx(x, y);
        if (this.grid.terrain[i] === TERRAIN.ROCK) { this.grid.terrain[i] = TERRAIN.GRASS; this.grid.solid[i] = 0; }
      }
    }
  }
  _spawnBase(team, base) {
    // Command center.
    const cc = this.addBuilding('command', team, base.tx, base.ty, true);
    // Starting workers.
    const cx = cc.x, cy = cc.y;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const u = new Unit('worker', team, cx + Math.cos(a) * 70, cy + Math.sin(a) * 70 + 20);
      this.units.push(u);
    }
    // Mineral patch line near the base.
    const dir = team === TEAM.PLAYER ? -1 : 1;
    this._spawnMineralLine(base.tx + 1, base.ty + dir * 4, 6);
  }
  _spawnMineralLine(tx, ty, n) {
    for (let i = 0; i < n; i++) {
      const x = tx + (i % 4), y = ty + Math.floor(i / 4);
      if (!this.grid.inBounds(x, y) || this.grid.isSolid(x, y)) continue;
      const r = new Resource(x, y, MINERAL_PATCH_AMOUNT);
      this.resources.push(r);
      this.grid.occupy(x, y, 1, 1, r.id);
    }
  }

  // ---------------------------------------------------------------- Spawning
  addBuilding(key, team, tx, ty, prebuilt) {
    const b = new Building(key, team, tx, ty, prebuilt);
    b.buildTime = Math.max(12, BUILDINGS[key].cost / 7);
    this.grid.occupy(tx, ty, b.tw, b.th, b.id);
    this.buildings.push(b);
    if (prebuilt) b.spawnPulse = 0.5;
    return b;
  }
  spawnUnit(key, team, x, y) {
    const u = new Unit(key, team, x, y);
    this.units.push(u);
    return u;
  }

  // ---------------------------------------------------------------- Queries
  playerOf(team) { return this.players[team]; }
  isEnemy(a, b) { return a.team !== b.team && b.team !== TEAM.NEUTRAL; }

  rangeDist(att, tgt) {
    // center-to-center minus target radius (so large buildings are easier to reach).
    return dist(att.x, att.y, tgt.x, tgt.y) - (tgt.radius || 0);
  }

  // Nearest enemy (unit or building) to a point within range, for a given team.
  findNearestEnemy(team, x, y, range) {
    let best = null, bestD = range;
    this.hash.query(x, y, range + TILE * 3, this._neighbors);
    for (const u of this._neighbors) {
      if (u.dead || u.team === team || u.team === TEAM.NEUTRAL) continue;
      const d = dist(x, y, u.x, u.y) - u.radius;
      if (d < bestD) { bestD = d; best = u; }
    }
    for (const b of this.buildings) {
      if (b.dead || b.team === team || b.team === TEAM.NEUTRAL) continue;
      const d = dist(x, y, b.x, b.y) - b.radius;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  entityAt(wx, wy) {
    // Topmost entity under a world point (units first, then buildings, then resources).
    for (const u of this.units) if (!u.dead && dist(wx, wy, u.x, u.y) <= u.radius + 4) return u;
    for (const b of this.buildings) {
      if (b.dead) continue;
      const r = b.footprintRect();
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return b;
    }
    for (const r of this.resources) if (!r.dead && dist(wx, wy, r.x, r.y) <= r.radius) return r;
    return null;
  }

  nearestDropoff(team, x, y) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.dead || b.team !== team || b.constructing) continue;
      if (!b.def.isDropoff) continue;
      const d = dist2(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  nearestMineral(x, y, maxR = TILE * 18) {
    let best = null, bd = maxR * maxR;
    for (const r of this.resources) {
      if (r.dead || r.amount <= 0) continue;
      const d = dist2(x, y, r.x, r.y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  // ---------------------------------------------------------------- Commands
  clearOrders(u) {
    u.path = null; u.target = null; u.moveGoal = null; u.gatherPatch = null;
    u.dropoff = null; u.buildTask = null; u.holdPos = false; u.queue = [];
  }
  moveTo(u, x, y, queued = false) {
    const order = { type: 'move', x, y };
    if (queued && (u.state !== 'idle')) { u.queue.push(order); return; }
    this._beginOrder(u, order);
  }
  attackMoveTo(u, x, y, queued = false) {
    const order = { type: 'attackMove', x, y };
    if (queued && u.state !== 'idle') { u.queue.push(order); return; }
    this._beginOrder(u, order);
  }
  attack(u, target, queued = false) {
    const order = { type: 'attack', targetId: target.id };
    if (queued && u.state !== 'idle') { u.queue.push(order); return; }
    this._beginOrder(u, order, target);
  }
  gather(u, patch, queued = false) {
    const order = { type: 'gather', targetId: patch.id };
    if (queued && u.state !== 'idle') { u.queue.push(order); return; }
    this._beginOrder(u, order, patch);
  }
  buildOrder(u, building, queued = false) {
    const order = { type: 'build', targetId: building.id };
    if (queued && u.state !== 'idle') { u.queue.push(order); return; }
    this._beginOrder(u, order, building);
  }
  stop(u) { this.clearOrders(u); u.state = 'idle'; }
  hold(u) { this.clearOrders(u); u.holdPos = true; u.state = 'hold'; }

  _beginOrder(u, order, resolved) {
    u.queue = u.queue; // keep queued tail
    u.path = null; u.target = null; u.moveGoal = null; u.gatherPatch = null;
    u.dropoff = null; u.buildTask = null; u.holdPos = false;
    switch (order.type) {
      case 'move':
        u.state = 'move'; u.moveGoal = { x: order.x, y: order.y }; this._setPath(u, order.x, order.y); break;
      case 'attackMove':
        u.state = 'attackMove'; u.moveGoal = { x: order.x, y: order.y }; this._setPath(u, order.x, order.y); break;
      case 'attack':
        u.state = 'attack'; u.target = resolved || this.byId(order.targetId); break;
      case 'gather':
        u.state = 'gather'; u.gatherPatch = resolved || this.byId(order.targetId); break;
      case 'build':
        u.state = 'build'; u.buildTask = resolved || this.byId(order.targetId); break;
    }
  }
  byId(id) {
    for (const u of this.units) if (u.id === id) return u;
    for (const b of this.buildings) if (b.id === id) return b;
    for (const r of this.resources) if (r.id === id) return r;
    return null;
  }
  _nextQueued(u) {
    if (u.queue.length) { const o = u.queue.shift(); this._beginOrder(u, o, o.targetId ? this.byId(o.targetId) : null); }
    else { u.state = u.holdPos ? 'hold' : 'idle'; u.path = null; u.target = null; }
  }
  _setPath(u, x, y) {
    const p = findPath(this.grid, u.x, u.y, x, y);
    u.path = p; u.pathIdx = 0; u.repathTimer = 0;
    if (!p || p.length === 0) { u.path = [{ x, y }]; }
  }

  // High-level command from the player's selection at a world point.
  issueSelectionCommand(wx, wy, { queued = false, forceAttack = false, forceMove = false } = {}) {
    const ents = this.selection.filter(e => !e.dead);
    const units = ents.filter(e => e.kind === 'unit' && e.team === TEAM.PLAYER);
    const buildings = ents.filter(e => e.kind === 'building' && e.team === TEAM.PLAYER);

    // Buildings: set rally point.
    if (buildings.length && !units.length) {
      let set = false;
      for (const b of buildings) if (b.def.rally && !b.constructing) { b.rally = { x: wx, y: wy }; set = true; }
      if (set) { Sfx.command(); this.spawnPing(wx, wy, '#3ddc84'); }
      return;
    }
    if (!units.length) return;

    let target = this.entityAt(wx, wy);
    // Click forgiveness: a mineral crystal's hitbox is only half a tile, so a
    // right-click that lands just beside the crystals would otherwise become a
    // plain move and the worker never mines. If a worker is selected and the
    // click is near a patch, treat that patch as the target.
    if ((!target || (target.kind !== 'resource' && !this.isEnemy(units[0] || {}, target)))
        && units.some(u => u.isWorker)) {
      const patch = this.nearestMineral(wx, wy, TILE * 1.4);
      if (patch) target = patch;
    }
    let issued = false;
    for (const u of units) {
      if (forceMove) { this.moveTo(u, wx, wy, queued); issued = true; continue; }
      if (forceAttack) {
        if (target && this.isEnemy(u, target)) this.attack(u, target, queued);
        else this.attackMoveTo(u, wx, wy, queued);
        issued = true; continue;
      }
      if (target && target.kind !== 'particle') {
        if (target.kind === 'resource' && u.isWorker) { this.gather(u, target, queued); issued = true; }
        else if (this.isEnemy(u, target)) { this.attack(u, target, queued); issued = true; }
        else if (target.kind === 'building' && target.team === u.team && target.constructing && u.isWorker) {
          this.buildOrder(u, target, queued); issued = true;
        } else if (target.kind === 'building' && target.team === u.team && target.def.isDropoff && u.isWorker && u.cargo > 0) {
          this.moveTo(u, wx, wy, queued); issued = true;
        } else { this.moveTo(u, wx, wy, queued); issued = true; }
      } else {
        this.moveTo(u, wx, wy, queued); issued = true;
      }
    }
    if (issued) {
      Sfx.command();
      this.spawnPing(wx, wy, forceAttack || (target && units.some(u => this.isEnemy(u, target))) ? '#ef5366' : '#3da9fc');
    }
  }

  spawnPing(x, y, color) { this.pings.push({ x, y, t: 0, max: 0.5, color }); }

  // ---------------------------------------------------------------- Selection
  selectAt(wx, wy, additive) {
    const e = this.entityAt(wx, wy);
    if (!additive) this.clearSelection();
    if (e && (e.team === TEAM.PLAYER || (!this.selection.length))) {
      // Prefer selecting own units/buildings; allow inspecting enemy if nothing else.
      if (e.kind === 'resource' && !additive) { return; }
      this._addToSelection(e);
      Sfx.select();
    }
    this._normalizeSelection();
  }
  selectBox(x0, y0, x1, y1, additive) {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1);
    const miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    if (!additive) this.clearSelection();
    // Player units in box take priority.
    const inBox = [];
    for (const u of this.units) {
      if (u.dead || u.team !== TEAM.PLAYER) continue;
      if (u.x >= minx && u.x <= maxx && u.y >= miny && u.y <= maxy) inBox.push(u);
    }
    if (inBox.length) {
      for (const u of inBox) this._addToSelection(u);
      Sfx.select();
    } else if (Math.hypot(x1 - x0, y1 - y0) < 6) {
      // Treated as a click; try buildings.
      const e = this.entityAt(x0, y0);
      if (e) { this._addToSelection(e); Sfx.select(); }
    }
    this._normalizeSelection();
  }
  _addToSelection(e) { if (!this.selection.includes(e)) { this.selection.push(e); e.selected = true; } }
  clearSelection() { for (const e of this.selection) e.selected = false; this.selection = []; }
  _normalizeSelection() {
    // If selection contains player units, drop buildings/enemy from it (units take priority).
    const units = this.selection.filter(e => e.kind === 'unit' && e.team === TEAM.PLAYER);
    if (units.length) {
      for (const e of this.selection) if (!units.includes(e)) e.selected = false;
      this.selection = units;
    }
    this.pendingBuild = null;
  }
  selectAllOfTypeOnScreen(key) {
    const b = this.camera.visibleBounds();
    this.clearSelection();
    for (const u of this.units) {
      if (u.dead || u.team !== TEAM.PLAYER || u.key !== key) continue;
      if (u.x >= b.x0 && u.x <= b.x1 && u.y >= b.y0 && u.y <= b.y1) this._addToSelection(u);
    }
    this._normalizeSelection();
  }
  assignControlGroup(n) {
    this.controlGroups[n] = this.selection.filter(e => !e.dead).map(e => e.id);
  }
  recallControlGroup(n) {
    const ids = this.controlGroups[n]; if (!ids) return;
    this.clearSelection();
    for (const id of ids) { const e = this.byId(id); if (e && !e.dead) this._addToSelection(e); }
    this._normalizeSelection();
    if (this.selection.length) { Sfx.select(); this._centerOnSelection(); }
  }
  _centerOnSelection() {
    if (!this.selection.length) return;
    let sx = 0, sy = 0; for (const e of this.selection) { sx += e.x; sy += e.y; }
    this.camera.centerOn(sx / this.selection.length, sy / this.selection.length);
  }

  // ---------------------------------------------------------------- Production
  canAfford(team, cost) { return this.players[team].minerals >= cost; }
  supplyFree(team) { return this.players[team].supplyCap - this.players[team].supplyUsed; }

  queueUnit(building, key) {
    const team = building.team;
    const def = UNITS[key];
    if (building.constructing) return false;
    // Tech requirement.
    if (def.requires && !this.buildings.some(b => b.team === team && b.key === def.requires && !b.constructing)) {
      if (team === TEAM.PLAYER) this.toast(`Requires ${BUILDINGS[def.requires].name}`, 'bad'), Sfx.deny();
      return false;
    }
    if (!this.canAfford(team, def.cost)) { if (team === TEAM.PLAYER) { this.toast('Not enough minerals', 'bad'); Sfx.deny(); } return false; }
    if (this.supplyFree(team) < def.supply) { if (team === TEAM.PLAYER) { this.toast('Need more supply (build a Depot)', 'bad'); Sfx.deny(); } return false; }
    if (building.queue.length >= 6) { if (team === TEAM.PLAYER) Sfx.deny(); return false; }
    this.players[team].minerals -= def.cost;
    building.queue.push({ key, totalTime: def.buildTime, timeLeft: def.buildTime });
    if (team === TEAM.PLAYER) Sfx.command();
    return true;
  }
  cancelQueueItem(building, idx) {
    const item = building.queue[idx]; if (!item) return;
    this.players[building.team].minerals += UNITS[item.key].cost;
    building.queue.splice(idx, 1);
    Sfx.command();
  }

  // Player initiates placing a building.
  beginPlacement(key) {
    const def = BUILDINGS[key];
    if (def.requires && !this.buildings.some(b => b.team === TEAM.PLAYER && b.key === def.requires && !b.constructing)) {
      this.toast(`Requires ${BUILDINGS[def.requires].name}`, 'bad'); Sfx.deny(); return;
    }
    if (!this.canAfford(TEAM.PLAYER, def.cost)) { this.toast('Not enough minerals', 'bad'); Sfx.deny(); return; }
    this.pendingBuild = { key };
  }
  // Attempt to place pending building at tile (tx,ty) with selected worker.
  tryPlaceBuilding(tx, ty) {
    if (!this.pendingBuild) return false;
    const key = this.pendingBuild.key, def = BUILDINGS[key];
    if (!this.grid.canBuild(tx, ty, def.tw, def.th)) { this.toast('Cannot build there', 'bad'); Sfx.deny(); return false; }
    if (!this.canAfford(TEAM.PLAYER, def.cost)) { this.toast('Not enough minerals', 'bad'); Sfx.deny(); this.pendingBuild = null; return false; }
    // Need a worker in selection.
    const worker = this.selection.find(e => e.kind === 'unit' && e.isWorker && !e.dead)
      || this.units.find(u => u.team === TEAM.PLAYER && u.isWorker && !u.dead);
    if (!worker) { this.toast('Need a Worker to build', 'bad'); Sfx.deny(); this.pendingBuild = null; return false; }
    this.players[TEAM.PLAYER].minerals -= def.cost;
    const b = this.addBuilding(key, TEAM.PLAYER, tx, ty, false);
    b.builderId = worker.id;
    this.buildOrder(worker, b);
    this.pendingBuild = null;
    Sfx.command();
    this.toast(`Building ${def.name}`, 'good');
    return true;
  }

  // AI/helper: place a building near a team's command center using a free worker.
  aiPlaceBuilding(team, key) {
    const def = BUILDINGS[key];
    if (!this.canAfford(team, def.cost)) return null;
    if (def.requires && !this.buildings.some(b => b.team === team && b.key === def.requires && !b.constructing)) return null;
    const cc = this.buildings.find(b => b.team === team && b.key === 'command');
    if (!cc) return null;
    // Spiral search for a valid footprint around the base.
    const baseTx = cc.tx, baseTy = cc.ty;
    for (let r = 3; r <= 16; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * TAU;
        const tx = Math.round(baseTx + Math.cos(ang) * r);
        const ty = Math.round(baseTy + Math.sin(ang) * r);
        // Keep a 1-tile moat around AI buildings so workers always have a lane in.
        if (this.grid.canBuild(tx, ty, def.tw, def.th) && this.grid.canBuild(tx - 1, ty - 1, def.tw + 2, def.th + 2)) {
          // Find a free-ish worker.
          let worker = this.units.find(u => u.team === team && u.isWorker && !u.dead && (u.state === 'gather' || u.state === 'idle' || u.state === 'returnCargo'));
          if (!worker) worker = this.units.find(u => u.team === team && u.isWorker && !u.dead);
          if (!worker) return null;
          this.players[team].minerals -= def.cost;
          const b = this.addBuilding(key, team, tx, ty, false);
          b.builderId = worker.id;
          this.buildOrder(worker, b);
          return b;
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- Update
  update(dt) {
    if (this.paused || this.gameOver) return;
    this.time += dt;

    this.hash.build(this.units);
    this._recomputeEconomy();

    // Fog: refresh a few times per second.
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) { this._updateFog(); this.fogTimer = 0.12; }

    for (const u of this.units) if (!u.dead) this._updateUnit(u, dt);
    for (const b of this.buildings) if (!b.dead) this._updateBuilding(b, dt);
    this._updateProjectiles(dt);
    this._updateParticles(dt);
    for (const p of this.pings) p.t += dt;
    this.pings = this.pings.filter(p => p.t < p.max);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter(t => t.t < 3);

    this.ai.update(dt);

    this._cleanup();
    this._checkWinLose();
  }

  _recomputeEconomy() {
    const used = { [TEAM.PLAYER]: 0, [TEAM.ENEMY]: 0 };
    const cap = { [TEAM.PLAYER]: 0, [TEAM.ENEMY]: 0 };
    for (const u of this.units) if (!u.dead) used[u.team] += u.def.supply;
    for (const b of this.buildings) {
      if (b.dead) continue;
      if (!b.constructing) cap[b.team] += b.def.supplyProvided || 0;
      for (const q of b.queue) used[b.team] += UNITS[q.key].supply; // reserved supply
    }
    for (const team of [TEAM.PLAYER, TEAM.ENEMY]) {
      this.players[team].supplyUsed = used[team];
      this.players[team].supplyCap = Math.min(SUPPLY_HARD_CAP, cap[team]);
    }
  }

  _updateFog() {
    this.fog.clear();
    for (const u of this.units) if (!u.dead && u.team === TEAM.PLAYER) this.fog.reveal(u.x, u.y, u.sight);
    for (const b of this.buildings) if (!b.dead && b.team === TEAM.PLAYER) this.fog.reveal(b.x, b.y, b.sight);
  }

  // ---- Unit AI + movement ----
  _updateUnit(u, dt) {
    if (u.hitFlash > 0) u.hitFlash -= dt;
    if (u.muzzle > 0) u.muzzle -= dt;
    if (u.attackTimer > 0) u.attackTimer -= dt;
    u.repathTimer -= dt;

    // Stuck recovery: a unit actively pathing but not making progress gets a nudge + repath.
    u._stkT = (u._stkT || 0) - dt;
    if (u._stkT <= 0) {
      u._stkT = 0.5;
      if (u.path && u.path.length) {
        const moved = dist(u.x, u.y, u._lx ?? u.x, u._ly ?? u.y);
        if (moved < 2.5) {
          u._stuckN = (u._stuckN || 0) + 1;
          if (u._stuckN >= 2) {
            const goal = u.path[u.path.length - 1];
            u.x += (Math.random() - 0.5) * 6; u.y += (Math.random() - 0.5) * 6;
            this._setPath(u, goal.x, goal.y);
            u._stuckN = 0;
          }
        } else u._stuckN = 0;
      } else u._stuckN = 0;
      u._lx = u.x; u._ly = u.y;
    }

    // Retaliate if attacked while idle/holding/gathering-empty.
    if (u.lastDamageFrom && !u.lastDamageFrom.dead && u.def.damage > 0) {
      if ((u.state === 'idle' || u.state === 'hold') && !u.target) {
        u.target = u.lastDamageFrom;
        if (u.state === 'idle') u.state = 'attack';
      }
    }
    u.lastDamageFrom = null;

    switch (u.state) {
      case 'idle': this._stateIdle(u, dt); break;
      case 'hold': this._stateHold(u, dt); break;
      case 'move': this._stateMove(u, dt); break;
      case 'attackMove': this._stateAttackMove(u, dt); break;
      case 'attack': this._stateAttack(u, dt); break;
      case 'gather': this._stateGather(u, dt); break;
      case 'returnCargo': this._stateReturn(u, dt); break;
      case 'build': this._stateBuild(u, dt); break;
    }
    this._applyMovement(u, dt);
  }

  _acquireRange(u) { return Math.max(u.def.range + 24, u.sight * TILE * 0.65); }

  _stateIdle(u, dt) {
    u.desiredVx = 0; u.desiredVy = 0;
    if (u.def.damage > 0 && !u.isWorker) {
      const e = this.findNearestEnemy(u.team, u.x, u.y, this._acquireRange(u));
      if (e) { u.target = e; u.guard = { x: u.x, y: u.y }; u.state = 'attack'; }
    }
  }
  _stateHold(u, dt) {
    u.desiredVx = 0; u.desiredVy = 0;
    if (u.def.damage <= 0) return;
    let t = u.target && !u.target.dead ? u.target : this.findNearestEnemy(u.team, u.x, u.y, u.def.range + u.radius + 4);
    if (t && this.rangeDist(u, t) <= u.def.range) { u.target = t; this._faceAndFire(u, t, dt); }
    else u.target = null;
  }
  _stateMove(u, dt) {
    if (!u.moveGoal) { this._nextQueued(u); return; }
    if (this._followPath(u, dt)) { this._nextQueued(u); }
  }
  _stateAttackMove(u, dt) {
    // Engage enemies encountered along the way.
    const e = this.findNearestEnemy(u.team, u.x, u.y, this._acquireRange(u));
    if (e && !u.isWorker && u.def.damage > 0) { u.target = e; u.amGoal = u.moveGoal; u.state = 'attack'; u._fromAM = true; return; }
    if (!u.moveGoal) { this._nextQueued(u); return; }
    if (this._followPath(u, dt)) { this._nextQueued(u); }
  }
  _stateAttack(u, dt) {
    let t = u.target;
    if (!t || t.dead) {
      u.target = null;
      if (u._fromAM && u.amGoal) { u.state = 'attackMove'; u.moveGoal = u.amGoal; u._fromAM = false; this._setPath(u, u.amGoal.x, u.amGoal.y); return; }
      if (u.guard) { const g = u.guard; u.guard = null; u.state = 'move'; u.moveGoal = g; this._setPath(u, g.x, g.y); return; }
      this._nextQueued(u); return;
    }
    const rd = this.rangeDist(u, t);
    if (rd <= u.def.range) {
      u.path = null; u.desiredVx = 0; u.desiredVy = 0;
      this._faceAndFire(u, t, dt);
    } else {
      // Move into range; repath periodically toward a moving target.
      if (!u.path || u.repathTimer <= 0) {
        const aim = this._approachPoint(u, t);
        this._setPath(u, aim.x, aim.y); u.repathTimer = 0.5;
      }
      this._followPath(u, dt);
    }
  }
  _approachPoint(u, t) {
    const a = angleTo(t.x, t.y, u.x, u.y);
    const d = (t.radius || 0) + u.def.range * 0.8;
    return { x: t.x + Math.cos(a) * d, y: t.y + Math.sin(a) * d };
  }
  _faceAndFire(u, t, dt) {
    const ang = angleTo(u.x, u.y, t.x, t.y);
    u.angle = rotateToward(u.angle, ang, 9 * dt);
    if (u.attackTimer <= 0 && Math.abs(((ang - u.angle + Math.PI * 3) % TAU) - Math.PI) < 0.5) {
      this._fire(u, t);
      u.attackTimer = u.def.attackCooldown;
    }
  }
  _fire(u, t) {
    u.muzzle = 0.08;
    if (u.def.attackKind === 'ranged') {
      const p = new Projectile(u.x + Math.cos(u.angle) * u.radius, u.y + Math.sin(u.angle) * u.radius, t, {
        speed: u.def.projSpeed, damage: u.def.damage, splash: u.def.splash || 0,
        team: u.team, color: u.def.projColor,
      });
      this.projectiles.push(p);
      if (u.key === 'tank') Sfx.cannon(); else Sfx.shoot();
    } else {
      // Melee: instant.
      this.hurt(t, u.def.damage, u);
      this._impact(t.x, t.y, u.def.projColor || '#fff', 4);
      Sfx.hit();
    }
  }

  _stateGather(u, dt) {
    // Return cargo first if full.
    if (u.cargo > 0) { u.state = 'returnCargo'; return this._stateReturn(u, dt); }
    let patch = u.gatherPatch;
    if (!patch || patch.dead || patch.amount <= 0) {
      patch = this.nearestMineral(u.x, u.y);
      u.gatherPatch = patch;
      if (!patch) { u.state = 'idle'; return; }
    }
    const d = dist(u.x, u.y, patch.x, patch.y);
    // Mineral tiles are solid, so a worker can only ever stand on an ADJACENT tile
    // (one tile = TILE px away, ~1.4*TILE diagonally). Reach must cover that or the
    // worker stands next to the crystals "mining" forever without ever collecting.
    if (d <= u.radius + patch.radius + TILE * 0.8) {
      u.path = null; u.desiredVx = 0; u.desiredVy = 0;
      u.gatherReachTimer = 0;
      u.angle = angleTo(u.x, u.y, patch.x, patch.y);
      u.gatherTimer += dt;
      if (u.gatherTimer >= 1.4) {
        u.gatherTimer = 0;
        const got = Math.min(MINERAL_PER_TRIP, patch.amount);
        patch.amount -= got; u.cargo = got;
        if (patch.amount <= 0) patch.dead = true;
        Sfx.gather();
        u.state = 'returnCargo';
      }
    } else {
      // Stuck-recovery: if a worker can't get within mine-range of THIS specific
      // patch for a while (hemmed in by other crystals or crowded by other workers),
      // re-target the nearest reachable patch — the same behaviour as auto-gather,
      // so a manual right-click can never leave a worker "mining" with no payoff.
      u.gatherReachTimer = (u.gatherReachTimer || 0) + dt;
      if (u.gatherReachTimer > 2.5) {
        u.gatherReachTimer = 0;
        const alt = this.nearestMineral(u.x, u.y);
        if (alt && alt !== patch) { u.gatherPatch = patch = alt; u.path = null; u.repathTimer = 0; }
      }
      if (!u.path || u.repathTimer <= 0) { this._setPath(u, patch.x, patch.y); u.repathTimer = 0.6; }
      this._followPath(u, dt);
    }
  }
  _stateReturn(u, dt) {
    let drop = u.dropoff;
    if (!drop || drop.dead || drop.constructing) { drop = this.nearestDropoff(u.team, u.x, u.y); u.dropoff = drop; }
    if (!drop) { u.state = 'idle'; return; }
    const r = drop.footprintRect();
    const cx = clamp(u.x, r.x, r.x + r.w), cy = clamp(u.y, r.y, r.y + r.h);
    const d = dist(u.x, u.y, cx, cy);
    if (d <= u.radius + 6) {
      this.players[u.team].minerals += u.cargo;
      if (u.team === TEAM.PLAYER && u.cargo > 0) this.stats.playerDeliveries++;
      u.cargo = 0;
      u.dropoff = drop;
      u.state = 'gather'; // go back for more
    } else {
      if (!u.path || u.repathTimer <= 0) { this._setPath(u, drop.x, drop.y); u.repathTimer = 0.6; }
      this._followPath(u, dt);
    }
  }
  _stateBuild(u, dt) {
    const b = u.buildTask;
    if (!b || b.dead) { u.state = 'idle'; return; }
    if (!b.constructing) { u.buildTask = null; u.state = 'idle'; return; }
    const r = b.footprintRect();
    const cx = clamp(u.x, r.x, r.x + r.w), cy = clamp(u.y, r.y, r.y + r.h);
    const d = dist(u.x, u.y, cx, cy);
    if (d <= u.radius + 8) {
      u.path = null; u.desiredVx = 0; u.desiredVy = 0;
      b._activeBuilder = u.id;
      b.angle = 0;
    } else {
      if (!u.path || u.repathTimer <= 0) { this._setPath(u, b.x, b.y); u.repathTimer = 0.6; }
      this._followPath(u, dt);
    }
  }

  // Move along current path; returns true when final goal reached.
  _followPath(u, dt) {
    if (!u.path || u.path.length === 0) { u.desiredVx = 0; u.desiredVy = 0; return true; }
    let wp = u.path[u.pathIdx];
    const dToWp = dist(u.x, u.y, wp.x, wp.y);
    const isLast = u.pathIdx >= u.path.length - 1;
    const arriveR = isLast ? u.radius + 2 : TILE * 0.5;
    if (dToWp <= arriveR) {
      if (isLast) { u.desiredVx = 0; u.desiredVy = 0; u.path = null; return true; }
      u.pathIdx++; wp = u.path[u.pathIdx];
    }
    const ang = angleTo(u.x, u.y, wp.x, wp.y);
    u.desiredVx = Math.cos(ang) * u.speed;
    u.desiredVy = Math.sin(ang) * u.speed;
    return false;
  }

  // Steering: blend desired velocity with separation, integrate, resolve tiles.
  _applyMovement(u, dt) {
    let dvx = u.desiredVx || 0, dvy = u.desiredVy || 0;
    // Separation from neighbors.
    this.hash.query(u.x, u.y, TILE * 1.8, this._neighbors);
    let sx = 0, sy = 0, count = 0;
    for (const o of this._neighbors) {
      if (o === u || o.dead) continue;
      const dx = u.x - o.x, dy = u.y - o.y;
      const d2 = dx * dx + dy * dy;
      const minD = u.radius + o.radius + 2;
      if (d2 > 0 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / minD;
        sx += (dx / d) * push; sy += (dy / d) * push; count++;
      }
    }
    if (count > 0) {
      const moving = (dvx || dvy);
      const w = moving ? u.speed * 0.6 : u.speed * 1.0;
      dvx += sx * w; dvy += sy * w;
    }
    // Clamp to speed.
    const sp = Math.hypot(dvx, dvy);
    if (sp > u.speed) { dvx = dvx / sp * u.speed; dvy = dvy / sp * u.speed; }
    if (sp < 0.01 && count === 0) { u.vx = 0; u.vy = 0; return; }

    let nx = u.x + dvx * dt, ny = u.y + dvy * dt;
    // Resolve against solid tiles (slide).
    if (this.grid.isSolid(this.grid.worldToTileX(nx), this.grid.worldToTileY(u.y))) nx = u.x;
    if (this.grid.isSolid(this.grid.worldToTileX(u.x), this.grid.worldToTileY(ny))) ny = u.y;
    // Keep inside map.
    nx = clamp(nx, u.radius, this.W * TILE - u.radius);
    ny = clamp(ny, u.radius, this.H * TILE - u.radius);
    u.vx = (nx - u.x) / dt; u.vy = (ny - u.y) / dt;
    u.x = nx; u.y = ny;
    if (Math.abs(dvx) + Math.abs(dvy) > 1 && (u.state === 'move' || u.state === 'attackMove' || u.path)) {
      u.angle = angleTo(0, 0, dvx, dvy);
    }
  }

  // ---- Buildings ----
  _updateBuilding(b, dt) {
    if (b.hitFlash > 0) b.hitFlash -= dt;
    if (b.spawnPulse > 0) b.spawnPulse -= dt;

    if (b.constructing) {
      // Progress only while a worker is actively on-site.
      if (b._activeBuilder != null) {
        const w = this.byId(b._activeBuilder);
        // _stateBuild only flags a builder once it is on-site, so trust that flag here.
        if (w && !w.dead && w.state === 'build') {
          b.buildProgress += dt / b.buildTime;
          b.hp = Math.min(b.maxHp, b.maxHp * (0.08 + 0.92 * b.buildProgress));
          if (b.buildProgress >= 1) {
            b.buildProgress = 1; b.constructing = false; b.hp = b.maxHp; b.spawnPulse = 0.6;
            if (b.team === TEAM.PLAYER) { Sfx.build(); this.toast(`${b.def.name} complete`, 'good'); }
            // Builder returns to gathering if it's a worker.
            const builder = this.byId(b.builderId);
            if (builder && !builder.dead && builder.isWorker) { builder.buildTask = null; builder.state = 'gather'; }
          }
        }
      }
      b._activeBuilder = null;
      return;
    }

    // Production.
    if (b.queue.length) {
      const item = b.queue[0];
      item.timeLeft -= dt;
      if (item.timeLeft <= 0) {
        this._spawnFromBuilding(b, item.key);
        b.queue.shift();
      }
    }
    // Turret / defensive auto-attack.
    if (b.def.attackKind && b.def.damage) {
      if (b.attackTimer > 0) b.attackTimer -= dt;
      let t = b.target && !b.target.dead && this.rangeDist(b, b.target) <= b.def.range ? b.target
        : this.findNearestEnemy(b.team, b.x, b.y, b.def.range);
      b.target = t;
      if (t && b.attackTimer <= 0) {
        const p = new Projectile(b.x, b.y - 6, t, {
          speed: b.def.projSpeed, damage: b.def.damage, splash: 0, team: b.team, color: b.def.projColor,
        });
        this.projectiles.push(p);
        Sfx.shoot();
        b.attackTimer = b.def.attackCooldown;
      }
    }
  }
  _spawnFromBuilding(b, key) {
    // Find a free spot just outside the building footprint.
    const r = b.footprintRect();
    const spot = this.grid.nearestFree(b.x, r.y + r.h + TILE, 8);
    const u = this.spawnUnit(key, b.team, spot.x, spot.y);
    u.spawnTime = this.time;
    // Rally.
    if (b.rally) {
      const rallyEnt = this.entityAt(b.rally.x, b.rally.y);
      if (rallyEnt && rallyEnt.kind === 'resource' && u.isWorker) this.gather(u, rallyEnt);
      else this.moveTo(u, b.rally.x, b.rally.y);
    } else if (u.isWorker) {
      // Auto-send new workers to mine.
      const patch = this.nearestMineral(b.x, b.y);
      if (patch) this.gather(u, patch);
    }
    if (b.team === TEAM.PLAYER) Sfx.ready();
  }

  // ---- Projectiles ----
  _updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (p.dead) continue;
      if (p.target && !p.target.dead) { p.tx = p.target.x; p.ty = p.target.y; }
      const a = angleTo(p.x, p.y, p.tx, p.ty);
      const step = p.speed * dt;
      const d = dist(p.x, p.y, p.tx, p.ty);
      if (d <= step + 4) {
        // Impact.
        if (p.splash > 0) {
          this.hash.query(p.tx, p.ty, p.splash + TILE * 2, this._neighbors);
          for (const o of this._neighbors) {
            if (o.dead || o.team === p.team || o.team === TEAM.NEUTRAL) continue;
            const dd = dist(p.tx, p.ty, o.x, o.y);
            if (dd <= p.splash) this.hurt(o, p.damage * (1 - dd / p.splash * 0.5), null);
          }
          for (const b of this.buildings) {
            if (b.dead || b.team === p.team || b.team === TEAM.NEUTRAL) continue;
            const dd = dist(p.tx, p.ty, b.x, b.y) - b.radius;
            if (dd <= p.splash) this.hurt(b, p.damage * (1 - clamp(dd, 0, p.splash) / p.splash * 0.5), null);
          }
          this._explosion(p.tx, p.ty, p.color, p.splash);
          Sfx.explode();
        } else {
          if (p.target && !p.target.dead) this.hurt(p.target, p.damage, null);
          this._impact(p.tx, p.ty, p.color, 5);
          Sfx.hit();
        }
        p.dead = true;
      } else {
        p.x += Math.cos(a) * step; p.y += Math.sin(a) * step;
      }
    }
  }

  // ---- Particles ----
  _impact(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = randRange(this.rng, 30, 110);
      this.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, randRange(this.rng, 0.15, 0.35), color, randRange(this.rng, 1, 2.5)));
    }
  }
  _explosion(x, y, color, size) {
    const n = Math.floor(size / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = randRange(this.rng, 40, 180);
      this.particles.push(new Particle(x, y, Math.cos(a) * s, Math.sin(a) * s, randRange(this.rng, 0.25, 0.6), i % 3 ? color : '#ffcf6b', randRange(this.rng, 2, 4.5), 'fire'));
    }
    this.particles.push(new Particle(x, y, 0, 0, 0.3, color, size, 'shock'));
  }
  _updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) { p.dead = true; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
    }
  }

  // ---- Cleanup / deaths ----
  _cleanup() {
    // Units
    for (const u of this.units) {
      if (u.dead) {
        this._explosion(u.x, u.y, u.team === TEAM.PLAYER ? '#7fc7ff' : '#ff8a96', u.radius * 1.6);
        if (u.team === TEAM.PLAYER) Sfx.explode();
        const i = this.selection.indexOf(u); if (i >= 0) this.selection.splice(i, 1);
      }
    }
    this.units = this.units.filter(u => !u.dead);
    // Buildings
    for (const b of this.buildings) {
      if (b.dead) {
        this.grid.vacate(b.tx, b.ty, b.tw, b.th);
        this._explosion(b.x, b.y, '#ffcf6b', b.radius * 2.2);
        Sfx.explode();
        const i = this.selection.indexOf(b); if (i >= 0) this.selection.splice(i, 1);
        // Refund partial? no. Free builder if constructing.
      }
    }
    this.buildings = this.buildings.filter(b => !b.dead);
    // Resources
    for (const r of this.resources) if (r.dead) this.grid.vacate(r.tx, r.ty, 1, 1);
    this.resources = this.resources.filter(r => !r.dead);
    this.projectiles = this.projectiles.filter(p => !p.dead);
    this.particles = this.particles.filter(p => !p.dead);
  }

  _checkWinLose() {
    const playerCC = this.buildings.some(b => b.team === TEAM.PLAYER && b.key === 'command');
    const enemyCC = this.buildings.some(b => b.team === TEAM.ENEMY && b.key === 'command');
    const playerAny = this.units.some(u => u.team === TEAM.PLAYER) || this.buildings.some(b => b.team === TEAM.PLAYER);
    const enemyAny = this.units.some(u => u.team === TEAM.ENEMY) || this.buildings.some(b => b.team === TEAM.ENEMY);
    if ((!enemyCC && !enemyAny) || (!enemyCC && this.time > 5)) { this.gameOver = 'victory'; }
    else if (!playerCC && !playerAny) { this.gameOver = 'defeat'; }
    else if (!playerCC && this.time > 5) { this.gameOver = 'defeat'; }
  }

  hurt(target, raw, from) {
    const dmg = applyDamage(target, raw, from);
    if (target.team === TEAM.PLAYER) this.notifyUnderAttack(target.x, target.y);
    return dmg;
  }

  toast(text, kind = '') { this.toasts.push({ text, kind, t: 0 }); }

  // Alert the player when something of theirs is under attack.
  notifyUnderAttack(x, y) {
    if (this.time - this.lastAttackedAlert > 6) {
      this.lastAttackedAlert = this.time;
      this.toast('Your forces are under attack!', 'bad');
      Sfx.alert();
      this.spawnPing(x, y, '#ef5366');
    }
  }
}
