// Enemy AI: economy ramp, tech, army production, and attack waves.
import { TEAM, UNITS, BUILDINGS, TILE } from './config.js';
import { dist2 } from './util.js';

export class AI {
  constructor(game, team, diff) {
    this.g = game; this.team = team; this.diff = diff;
    this.think = 0;
    this.attackTimer = diff.aiFirstAttack;   // seconds until first push
    this.waveNo = 0;
    this.targetWorkers = 12;
    this.attacking = false;
    this.armySize = diff.aiArmySize;
  }

  myBuildings(key) { return this.g.buildings.filter(b => b.team === this.team && (!key || b.key === key)); }
  myUnits(key) { return this.g.units.filter(u => u.team === this.team && (!key || u.key === key)); }
  hasComplete(key) { return this.g.buildings.some(b => b.team === this.team && b.key === key && !b.constructing); }
  countBuilding(key, includeUnbuilt = true) {
    return this.g.buildings.filter(b => b.team === this.team && b.key === key && (includeUnbuilt || !b.constructing)).length;
  }
  isBuilding(key) { return this.g.buildings.some(b => b.team === this.team && b.key === key && b.constructing); }

  update(dt) {
    this.attackTimer -= dt;
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 1.1 * this.diff.aiBuildDelay;

    const g = this.g, team = this.team, p = g.players[team];
    // Passive mineral trickle to keep AI competitive (scaled by difficulty).
    p.minerals += 6 * this.diff.aiMineralMult * this.think;

    const workers = this.myUnits('worker').length;
    const supplyFree = g.supplyFree(team);
    const supplyCap = p.supplyCap;

    // 1) Supply management — build depots before getting blocked.
    if (supplyFree <= 3 && supplyCap < 190 && !this.isBuilding('depot') && p.minerals >= BUILDINGS.depot.cost) {
      g.aiPlaceBuilding(team, 'depot');
      return;
    }

    // 2) Worker production from command centers.
    const cc = this.myBuildings('command')[0];
    if (cc && !cc.constructing && workers < this.targetWorkers && cc.queue.length === 0 && supplyFree > 0) {
      g.queueUnit(cc, 'worker');
    }

    // 3) Tech buildings.
    if (!this.hasComplete('barracks') && !this.isBuilding('barracks') && workers >= 6 && p.minerals >= BUILDINGS.barracks.cost) {
      g.aiPlaceBuilding(team, 'barracks'); return;
    }
    if (this.hasComplete('barracks') && this.countBuilding('barracks') < 2 && p.minerals >= 350 && !this.isBuilding('barracks')) {
      g.aiPlaceBuilding(team, 'barracks');
    }
    if (this.hasComplete('barracks') && !this.hasComplete('factory') && !this.isBuilding('factory') && p.minerals >= BUILDINGS.factory.cost + 50) {
      g.aiPlaceBuilding(team, 'factory'); return;
    }
    // Defensive turret near base after a while.
    if (this.hasComplete('barracks') && this.countBuilding('turret') < 2 && p.minerals >= 320 && !this.isBuilding('turret') && g.time > 120) {
      g.aiPlaceBuilding(team, 'turret');
    }

    // 4) Army production.
    const racks = this.myBuildings('barracks').filter(b => !b.constructing);
    for (const r of racks) {
      if (r.queue.length >= 2) continue;
      if (supplyFree < 2) break;
      // Mix in rangers if factory exists.
      if (this.hasComplete('factory') && Math.random() < 0.35 && p.minerals >= UNITS.ranger.cost) g.queueUnit(r, 'ranger');
      else if (p.minerals >= UNITS.marine.cost) g.queueUnit(r, 'marine');
    }
    const facts = this.myBuildings('factory').filter(b => !b.constructing);
    for (const f of facts) {
      if (f.queue.length >= 1) continue;
      if (supplyFree < 4) break;
      if (p.minerals >= UNITS.tank.cost) g.queueUnit(f, 'tank');
    }

    // 5) Keep idle military units defending near base; rally fresh troops.
    this._manageArmy();

    // 6) Launch attack waves.
    if (this.attackTimer <= 0) this._launchWave();
  }

  army() {
    return this.myUnits().filter(u => !u.isWorker && u.def.damage > 0);
  }

  _manageArmy() {
    // Gather idle soldiers at a staging point near the command center.
    const cc = this.myBuildings('command')[0];
    if (!cc) return;
    const stageX = cc.x + (this.team === TEAM.ENEMY ? -TILE * 4 : TILE * 4);
    const stageY = cc.y + TILE * 4;
    for (const b of this.myBuildings()) {
      if (b.def.rally && !b.rally && !b.constructing) b.rally = { x: stageX, y: stageY };
    }
  }

  _launchWave() {
    const g = this.g;
    const soldiers = this.army().filter(u => u.state === 'idle' || u.state === 'hold' || u.state === 'attackMove' || u.state === 'move');
    if (soldiers.length < this.armySize) {
      this.attackTimer = 8; // wait and re-check
      return;
    }
    // Pick a target: player's command center, else nearest player building/unit.
    const target = this._pickTarget();
    if (!target) { this.attackTimer = 10; return; }
    for (const u of this.army()) {
      g.attackMoveTo(u, target.x + (Math.random() * TILE * 3 - TILE * 1.5), target.y + (Math.random() * TILE * 3 - TILE * 1.5));
    }
    this.waveNo++;
    this.attacking = true;
    // Next wave grows and comes sooner.
    this.armySize = Math.min(40, this.armySize + 2);
    this.attackTimer = Math.max(40, 80 * this.diff.aiBuildDelay);
  }

  _pickTarget() {
    const g = this.g;
    let cc = g.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command');
    if (cc) return cc;
    let best = null, bd = Infinity;
    const ref = this.myBuildings('command')[0] || { x: 0, y: 0 };
    for (const b of g.buildings) if (b.team === TEAM.PLAYER) { const d = dist2(ref.x, ref.y, b.x, b.y); if (d < bd) { bd = d; best = b; } }
    for (const u of g.units) if (u.team === TEAM.PLAYER) { const d = dist2(ref.x, ref.y, u.x, u.y); if (d < bd) { bd = d; best = u; } }
    return best;
  }
}
