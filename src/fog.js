// Fog of war for the player team: unexplored -> explored (dim) -> visible.
import { TILE } from './config.js';

export class Fog {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.vis = new Uint8Array(w * h);       // 1 = currently visible this frame
    this.explored = new Uint8Array(w * h);  // 1 = seen at least once
    this.enabled = true;
  }
  idx(tx, ty) { return ty * this.w + tx; }

  clear() { this.vis.fill(0); }

  // Reveal a circle of tile-radius `r` around world point.
  reveal(wx, wy, r) {
    const cx = Math.floor(wx / TILE), cy = Math.floor(wy / TILE);
    const ri = Math.ceil(r), r2 = r * r;
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const i = this.idx(x, y);
      this.vis[i] = 1; this.explored[i] = 1;
    }
  }
  isVisibleTile(tx, ty) {
    if (!this.enabled) return true;
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.vis[this.idx(tx, ty)] === 1;
  }
  isExploredTile(tx, ty) {
    if (!this.enabled) return true;
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return this.explored[this.idx(tx, ty)] === 1;
  }
  isVisibleWorld(wx, wy) { return this.isVisibleTile(Math.floor(wx / TILE), Math.floor(wy / TILE)); }
}
