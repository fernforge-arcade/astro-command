// A* pathfinding on the tile grid with a binary-heap open set.
// Returns an array of world-space waypoints (tile centers), or null.
import { TILE } from './config.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; const n = a.length;
      for (;;) { let l = 2 * i + 1, r = l + 1, s = i;
        if (l < n && a[l].f < a[s].f) s = l;
        if (r < n && a[r].f < a[s].f) s = r;
        if (s === i) break; [a[s], a[i]] = [a[i], a[s]]; i = s; } }
    return top;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

// Find a path from world (sx,sy) to world (tx,ty). `isSolid(x,y)` is a tile predicate.
export function findPath(grid, sx, sy, tx, ty, maxNodes = 9000) {
  const w = grid.w, h = grid.h;
  let scx = clampT(Math.floor(sx / TILE), 0, w - 1);
  let scy = clampT(Math.floor(sy / TILE), 0, h - 1);
  let tcx = clampT(Math.floor(tx / TILE), 0, w - 1);
  let tcy = clampT(Math.floor(ty / TILE), 0, h - 1);

  // If target tile is solid, snap to nearest free tile.
  if (grid.isSolid(tcx, tcy)) {
    const f = grid.nearestFree(tx, ty, 14);
    tcx = clampT(Math.floor(f.x / TILE), 0, w - 1);
    tcy = clampT(Math.floor(f.y / TILE), 0, h - 1);
  }
  if (scx === tcx && scy === tcy) return [{ x: tx, y: ty }];

  const open = new MinHeap();
  const came = new Int32Array(w * h).fill(-1);
  const gScore = new Float32Array(w * h).fill(Infinity);
  const closed = new Uint8Array(w * h);

  const startI = scy * w + scx;
  gScore[startI] = 0;
  open.push({ i: startI, x: scx, y: scy, f: heur(scx, scy, tcx, tcy) });
  let nodes = 0;
  let best = startI, bestH = heur(scx, scy, tcx, tcy);

  while (open.size && nodes < maxNodes) {
    const cur = open.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1; nodes++;
    if (cur.x === tcx && cur.y === tcy) return reconstruct(came, cur.i, w);

    const ch = heur(cur.x, cur.y, tcx, tcy);
    if (ch < bestH) { bestH = ch; best = cur.i; }

    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (grid.isSolid(nx, ny)) continue;
      // Prevent cutting diagonal corners through solids.
      if (dx !== 0 && dy !== 0) {
        if (grid.isSolid(cur.x + dx, cur.y) || grid.isSolid(cur.x, cur.y + dy)) continue;
      }
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const tentative = gScore[cur.i] + cost;
      if (tentative < gScore[ni]) {
        gScore[ni] = tentative; came[ni] = cur.i;
        open.push({ i: ni, x: nx, y: ny, f: tentative + heur(nx, ny, tcx, tcy) });
      }
    }
  }
  // No full path: return best-effort partial toward target.
  if (best !== startI) return reconstruct(came, best, w);
  return null;
}

function heur(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); // octile
}
function reconstruct(came, i, w) {
  const path = [];
  while (i !== -1) {
    const x = i % w, y = (i / w) | 0;
    path.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
    i = came[i];
  }
  path.reverse();
  if (path.length > 1) path.shift(); // drop the start tile
  return path;
}
function clampT(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
