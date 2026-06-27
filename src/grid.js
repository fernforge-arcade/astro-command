// Tile map: terrain, static occupancy (rocks, buildings, resources), buildability.
import { TILE } from './config.js';

export const TERRAIN = { GRASS: 0, ROCK: 1, DIRT: 2 };

export class Grid {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.terrain = new Uint8Array(w * h);   // visual + walkability source
    this.solid = new Uint8Array(w * h);     // 1 = blocked for pathing/building
    this.occupant = new Array(w * h).fill(null); // id of building/resource on tile
  }
  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  isSolid(tx, ty) { return !this.inBounds(tx, ty) || this.solid[this.idx(tx, ty)] === 1; }

  setTerrain(tx, ty, t) {
    if (!this.inBounds(tx, ty)) return;
    this.terrain[this.idx(tx, ty)] = t;
    if (t === TERRAIN.ROCK) this.solid[this.idx(tx, ty)] = 1;
  }

  // Mark/unmark a building or resource footprint.
  occupy(tx, ty, tw, th, id) {
    for (let y = ty; y < ty + th; y++)
      for (let x = tx; x < tx + tw; x++)
        if (this.inBounds(x, y)) { this.solid[this.idx(x, y)] = 1; this.occupant[this.idx(x, y)] = id; }
  }
  vacate(tx, ty, tw, th) {
    for (let y = ty; y < ty + th; y++)
      for (let x = tx; x < tx + tw; x++)
        if (this.inBounds(x, y) && this.terrain[this.idx(x, y)] !== TERRAIN.ROCK) {
          this.solid[this.idx(x, y)] = 0; this.occupant[this.idx(x, y)] = null;
        }
  }

  // Can a tw x th footprint be placed at top-left tile (tx,ty)?
  canBuild(tx, ty, tw, th) {
    for (let y = ty; y < ty + th; y++)
      for (let x = tx; x < tx + tw; x++) {
        if (!this.inBounds(x, y)) return false;
        if (this.solid[this.idx(x, y)] === 1) return false;
      }
    return true;
  }

  worldToTileX(wx) { return Math.floor(wx / TILE); }
  worldToTileY(wy) { return Math.floor(wy / TILE); }
  tileCenterX(tx) { return tx * TILE + TILE / 2; }
  tileCenterY(ty) { return ty * TILE + TILE / 2; }

  // Nearest walkable tile center to a world point (BFS outward).
  nearestFree(wx, wy, maxR = 12) {
    let tx = this.worldToTileX(wx), ty = this.worldToTileY(wy);
    if (!this.isSolid(tx, ty)) return { x: this.tileCenterX(tx), y: this.tileCenterY(ty) };
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = tx + dx, y = ty + dy;
        if (!this.isSolid(x, y)) return { x: this.tileCenterX(x), y: this.tileCenterY(y) };
      }
    }
    return { x: wx, y: wy };
  }
}
