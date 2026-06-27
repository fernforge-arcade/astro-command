// Drives the interactive Tutorial through every step against a real Game,
// asserting each task-step advances only when its game-state condition is met.
import { Game } from '../src/game.js';
import { Tutorial } from '../src/tutorial.js';
import { TEAM } from '../src/config.js';

// ---- minimal DOM stub (only what Tutorial touches) ----
class El {
  constructor() { this._kids = new Map(); this.style = {}; this.textContent = ''; this._html = '';
    this.classList = { add() {}, remove() {}, contains: () => false }; this._l = []; }
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html; }
  querySelector(sel) { if (!this._kids.has(sel)) this._kids.set(sel, new El()); return this._kids.get(sel); }
  addEventListener(t, fn) { this._l.push([t, fn]); }
  appendChild(c) { return c; } removeChild() {} get parentNode() { return root; }
}
const root = new El();
global.document = { getElementById: () => root, createElement: () => new El() };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const g = new Game({ difficulty: 'easy', mapSize: 'small' });
let finished = false;
const tut = new Tutorial(g, () => { finished = true; });

ok(tut.idx === 0, 'starts on the intro step');

// Intro is a manual step; advance via its button.
tut._advance();
ok(tut.idx === 1, 'intro advances to Step 1 (select worker)');

// Step 1 should NOT complete with nothing selected.
tut.update(0.016);
ok(tut.idx === 1, 'Step 1 waits until a worker is selected');

// Select a worker -> Step 1 done.
const worker = g.units.find(u => u.team === TEAM.PLAYER && u.isWorker && !u.dead);
g.selection = [worker]; worker.selected = true;
tut.update(0.016);
ok(tut.idx === 2, 'Step 1 completes once a worker is selected');

// Step 2: not done until a worker is actually mining.
tut.update(0.016);
ok(tut.idx === 2, 'Step 2 waits until the worker is ordered to gather');

const patch = g.resources.find(r => !r.dead && r.amount > 0);
g.gather(worker, patch);
tut.update(0.016);
ok(tut.idx === 3, 'Step 2 completes once the worker is gathering');
ok(tut._baseDeliveries === g.stats.playerDeliveries, 'Step 3 baselines the delivery counter');

// Step 3: simulate the world until a delivery happens.
let guard = 0;
while (g.stats.playerDeliveries === tut._baseDeliveries && guard++ < 4000) {
  g.update(1 / 30);
  tut.update(1 / 30);
}
ok(g.stats.playerDeliveries > 0, 'a real mineral drop-off occurred in the sim');
ok(tut.idx === 4, 'Step 3 completes after the first drop-off');

// Final step is manual; finishing it fires the callback and removes the panel.
tut._advance();
ok(finished, 'finishing the last step calls onFinish');
ok(tut.active === false, 'tutorial deactivates after finish');

console.log(`\n${fail === 0 ? 'TUTORIAL TEST PASSED' : 'TUTORIAL TEST FAILED'} (${pass} ok, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
