// Centralized mouse + keyboard state. Game logic polls/consumes these.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mx = 0; this.my = 0;         // mouse in canvas px
    this.keys = new Set();
    this.mouseDown = [false, false, false];
    this.wheel = 0;
    // event queues consumed each frame
    this.events = [];
    this._bind();
  }
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mx = e.clientX - r.left;
    this.my = e.clientY - r.top;
  }
  _bind() {
    const c = this.canvas;
    c.addEventListener('mousemove', (e) => { this._pos(e); });
    c.addEventListener('mousedown', (e) => {
      this._pos(e); this.mouseDown[e.button] = true;
      this.events.push({ type: 'down', button: e.button, x: this.mx, y: this.my, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
      this.events.push({ type: 'up', button: e.button, x: this.mx, y: this.my, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => { this.wheel += e.deltaY; this.events.push({ type: 'wheel', delta: e.deltaY, x: this.mx, y: this.my }); e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.add(k);
      this.events.push({ type: 'key', key: k, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, code: e.code });
      // Prevent page scroll for game keys.
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      this.keys.delete(k);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = [false, false, false]; });
  }
  isKey(k) { return this.keys.has(k); }
  drain() { const ev = this.events; this.events = []; this.wheel = 0; return ev; }
}
