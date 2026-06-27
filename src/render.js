// World renderer: terrain, fog, entities, effects, selection, placement preview.
import { TILE, TEAM, TEAM_COLOR, TEAM_COLOR_DARK, BUILDINGS } from './config.js';
import { TERRAIN } from './grid.js';
import { clamp, TAU } from './util.js';

const TERRAIN_COLORS = {
  [TERRAIN.GRASS]: '#16241a',
  [TERRAIN.DIRT]: '#23211a',
  [TERRAIN.ROCK]: '#2c3036',
};
const TERRAIN_COLORS2 = {
  [TERRAIN.GRASS]: '#1b2c1f',
  [TERRAIN.DIRT]: '#2a2720',
  [TERRAIN.ROCK]: '#383d45',
};

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.g = game;
  }

  render(input, dragBox) {
    const ctx = this.ctx, g = this.g, cam = g.camera;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0f16'; ctx.fillRect(0, 0, W, H);

    const b = cam.visibleBounds();
    const t0x = Math.max(0, Math.floor(b.x0 / TILE)), t1x = Math.min(g.W - 1, Math.ceil(b.x1 / TILE));
    const t0y = Math.max(0, Math.floor(b.y0 / TILE)), t1y = Math.min(g.H - 1, Math.ceil(b.y1 / TILE));
    const z = cam.zoom;

    // ---- Terrain ----
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        if (!g.fog.isExploredTile(tx, ty)) continue;
        const terr = g.grid.terrain[g.grid.idx(tx, ty)];
        const sx = (tx * TILE - cam.x) * z, sy = (ty * TILE - cam.y) * z;
        const size = TILE * z + 1;
        ctx.fillStyle = ((tx + ty) & 1) ? TERRAIN_COLORS[terr] : TERRAIN_COLORS2[terr];
        ctx.fillRect(sx, sy, size, size);
        if (terr === TERRAIN.ROCK) {
          ctx.fillStyle = '#454c55';
          ctx.beginPath();
          ctx.arc(sx + size / 2, sy + size / 2, size * 0.32, 0, TAU); ctx.fill();
        }
      }
    }

    // ---- Resources ----
    for (const r of g.resources) {
      if (!g.fog.isExploredTile(r.tx, r.ty)) continue;
      const sx = cam.worldToScreenX(r.x), sy = cam.worldToScreenY(r.y);
      const s = r.radius * z * (0.55 + 0.45 * (r.amount / r.maxAmount));
      ctx.fillStyle = '#1b6f63';
      this._crystal(ctx, sx, sy, s * 1.1, '#1b6f63');
      this._crystal(ctx, sx, sy, s, g.fog.isVisibleTile(r.tx, r.ty) ? '#5fe3c9' : '#3a8a7d');
    }

    // ---- Rally lines for selected producing buildings ----
    for (const bld of g.buildings) {
      if (bld.selected && bld.rally && bld.team === TEAM.PLAYER) {
        this._dashLine(ctx, cam.worldToScreenX(bld.x), cam.worldToScreenY(bld.y),
          cam.worldToScreenX(bld.rally.x), cam.worldToScreenY(bld.rally.y), '#3ddc84');
        this._ring(ctx, cam.worldToScreenX(bld.rally.x), cam.worldToScreenY(bld.rally.y), 6 * z, '#3ddc84');
      }
    }

    // ---- Buildings ----
    for (const bld of g.buildings) {
      const vis = bld.team === TEAM.PLAYER || g.fog.isVisibleTile(bld.tx, bld.ty) || g.fog.isVisibleWorld(bld.x, bld.y);
      if (bld.team !== TEAM.PLAYER && !vis && !g.fog.isExploredTile(bld.tx, bld.ty)) continue;
      if (bld.team !== TEAM.PLAYER && !vis) {
        // explored ghost
        this._building(ctx, cam, bld, z, true);
      } else {
        this._building(ctx, cam, bld, z, false);
      }
    }

    // ---- Move-order destination markers (selected units) ----
    for (const u of g.selection) {
      if (u.kind === 'unit' && u.moveGoal && (u.state === 'move' || u.state === 'attackMove')) {
        const mx = cam.worldToScreenX(u.moveGoal.x), my = cam.worldToScreenY(u.moveGoal.y);
        this._ring(ctx, mx, my, 7 * z, u.state === 'attackMove' ? '#ef5366' : '#3ddc84');
      }
    }

    // ---- Units ----
    for (const u of g.units) {
      const vis = u.team === TEAM.PLAYER || g.fog.isVisibleWorld(u.x, u.y);
      if (!vis) continue;
      this._unit(ctx, cam, u, z);
    }

    // ---- Projectiles ----
    for (const p of g.projectiles) {
      if (!g.fog.isVisibleWorld(p.x, p.y) && g.fog.enabled) continue;
      const sx = cam.worldToScreenX(p.x), sy = cam.worldToScreenY(p.y);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.5, 2.4 * z), 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(2.5, 4 * z), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ---- Particles ----
    for (const p of g.particles) {
      const sx = cam.worldToScreenX(p.x), sy = cam.worldToScreenY(p.y);
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      if (p.ptype === 'shock') {
        ctx.strokeStyle = p.color; ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.arc(sx, sy, p.size * z * (1.4 - a), 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(sx, sy, p.size * z, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ---- Pings ----
    for (const p of g.pings) {
      const sx = cam.worldToScreenX(p.x), sy = cam.worldToScreenY(p.y);
      const a = 1 - p.t / p.max;
      ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, (1 - a) * 26 * z + 4, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- Fog overlay ----
    if (g.fog.enabled) {
      for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
        const sx = (tx * TILE - cam.x) * z, sy = (ty * TILE - cam.y) * z;
        const size = TILE * z + 1;
        if (!g.fog.isExploredTile(tx, ty)) { ctx.fillStyle = '#05070b'; ctx.fillRect(sx, sy, size, size); }
        else if (!g.fog.isVisibleTile(tx, ty)) { ctx.fillStyle = 'rgba(5,8,14,0.55)'; ctx.fillRect(sx, sy, size, size); }
      }
    }

    // ---- Placement preview ----
    if (g.pendingBuild) this._placementPreview(ctx, cam, input, z);

    // ---- Selection drag box ----
    if (dragBox) {
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(61,220,132,0.10)';
      const x = Math.min(dragBox.x0, dragBox.x1), y = Math.min(dragBox.y0, dragBox.y1);
      const w = Math.abs(dragBox.x1 - dragBox.x0), h = Math.abs(dragBox.y1 - dragBox.y0);
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    }
  }

  // ---- entity drawing helpers ----
  _building(ctx, cam, bld, z, ghost) {
    const r = bld.footprintRect();
    const sx = cam.worldToScreenX(r.x), sy = cam.worldToScreenY(r.y);
    const w = r.w * z, h = r.h * z;
    const col = TEAM_COLOR[bld.team], dark = TEAM_COLOR_DARK[bld.team];
    ctx.globalAlpha = ghost ? 0.4 : 1;

    if (bld.selected) { ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2; ctx.strokeRect(sx - 2, sy - 2, w + 4, h + 4); }

    // body
    ctx.fillStyle = dark; ctx.fillRect(sx, sy, w, h);
    ctx.fillStyle = bld.hitFlash > 0 ? '#ffffff' : '#13202f';
    ctx.fillRect(sx + 3, sy + 3, w - 6, h - 6);
    // team stripe
    ctx.fillStyle = col; ctx.fillRect(sx, sy, w, 4 * z + 1);
    // icon
    if (z > 0.5) {
      ctx.fillStyle = '#dbe7f5'; ctx.font = `${Math.round(Math.min(w, h) * 0.42)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(bld.def.icon, sx + w / 2, sy + h / 2 + 2);
    }

    if (bld.constructing) {
      // construction overlay + progress.
      ctx.fillStyle = 'rgba(8,14,22,0.55)'; ctx.fillRect(sx, sy, w, h * (1 - bld.buildProgress));
      ctx.fillStyle = '#3da9fc'; ctx.fillRect(sx, sy + h + 2 * z, w * bld.buildProgress, 3 * z + 1);
    } else {
      // production progress (top item).
      if (bld.queue.length) {
        const it = bld.queue[0]; const pr = 1 - it.timeLeft / it.totalTime;
        ctx.fillStyle = 'rgba(20,30,46,0.9)'; ctx.fillRect(sx, sy + h + 2 * z, w, 3 * z + 1);
        ctx.fillStyle = '#5fe3c9'; ctx.fillRect(sx, sy + h + 2 * z, w * pr, 3 * z + 1);
      }
    }
    ctx.globalAlpha = 1;

    // health bar when damaged or selected.
    if (!ghost && (bld.selected || bld.hp < bld.maxHp)) this._hpbar(ctx, sx, sy - 6 * z, w, bld.hp / bld.maxHp);
  }

  _unit(ctx, cam, u, z) {
    const sx = cam.worldToScreenX(u.x), sy = cam.worldToScreenY(u.y);
    const rad = u.radius * z;
    const col = TEAM_COLOR[u.team], dark = TEAM_COLOR_DARK[u.team];

    // selection ring
    if (u.selected) {
      ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(sx, sy + rad * 0.5, rad + 4, (rad + 4) * 0.5, 0, 0, TAU); ctx.stroke();
    }
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy + rad * 0.55, rad * 0.95, rad * 0.45, 0, 0, TAU); ctx.fill();

    // body
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(u.angle);
    const flash = u.hitFlash > 0;
    if (u.key === 'tank') {
      // chassis
      ctx.fillStyle = flash ? '#fff' : dark; ctx.fillRect(-rad, -rad * 0.8, rad * 2, rad * 1.6);
      ctx.fillStyle = flash ? '#fff' : col; ctx.fillRect(-rad * 0.6, -rad * 0.55, rad * 1.2, rad * 1.1);
      // barrel
      ctx.fillStyle = '#cdd9e6'; ctx.fillRect(0, -2 * z, rad * 1.6, 4 * z);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU);
      ctx.fillStyle = flash ? '#fff' : dark; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, rad * 0.66, 0, TAU);
      ctx.fillStyle = flash ? '#fff' : col; ctx.fill();
      // facing nub
      ctx.fillStyle = '#e7eef7'; ctx.fillRect(rad * 0.4, -1.5 * z, rad * 0.8, 3 * z);
    }
    // muzzle flash
    if (u.muzzle > 0) {
      ctx.fillStyle = '#fff2b0';
      ctx.beginPath(); ctx.arc(rad * 1.2, 0, rad * 0.5, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // glyph for clarity at higher zoom
    if (z > 0.85 && u.key !== 'tank') {
      ctx.fillStyle = '#04101e'; ctx.font = `bold ${Math.round(rad)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(u.def.glyph, sx, sy + 0.5);
    }
    // worker cargo indicator
    if (u.isWorker && u.cargo > 0) {
      ctx.fillStyle = '#5fe3c9';
      ctx.beginPath(); ctx.arc(sx + rad * 0.7, sy - rad * 0.7, 2.5 * z + 1, 0, TAU); ctx.fill();
    }

    // health bar
    if (u.selected || u.hp < u.maxHp) this._hpbar(ctx, sx - rad - 2, sy - rad - 7 * z, (rad + 2) * 2, u.hp / u.maxHp);
  }

  _hpbar(ctx, x, y, w, frac) {
    frac = clamp(frac, 0, 1);
    const h = Math.max(3, 4);
    ctx.fillStyle = '#0a1420'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frac > 0.5 ? '#3ddc84' : frac > 0.25 ? '#ffd166' : '#ef5366';
    ctx.fillRect(x, y, w * frac, h);
    ctx.strokeStyle = '#0009'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  _crystal(ctx, x, y, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.7, y); ctx.lineTo(x, y + s * 0.8); ctx.lineTo(x - s * 0.7, y);
    ctx.closePath(); ctx.fill();
  }
  _ring(ctx, x, y, r, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }
  _dashLine(ctx, x0, y0, x1, y1, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);
  }

  _placementPreview(ctx, cam, input, z) {
    const g = this.g;
    const wpt = cam.screenToWorld(input.mx, input.my);
    const def = BUILDINGS[g.pendingBuild.key];
    const tx = Math.floor(wpt.x / TILE) - Math.floor(def.tw / 2);
    const ty = Math.floor(wpt.y / TILE) - Math.floor(def.th / 2);
    const ok = g.grid.canBuild(tx, ty, def.tw, def.th);
    const sx = (tx * TILE - cam.x) * z, sy = (ty * TILE - cam.y) * z;
    const w = def.tw * TILE * z, h = def.th * TILE * z;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ok ? '#3ddc84' : '#ef5366';
    ctx.fillRect(sx, sy, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? '#3ddc84' : '#ef5366'; ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, w, h);
    // grid cells
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    for (let yy = 0; yy < def.th; yy++) for (let xx = 0; xx < def.tw; xx++) {
      ctx.strokeRect(sx + xx * TILE * z, sy + yy * TILE * z, TILE * z, TILE * z);
    }
    ctx.fillStyle = '#fff'; ctx.font = `${Math.round(Math.min(w, h) * 0.4)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, sx + w / 2, sy + h / 2);
    this._placeTile = { tx, ty, ok };
  }
}
