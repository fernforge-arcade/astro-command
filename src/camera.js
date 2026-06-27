// Viewport: world<->screen transform, panning and zoom.
import { clamp } from './util.js';
import { TILE } from './config.js';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0;       // world coords at top-left of view
    this.zoom = 1;
    this.vw = 0; this.vh = 0;     // viewport size (px)
    this.worldW = 0; this.worldH = 0;
    this.minZoom = 0.45; this.maxZoom = 1.8;
  }
  setViewport(w, h) { this.vw = w; this.vh = h; this.clampPos(); }
  setWorld(tw, th) { this.worldW = tw * TILE; this.worldH = th * TILE; }

  centerOn(wx, wy) {
    this.x = wx - (this.vw / this.zoom) / 2;
    this.y = wy - (this.vh / this.zoom) / 2;
    this.clampPos();
  }
  pan(dx, dy) { this.x += dx / this.zoom; this.y += dy / this.zoom; this.clampPos(); }

  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampPos();
  }

  clampPos() {
    const viewW = this.vw / this.zoom, viewH = this.vh / this.zoom;
    if (this.worldW <= viewW) this.x = (this.worldW - viewW) / 2;
    else this.x = clamp(this.x, 0, this.worldW - viewW);
    if (this.worldH <= viewH) this.y = (this.worldH - viewH) / 2;
    else this.y = clamp(this.y, 0, this.worldH - viewH);
  }

  worldToScreenX(wx) { return (wx - this.x) * this.zoom; }
  worldToScreenY(wy) { return (wy - this.y) * this.zoom; }
  screenToWorld(sx, sy) { return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom }; }
  visibleBounds() {
    return { x0: this.x, y0: this.y, x1: this.x + this.vw / this.zoom, y1: this.y + this.vh / this.zoom };
  }
}
