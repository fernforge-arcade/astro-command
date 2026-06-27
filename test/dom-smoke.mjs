// Headless DOM harness: stubs just enough of the browser to load main.js,
// start a game, pump animation frames, and fire synthetic input — catching
// integration bugs in Renderer/UI/Input/Controller without a real browser.

function makeCtx() {
  const data = {};
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p in data) return data[p];
      if (p === 'measureText') return () => ({ width: 0 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern') return () => grad;
      if (p === 'getImageData') return () => ({ data: [] });
      if (p === 'createBuffer') return () => ({ getChannelData: () => new Float32Array(8) });
      return () => {};
    },
    set(t, p, v) { data[p] = v; return true; },
  });
}

class El {
  constructor(tag = 'div', id = '') {
    this.tag = tag; this.id = id; this.children = [];
    this._classes = new Set(); this.style = {}; this.dataset = {};
    this._listeners = []; this._html = ''; this.textContent = ''; this.title = ''; this.className = '';
    this.width = 1280; this.height = 720; this._ctx = null;
    this.classList = {
      add: (c) => this._classes.add(c), remove: (c) => this._classes.delete(c),
      contains: (c) => this._classes.has(c), toggle: () => {},
    };
  }
  addEventListener(t, fn) { this._listeners.push([t, fn]); }
  removeEventListener() {}
  getContext() { return this._ctx || (this._ctx = makeCtx()); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  querySelectorAll() { return []; }
  querySelector(sel) { if (!this._qs) this._qs = new Map(); if (!this._qs.has(sel)) this._qs.set(sel, new El('div')); return this._qs.get(sel); }
  appendChild(c) { this.children.push(c); return c; }
  set innerHTML(v) { this._html = v; this.children = []; }
  get innerHTML() { return this._html; }
  remove() {}
  dispatch(type, ev) { for (const [t, fn] of this._listeners) if (t === type) fn(ev || { preventDefault() {} }); }
  click() { this.dispatch('click', { preventDefault() {} }); }
}

const els = new Map();
function el(id) { if (!els.has(id)) els.set(id, new El('div', id)); return els.get(id); }

global.window = new El('window');
global.window.innerWidth = 1280; global.window.innerHeight = 720;
global.document = {
  getElementById: (id) => el(id),
  createElement: (tag) => new El(tag),
};

let rafQ = [];
global.requestAnimationFrame = (cb) => { rafQ.push(cb); return rafQ.length; };

// ---- load the game (runs top-level bootstrap) ----
await import('../src/main.js');

// Start a skirmish.
el('btn-start').click();

let ts = 0;
let frames = 0, errors = 0;
const canvas = el('game');
const win = global.window;

function pump(n) {
  for (let f = 0; f < n; f++) {
    const cbs = rafQ; rafQ = [];
    for (const cb of cbs) {
      try { cb(ts); } catch (e) { errors++; console.error('FRAME ERROR:', e.message, '\n', e.stack.split('\n').slice(1, 3).join('\n')); }
    }
    ts += 16; frames++;
  }
}

pump(30); // warm up + spawn workers

// Synthetic input: select-all box drag across the map, then issue a move.
canvas.dispatch('mousedown', { button: 0, clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, preventDefault() {} });
pump(2);
win.dispatch('mousemove', { clientX: 1200, clientY: 680 });
win.dispatch('mouseup', { button: 0, clientX: 1200, clientY: 680, shiftKey: false, ctrlKey: false });
pump(3);

// Right-click move order.
canvas.dispatch('mousedown', { button: 2, clientX: 640, clientY: 360, shiftKey: false, ctrlKey: false, preventDefault() {} });
canvas.dispatch('mouseup', { button: 2, clientX: 640, clientY: 360, shiftKey: false, ctrlKey: false });
pump(5);

// Keyboard: attack-move mode then click, stop, hold, control group assign/recall, pause toggle.
for (const k of ['a', 's', 'h']) win.dispatch('keydown', { key: k, shiftKey: false, ctrlKey: false, code: 'Key' + k.toUpperCase() });
win.dispatch('keydown', { key: '1', ctrlKey: true, shiftKey: false, code: 'Digit1' });
win.dispatch('keydown', { key: '1', ctrlKey: false, shiftKey: false, code: 'Digit1' });
pump(3);

// Select the command center (click near player base) and queue a worker via hotkey.
canvas.dispatch('mousedown', { button: 0, clientX: 50, clientY: 670, shiftKey: false, ctrlKey: false, preventDefault() {} });
canvas.dispatch('mouseup', { button: 0, clientX: 50, clientY: 670, shiftKey: false, ctrlKey: false });
pump(2);
win.dispatch('keydown', { key: 'w', shiftKey: false, ctrlKey: false, code: 'KeyW' });
pump(2);

// Wheel zoom.
canvas.dispatch('wheel', { deltaY: -100, clientX: 640, clientY: 360, preventDefault() {} });
canvas.dispatch('wheel', { deltaY: 100, clientX: 640, clientY: 360, preventDefault() {} });
pump(2);

// Minimap interactions.
const mm = el('minimap');
mm.dispatch('mousedown', { button: 0, clientX: 5, clientY: 5, shiftKey: false, preventDefault() {} });
mm.dispatch('mousedown', { button: 2, clientX: 100, clientY: 100, shiftKey: false, preventDefault() {} });
pump(2);

// Long run to exercise combat/AI/particles/fog through many frames.
pump(1200);

// ---- Tutorial integration: start it via the menu and pump real frames so
// Tutorial.constructor/update/draw all run through main.js's loop. ----
el('btn-tutorial').click();
pump(10);
// Advance off the intro step (its Next button) so a highlight gets drawn.
const tutCard = el('game-root').children.find(c => c.id === 'tutorial');
if (tutCard) tutCard.querySelector('.tut-next').dispatch('click');
pump(10);
// Drag-select everything, then right-click toward the base minerals to gather.
canvas.dispatch('mousedown', { button: 0, clientX: 0, clientY: 0, shiftKey: false, ctrlKey: false, preventDefault() {} });
pump(2);
win.dispatch('mousemove', { clientX: 1200, clientY: 700 });
win.dispatch('mouseup', { button: 0, clientX: 1200, clientY: 700, shiftKey: false, ctrlKey: false });
pump(2);
canvas.dispatch('mousedown', { button: 2, clientX: 90, clientY: 640, shiftKey: false, ctrlKey: false, preventDefault() {} });
canvas.dispatch('mouseup', { button: 2, clientX: 90, clientY: 640, shiftKey: false, ctrlKey: false });
pump(400);

console.log(`frames=${frames} errors=${errors}`);
console.log(errors === 0 ? 'DOM SMOKE PASSED' : 'DOM SMOKE FAILED');
process.exit(errors === 0 ? 0 : 1);
