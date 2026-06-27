// Headless simulation smoke test — runs the core game loop without a browser.
import { Game } from '../src/game.js';
import { TEAM, TICK } from '../src/config.js';

function run(diff, size, seconds) {
  const g = new Game({ difficulty: diff, mapSize: size, seed: 12345 });
  g.camera.setViewport(1280, 720);

  // Sanity: both sides have a command center + 5 workers.
  const pCC = g.buildings.filter(b => b.team === TEAM.PLAYER && b.key === 'command').length;
  const eCC = g.buildings.filter(b => b.team === TEAM.ENEMY && b.key === 'command').length;
  const pW = g.units.filter(u => u.team === TEAM.PLAYER && u.isWorker).length;
  assert(pCC === 1 && eCC === 1, 'each side has one command center');
  assert(pW === 5, 'player starts with 5 workers');

  // Send all player workers to mine.
  for (const u of g.units) if (u.team === TEAM.PLAYER && u.isWorker) {
    const patch = g.nearestMineral(u.x, u.y);
    if (patch) g.gather(u, patch);
  }
  // Queue a worker and a barracks-style flow via AI for enemy; player builds a depot.
  const cc = g.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command');
  g.queueUnit(cc, 'worker');

  const startMin = g.players[TEAM.PLAYER].minerals;
  let placedBarracks = false, queuedMarine = false;
  const ticks = Math.floor(seconds / TICK);
  for (let i = 0; i < ticks; i++) {
    g.update(TICK);
    // Around 8s: place a barracks via AI helper (reuses placement path).
    if (!placedBarracks && g.time > 8 && g.players[TEAM.PLAYER].minerals > 200) {
      const b = g.aiPlaceBuilding(TEAM.PLAYER, 'barracks');
      placedBarracks = !!b;
    }
    // Once barracks complete, queue a marine.
    if (!queuedMarine) {
      const rb = g.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'barracks' && !b.constructing);
      if (rb) { queuedMarine = g.queueUnit(rb, 'marine'); }
    }
    if (g.gameOver) break;
  }

  const minedSomething = g.players[TEAM.PLAYER].minerals !== startMin;
  const fogExplored = g.fog.explored.some(v => v === 1);
  const enemyHasArmy = g.units.some(u => u.team === TEAM.ENEMY && !u.isWorker);
  const enemyBuildings = g.buildings.filter(b => b.team === TEAM.ENEMY).length;

  console.log(`[${diff}/${size}] t=${g.time.toFixed(0)}s ` +
    `pMin=${Math.floor(g.players[TEAM.PLAYER].minerals)} ` +
    `pUnits=${g.units.filter(u => u.team === TEAM.PLAYER).length} ` +
    `eUnits=${g.units.filter(u => u.team === TEAM.ENEMY).length} ` +
    `eBldg=${enemyBuildings} barracks=${placedBarracks} marine=${queuedMarine} over=${g.gameOver || '-'}`);

  assert(minedSomething, 'player mineral total changed (economy works)');
  assert(fogExplored, 'fog has explored tiles');
  assert(placedBarracks, 'player placed a barracks');
  assert(enemyHasArmy, 'enemy AI trained military units');
  assert(g.players[TEAM.ENEMY].supplyCap > 0, 'enemy has supply');
  assert(!Number.isNaN(g.players[TEAM.PLAYER].minerals), 'no NaN minerals');
}

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); }
  else { console.error('  ✗ FAIL: ' + msg); failures++; }
}

run('normal', 'medium', 150);
run('hard', 'small', 120);
run('easy', 'large', 100);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
