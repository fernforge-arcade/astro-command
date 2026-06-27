// Regression test for the "worker plays the mining animation but never collects
// resources" bug. Mineral tiles are solid, so a worker stops on an ADJACENT tile;
// the mine-reach must cover that distance from every approach angle (incl. diagonal).
import { Game } from '../src/game.js';
import { TEAM, TILE } from '../src/config.js';
import { Unit, Resource } from '../src/entities.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function runApproach(label, dxTiles, dyTiles) {
  const g = new Game({ difficulty: 'easy', mapSize: 'small' });
  // Isolate: drop every existing worker and far-away minerals to remove noise.
  g.units = g.units.filter(u => u.team !== TEAM.PLAYER);

  // Player command center (drop-off) already exists near bottom-left.
  const cc = g.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command');
  // Put a fresh mineral patch 3 tiles to the right of the CC, on a free tile.
  const ptx = cc.tx + cc.tw + 2, pty = cc.ty;
  // clear & place
  if (g.grid.isSolid(ptx, pty)) g.grid.solid[g.grid.idx(ptx, pty)] = 0;
  const patch = new Resource(ptx, pty, 200);
  g.resources.push(patch);
  g.grid.occupy(ptx, pty, 1, 1, patch.id);

  // Spawn a worker offset by the requested approach direction, a couple tiles away.
  const wx = patch.x + dxTiles * TILE, wy = patch.y + dyTiles * TILE;
  const w = new Unit('worker', TEAM.PLAYER, wx, wy);
  g.units.push(w);

  g.gather(w, patch);
  const deliveries0 = g.stats.playerDeliveries;
  let mined = false;
  for (let i = 0; i < 600 && g.stats.playerDeliveries === deliveries0; i++) {
    g.update(1 / 30);
    if (w.cargo > 0) mined = true;
  }
  ok(mined, `${label}: worker actually collected a load (cargo went up)`);
  ok(g.stats.playerDeliveries > deliveries0, `${label}: worker delivered minerals to base`);
}

// The orthogonal case mostly worked before; the diagonal/offset cases were the ones
// that "animated but never collected".
runApproach('from the right', 2, 0);
runApproach('from below', 0, 2);
runApproach('from diagonal', 2, 2);
runApproach('from far diagonal', -3, 3);

// Regression: the PLAYER's manual right-click path goes through issueSelectionCommand,
// which used to mis-classify a (team-less) mineral patch as an enemy and order an
// ATTACK instead of a gather — so manual gather never collected anything, while
// auto-gather (which calls gather() directly) worked. Resources are now neutral.
{
  const g = new Game({ difficulty: 'normal', mapSize: 'medium' });
  const workers = g.units.filter(u => u.team === TEAM.PLAYER && u.isWorker);
  g.selection = workers.slice(); workers.forEach(w => w.selected = true);
  const cc = g.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command');
  let patch = null, bd = Infinity;
  for (const r of g.resources) { const d = (r.x - cc.x) ** 2 + (r.y - cc.y) ** 2; if (d < bd) { bd = d; patch = r; } }

  g.issueSelectionCommand(patch.x, patch.y, {});
  ok(workers.every(w => w.state === 'gather'),
     'right-click on a mineral patch issues GATHER (not attack) to every worker');

  const start = g.players[TEAM.PLAYER].minerals;
  const mined = new Set();
  for (let i = 0; i < 900; i++) { g.update(1 / 30); for (const w of workers) if (w.cargo > 0) mined.add(w.id); }
  ok(mined.size === workers.length, 'all workers actually collected a load via the manual command path');
  ok(g.players[TEAM.PLAYER].minerals > start, 'minerals increased from manual gathering');
}

console.log(`\n${fail === 0 ? 'GATHER TEST PASSED' : 'GATHER TEST FAILED'} (${pass} ok, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
