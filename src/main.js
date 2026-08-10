// Bootstrap: menus, input control, fixed-timestep loop, end screens.
import { TICK, TILE, TEAM, BUILDABLE, BUILDINGS, UNITS } from './config.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI, BUILD_HOTKEYS, PRODUCE_HOTKEYS } from './ui.js';
import { Input } from './input.js';
import { Sfx, resumeAudio } from './audio.js';
import { formatTime } from './util.js';
import { Tutorial } from './tutorial.js';

const canvas = document.getElementById('game');
let game = null, renderer = null, ui = null, input = null;
let controller = null, tutorial = null;
let running = false;
let acc = 0, lastTs = 0;

// ---- Canvas sizing ----
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (game) game.camera.setViewport(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);

// ---- Menu wiring ----
const menu = document.getElementById('menu');
const help = document.getElementById('help');
const endscreen = document.getElementById('endscreen');
let chosen = { difficulty: 'normal', mapSize: 'medium' };

function segSetup(id, key) {
  document.getElementById(id).querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(id).querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chosen[key] = btn.dataset.diff || btn.dataset.size;
    });
  });
}
segSetup('difficulty-seg', 'difficulty');
segSetup('mapsize-seg', 'mapSize');

document.getElementById('btn-start').addEventListener('click', () => startGame(false));
document.getElementById('btn-tutorial').addEventListener('click', () => startGame(true));
document.getElementById('btn-help').addEventListener('click', () => help.classList.remove('hidden'));
document.getElementById('btn-help-close').addEventListener('click', () => help.classList.add('hidden'));
document.getElementById('btn-again').addEventListener('click', () => { endscreen.classList.add('hidden'); menu.classList.remove('hidden'); });

function startGame(withTutorial) {
  resumeAudio();
  menu.classList.add('hidden');
  endscreen.classList.add('hidden');
  if (tutorial) { tutorial.finish(); tutorial = null; }
  resize();
  // The tutorial is easiest to follow on Easy + Small so the player isn't rushed.
  const opts = withTutorial
    ? { difficulty: 'easy', mapSize: 'small' }
    : { difficulty: chosen.difficulty, mapSize: chosen.mapSize };
  game = new Game(opts);
  game.camera.setViewport(canvas.width, canvas.height);
  // Re-center now that the viewport has real dimensions. The Game constructor
  // centers on the player's command center, but it runs before setViewport, so
  // at that point the viewport is 0x0 and the base lands in the top-left corner
  // (or clamps off-screen) — the player opens to an empty fog screen otherwise.
  {
    const pcc = game.buildings.find(b => b.team === TEAM.PLAYER && b.key === 'command');
    if (pcc) game.camera.centerOn(pcc.x, pcc.y);
  }
  renderer = new Renderer(canvas, game);
  input = new Input(canvas);
  controller = new Controller(game, () => ui);
  ui = new UI(game, controller.handlers);
  ui.show();
  if (withTutorial) tutorial = new Tutorial(game, () => { tutorial = null; });
  running = true; acc = 0; lastTs = performance.now();
  requestAnimationFrame(loop);
}

// ---- Main loop (fixed timestep) ----
function loop(ts) {
  if (!running) return;
  let dt = (ts - lastTs) / 1000; lastTs = ts;
  if (dt > 0.25) dt = 0.25; // avoid spiral after tab-out
  acc += dt;
  controller.preUpdate(dt);
  let steps = 0;
  while (acc >= TICK && steps < 6) { game.update(TICK); acc -= TICK; steps++; }
  ui.update();
  renderer.render(input, controller.dragBox());
  controller.drawCursorHint();
  if (tutorial && tutorial.active) {
    if (!game.paused) tutorial.update(dt);
    tutorial.draw(canvas.getContext('2d'), game.camera);
  }

  if (game.gameOver) { endGame(game.gameOver); return; }
  requestAnimationFrame(loop);
}

function endGame(result) {
  running = false;
  const title = document.getElementById('end-title');
  const sub = document.getElementById('end-sub');
  title.textContent = result === 'victory' ? 'VICTORY' : 'DEFEAT';
  title.className = result === 'victory' ? '' : 'defeat';
  sub.textContent = `${result === 'victory' ? 'Enemy command destroyed' : 'Your command center fell'} · Time ${formatTime(game.time)}`;
  endscreen.classList.remove('hidden');
  if (result === 'victory') Sfx.victory(); else Sfx.defeat();
}

// ---- Input controller ----
class Controller {
  constructor(game) {
    this.g = game;
    this.dragStart = null;
    this.isDragging = false;
    this.commandMode = null; // 'move' | 'attack'
    this.handlers = {
      onProduce: (b, k) => { this.g.queueUnit(b, k); ui && ui.markCardDirty(); },
      onBuild: (k) => this.g.beginPlacement(k),
      onCommand: (name) => this._command(name),
      onCommandMode: (mode) => { if (this._selUnits().length) this.commandMode = mode; },
      onQueueCancel: (b, i) => { this.g.cancelQueueItem(b, i); ui && ui.markCardDirty(); },
      onMinimapCommand: (x, y, shift) => { if (this._selUnits().length) this.g.issueSelectionCommand(x, y, { queued: shift }); },
      onTogglePause: () => this._togglePause(),
    };
  }
  _selUnits() { return this.g.selection.filter(e => e.kind === 'unit' && e.team === TEAM.PLAYER && !e.dead); }

  dragBox() {
    if (this.isDragging && this.dragStart) return { x0: this.dragStart.x, y0: this.dragStart.y, x1: input.mx, y1: input.my };
    return null;
  }

  preUpdate(dt) {
    this._handleEvents();
    if (!this.g.paused) this._cameraPan(dt);
  }

  _cameraPan(dt) {
    // Camera = arrow keys + screen-edge scroll + minimap drag.
    // (Letter keys are reserved for unit commands, so WASD is not used for panning.)
    const cam = this.g.camera;
    let dx = 0, dy = 0;
    const sp = 640 * dt;
    if (input.isKey('ArrowUp')) dy -= sp;
    if (input.isKey('ArrowDown')) dy += sp;
    if (input.isKey('ArrowLeft')) dx -= sp;
    if (input.isKey('ArrowRight')) dx += sp;
    const m = 6, ew = canvas.width, eh = canvas.height;
    if (input.mx >= 0 && input.mx < m) dx -= sp;
    if (input.mx > ew - m && input.mx <= ew) dx += sp;
    if (input.my >= 0 && input.my < m) dy -= sp;
    if (input.my > eh - m && input.my <= eh) dy += sp;
    if (dx || dy) cam.pan(dx, dy);
  }

  _handleEvents() {
    const events = input.drain();
    const cam = this.g.camera;
    for (const e of events) {
      if (e.type === 'wheel') { cam.zoomAt(e.x, e.y, e.delta < 0 ? 1.12 : 0.89); continue; }
      if (e.type === 'key') { this._key(e); continue; }
      if (e.type === 'down') this._mouseDown(e);
      if (e.type === 'up') this._mouseUp(e);
    }
  }

  _worldAt(sx, sy) { return this.g.camera.screenToWorld(sx, sy); }

  _mouseDown(e) {
    const g = this.g;
    if (g.paused) return;
    const w = this._worldAt(e.x, e.y);
    if (e.button === 0) { // left
      if (g.pendingBuild) {
        const pt = renderer._placeTile;
        if (pt) g.tryPlaceBuilding(pt.tx, pt.ty);
        if (!e.shift) g.pendingBuild = null;
        return;
      }
      if (this.commandMode) {
        if (this.commandMode === 'attack') g.issueSelectionCommand(w.x, w.y, { queued: e.shift, forceAttack: true });
        else g.issueSelectionCommand(w.x, w.y, { queued: e.shift, forceMove: true });
        if (!e.shift) this.commandMode = null;
        return;
      }
      this.dragStart = { x: e.x, y: e.y, shift: e.shift };
      this.isDragging = true;
    } else if (e.button === 2) { // right
      if (g.pendingBuild) { g.pendingBuild = null; return; }
      if (this.commandMode) { this.commandMode = null; return; }
      g.issueSelectionCommand(w.x, w.y, { queued: e.shift });
    }
  }

  _mouseUp(e) {
    const g = this.g;
    if (e.button !== 0 || !this.dragStart) { return; }
    const a = this.dragStart, b = { x: e.x, y: e.y };
    const wa = this._worldAt(a.x, a.y), wb = this._worldAt(b.x, b.y);
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    if (moved < 6) {
      // Double-click: select all of type on screen.
      const now = performance.now();
      const ent = g.entityAt(wa.x, wa.y);
      if (this._lastClickEnt && this._lastClickEnt === (ent && ent.id) && now - (this._lastClickT || 0) < 320 && ent && ent.kind === 'unit') {
        g.selectAllOfTypeOnScreen(ent.key);
      } else {
        g.selectAt(wa.x, wa.y, a.shift);
        if (!g.selection.length && tutorial) tutorial.tryForgive(wa.x, wa.y);
      }
      this._lastClickEnt = ent ? ent.id : null; this._lastClickT = now;
    } else {
      g.selectBox(wa.x, wa.y, wb.x, wb.y, a.shift);
    }
    this.dragStart = null; this.isDragging = false;
  }

  _key(e) {
    const g = this.g; const k = e.key;
    // Pause / cancel.
    if (k === 'Escape') {
      if (g.pendingBuild) { g.pendingBuild = null; return; }
      if (this.commandMode) { this.commandMode = null; return; }
      this._togglePause(); return;
    }
    if (k === 'p') { this._togglePause(); return; }
    if (g.paused) return;

    // Control groups.
    if (/^[1-9]$/.test(k)) {
      if (e.ctrl) g.assignControlGroup(k);
      else g.recallControlGroup(k);
      ui && ui.markCardDirty();
      return;
    }
    if (k === ' ') { g._centerOnSelection(); return; }

    const sel = g.selection.filter(x => !x.dead);
    const units = this._selUnits();
    const singleBuilding = sel.length === 1 && sel[0].kind === 'building' && sel[0].team === TEAM.PLAYER && !sel[0].constructing ? sel[0] : null;

    // Production hotkeys when a producing building is selected.
    if (singleBuilding && singleBuilding.def.produces) {
      for (const key of singleBuilding.def.produces) {
        if (PRODUCE_HOTKEYS[key] === k) { g.queueUnit(singleBuilding, key); ui && ui.markCardDirty(); return; }
      }
    }

    if (units.length) {
      if (k === 'a') { this.commandMode = 'attack'; return; }
      if (k === 'm') { this.commandMode = 'move'; return; }
      if (k === 's') { this._command('stop'); return; }
      if (k === 'h') { this._command('hold'); return; }
      // Build hotkeys (worker selected).
      if (units.some(u => u.isWorker)) {
        for (const bkey of BUILDABLE) {
          if (BUILD_HOTKEYS[bkey] === k) { g.beginPlacement(bkey); return; }
        }
      }
    }
  }

  _command(name) {
    const units = this._selUnits();
    for (const u of units) {
      if (name === 'stop') this.g.stop(u);
      else if (name === 'hold') this.g.hold(u);
    }
    if (units.length) Sfx.command();
  }

  _togglePause() {
    this.g.paused = !this.g.paused;
    this.g.toast(this.g.paused ? 'Paused' : 'Resumed');
  }

  drawCursorHint() {
    if (!this.commandMode && !this.g.pendingBuild) return;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.strokeStyle = this.commandMode === 'attack' ? '#ef5366' : '#3ddc84';
    ctx.lineWidth = 2;
    if (this.commandMode) {
      ctx.beginPath(); ctx.arc(input.mx, input.my, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(input.mx - 16, input.my); ctx.lineTo(input.mx + 16, input.my);
      ctx.moveTo(input.mx, input.my - 16); ctx.lineTo(input.mx, input.my + 16); ctx.stroke();
    }
    ctx.restore();
  }
}

// Show menu initially.
resize();
