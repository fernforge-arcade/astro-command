// Interactive, step-driven tutorial that teaches the core economy loop:
// select a worker -> right-click minerals -> watch the drop-off raise your count.
// Each step has a `done(g)` predicate polled every frame and an optional
// `highlight(g)` that returns a world-space point to ring + arrow on the canvas.
import { TEAM } from './config.js';
import { dist, TAU } from './util.js';

function playerCommand(g) {
  return g.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command' && !b.dead);
}
function nearestWorker(g) {
  const cc = playerCommand(g);
  let best = null, bd = Infinity;
  for (const u of g.units) {
    if (u.dead || u.team !== TEAM.PLAYER || !u.isWorker) continue;
    const d = cc ? dist(u.x, u.y, cc.x, cc.y) : 0;
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}
function selectedWorker(g) {
  return g.selection.find(e => e.kind === 'unit' && e.isWorker && e.team === TEAM.PLAYER && !e.dead) || null;
}
function nearestMineral(g) {
  const cc = playerCommand(g);
  if (!cc) return null;
  let best = null, bd = Infinity;
  for (const r of g.resources) {
    if (r.dead || r.amount <= 0) continue;
    const d = dist(r.x, r.y, cc.x, cc.y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}
function anyWorkerMining(g) {
  return g.units.some(u =>
    !u.dead && u.team === TEAM.PLAYER && u.isWorker &&
    (u.state === 'gather' || u.state === 'returnCargo' || u.gatherPatch || u.cargo > 0));
}

export class Tutorial {
  constructor(game, onFinish) {
    this.g = game;
    this.onFinish = onFinish;
    this.active = true;
    this.idx = 0;
    this._t = 0; // animation clock for highlight pulse
    this._baseDeliveries = game.stats.playerDeliveries;

    this.steps = [
      {
        title: 'Welcome, Commander',
        body: 'Minerals <span class="m">◆</span> pay for everything — workers, soldiers, buildings. ' +
              'Your <b>Workers</b> gather them. Let’s collect your first load together.',
        next: 'Show me',           // manual advance via button
      },
      {
        title: 'Step 1 — Select a Worker',
        body: 'Move your mouse over the highlighted <b>Worker</b> and <b>left-click</b> it. ' +
              'A selected unit shows a green ring and appears in the panel at the bottom.',
        highlight: g => { const w = nearestWorker(g); return w && { x: w.x, y: w.y, r: 26, color: '#3ddc84' }; },
        done: g => !!selectedWorker(g),
        // Click forgiveness: the highlight ring (r=26, pulsing to 34) is drawn much
        // larger than the worker's actual hit radius (12) so it's visible at a glance —
        // but that means a click anywhere in the visible ring should count, or a player
        // clicking where we told them to look gets nothing (reported: "it says click the
        // item above, and when I do nothing happens").
        forgive: (g, wx, wy) => {
          const w = nearestWorker(g);
          if (w && dist(wx, wy, w.x, w.y) <= 26) { g._addToSelection(w); g._normalizeSelection(); }
        },
      },
      {
        title: 'Step 2 — Send it to mine',
        body: 'With your Worker selected, <b>right-click</b> the glowing mineral crystals ' +
              '<span class="m">◆</span>. The Worker walks over and starts mining automatically.',
        highlight: g => { const r = nearestMineral(g); return r && { x: r.x, y: r.y, r: 30, color: '#46b6ff' }; },
        done: g => anyWorkerMining(g),
      },
      {
        title: 'Step 3 — Watch the drop-off',
        body: 'Your Worker mines a load, then carries it back to the <b>Command Center</b> and drops it off — ' +
              'watch your <span class="m">◆</span> count climb. It keeps doing this on its own.',
        highlight: g => { const c = playerCommand(g); return c && { x: c.x, y: c.y, r: 60, color: '#ffd24a' }; },
        done: g => g.stats.playerDeliveries > this._baseDeliveries,
      },
      {
        title: 'You’ve got it! ✓',
        body: 'That’s the economy. Keep Workers mining and your income never stops.<br><br>' +
              '<b>Pro tips:</b><br>' +
              '• Select your <b>Command Center</b> and press <kbd>D</kbd> to train more Workers — more Workers = faster growth.<br>' +
              '• Drag a box to select many units at once.<br>' +
              '• Build a <b>Supply Depot</b> (worker → place it) to raise your unit cap.<br>' +
              'Now go build an army and destroy the enemy base. Good luck!',
        next: 'Finish',
        finish: true,
      },
    ];

    this._buildDom();
    this._render();
  }

  _buildDom() {
    const el = document.createElement('div');
    el.id = 'tutorial';
    el.innerHTML = `
      <div class="tut-card">
        <div class="tut-step"></div>
        <h3 class="tut-title"></h3>
        <p class="tut-body"></p>
        <div class="tut-row">
          <button class="tut-skip">Skip tutorial</button>
          <div class="tut-spacer"></div>
          <span class="tut-hint"></span>
          <button class="tut-next">Next</button>
        </div>
      </div>`;
    document.getElementById('game-root').appendChild(el);
    this.el = el;
    el.querySelector('.tut-skip').addEventListener('click', () => this.finish());
    this._nextBtn = el.querySelector('.tut-next');
    this._nextBtn.addEventListener('click', () => this._advance());
  }

  _render() {
    const s = this.steps[this.idx];
    this.el.querySelector('.tut-step').textContent = `Tutorial · ${this.idx + 1}/${this.steps.length}`;
    this.el.querySelector('.tut-title').textContent = s.title;
    this.el.querySelector('.tut-body').innerHTML = s.body;
    const hint = this.el.querySelector('.tut-hint');
    if (s.next) {            // manual step: show the button, no auto hint
      this._nextBtn.style.display = '';
      this._nextBtn.textContent = s.next;
      hint.textContent = '';
    } else {                // task step: wait for the player to do it
      this._nextBtn.style.display = 'none';
      hint.textContent = 'Do the action above to continue…';
    }
  }

  _advance() {
    const s = this.steps[this.idx];
    if (s.finish) { this.finish(); return; }
    this.idx++;
    if (this.idx >= this.steps.length) { this.finish(); return; }
    // Re-baseline the delivery counter when we reach the watch step.
    if (this.steps[this.idx].done && this.steps[this.idx].title.includes('Step 3')) {
      this._baseDeliveries = this.g.stats.playerDeliveries;
    }
    this._render();
  }

  // Called after a click that selected nothing, so a step can widen its own
  // hit-test to match what its highlight visually promises.
  tryForgive(wx, wy) {
    if (!this.active) return;
    const s = this.steps[this.idx];
    if (s.forgive) s.forgive(this.g, wx, wy);
  }

  // Called every frame from the main loop.
  update(dt) {
    if (!this.active) return;
    this._t += dt;
    const s = this.steps[this.idx];
    if (s.done && s.done(this.g)) {
      // brief success flash then advance
      this.el.querySelector('.tut-card').classList.add('done');
      setTimeout(() => this.el && this.el.querySelector('.tut-card').classList.remove('done'), 350);
      this._advance();
    }
  }

  // Draw the world-space highlight (ring + bobbing arrow) over the game.
  draw(ctx, camera) {
    if (!this.active) return;
    const s = this.steps[this.idx];
    if (!s.highlight) return;
    const h = s.highlight(this.g);
    if (!h) return;
    const p = { x: camera.worldToScreenX(h.x), y: camera.worldToScreenY(h.y) };
    const z = camera.zoom || 1;
    const r = h.r * z;
    const pulse = 0.5 + 0.5 * Math.sin(this._t * 5);

    ctx.save();
    // pulsing ring
    ctx.strokeStyle = h.color;
    ctx.globalAlpha = 0.6 + 0.4 * pulse;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + pulse * 8, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.stroke();

    // bobbing arrow above the target, pointing down at it
    const bob = pulse * 8;
    const ax = p.x, ayTip = p.y - r - 14 - bob, aTop = ayTip - 26;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.moveTo(ax, ayTip);
    ctx.lineTo(ax - 11, aTop);
    ctx.lineTo(ax - 4, aTop);
    ctx.lineTo(ax - 4, aTop - 16);
    ctx.lineTo(ax + 4, aTop - 16);
    ctx.lineTo(ax + 4, aTop);
    ctx.lineTo(ax + 11, aTop);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  finish() {
    this.active = false;
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
    if (this.onFinish) this.onFinish();
  }
}
