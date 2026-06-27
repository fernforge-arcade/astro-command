// HUD: top resource bar, selection panel, command card, minimap, toasts.
import { TILE, TEAM, TEAM_COLOR, UNITS, BUILDINGS, BUILDABLE } from './config.js';
import { formatTime, clamp } from './util.js';
import { TERRAIN } from './grid.js';

export const BUILD_HOTKEYS = { depot: 'e', barracks: 'b', factory: 'c', turret: 't' };
export const PRODUCE_HOTKEYS = { worker: 'w', marine: 'e', ranger: 'r', tank: 't' };

export class UI {
  constructor(game, handlers) {
    this.g = game; this.h = handlers;
    this.topbar = document.getElementById('topbar');
    this.hud = document.getElementById('hud');
    this.mineralEl = document.getElementById('mineral-count');
    this.supplyEl = document.getElementById('supply-count');
    this.clockEl = document.getElementById('game-clock');
    this.selPanel = document.getElementById('selection-panel');
    this.cmdCard = document.getElementById('command-card');
    this.toastsEl = document.getElementById('toasts');
    this.minimap = document.getElementById('minimap');
    this.mmCtx = this.minimap.getContext('2d');
    this._lastSig = '';
    this._toastSeen = 0;
    this._bindMinimap();
    this._bindPause();
  }
  show() { this.topbar.classList.remove('hidden'); this.hud.classList.remove('hidden'); }

  _bindPause() {
    document.getElementById('btn-pause').addEventListener('click', () => this.h.onTogglePause());
  }

  _bindMinimap() {
    const mm = this.minimap;
    const toWorld = (e) => {
      const r = mm.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width;
      const my = (e.clientY - r.top) / r.height;
      return { x: clamp(mx, 0, 1) * this.g.W * TILE, y: clamp(my, 0, 1) * this.g.H * TILE };
    };
    let dragging = false;
    mm.addEventListener('mousedown', (e) => {
      const w = toWorld(e);
      if (e.button === 2) this.h.onMinimapCommand(w.x, w.y, e.shiftKey);
      else { dragging = true; this.g.camera.centerOn(w.x, w.y); }
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => { if (dragging) { const w = toWorld(e); this.g.camera.centerOn(w.x, w.y); } });
    window.addEventListener('mouseup', () => { dragging = false; });
    mm.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- update
  update() {
    const g = this.g, p = g.players[TEAM.PLAYER];
    this.mineralEl.textContent = Math.floor(p.minerals);
    const sup = `${p.supplyUsed}/${p.supplyCap}`;
    this.supplyEl.textContent = sup;
    this.supplyEl.style.color = (p.supplyUsed >= p.supplyCap && p.supplyCap < 200) ? '#ef5366' : '';
    this.clockEl.textContent = formatTime(g.time);

    this._renderSelection();
    this._renderCommandCard();
    this._renderToasts();
    this._renderMinimap();
  }

  _renderToasts() {
    // Render any toasts not yet shown.
    while (this._toastSeen < this.g.toasts.length) {
      const t = this.g.toasts[this._toastSeen++];
      const el = document.createElement('div');
      el.className = 'toast' + (t.kind ? ' ' + t.kind : '');
      el.textContent = t.text;
      this.toastsEl.appendChild(el);
      setTimeout(() => el.remove(), 2700);
    }
    if (this.g.toasts.length === 0) this._toastSeen = 0;
  }

  _renderSelection() {
    const sel = this.g.selection.filter(e => !e.dead);
    const panel = this.selPanel;
    if (!sel.length) { panel.innerHTML = '<div class="sel-title"><small>Nothing selected</small></div>'; return; }

    if (sel.length === 1) {
      const e = sel[0];
      panel.innerHTML = this._singlePanel(e);
      this._wireQueueCancel(e);
      return;
    }
    // Multiple: group by key.
    const groups = {};
    for (const e of sel) { const k = e.key; (groups[k] = groups[k] || []).push(e); }
    let html = `<div class="sel-title">${sel.length} units selected</div><div class="sel-grid">`;
    for (const e of sel.slice(0, 36)) {
      const def = e.def;
      html += `<div class="sel-chip sel" title="${def.name}">${def.icon}<div class="mini-hp" style="width:${Math.max(0, (e.hp / e.maxHp) * 30)}px"></div></div>`;
    }
    html += '</div>';
    panel.innerHTML = html;
  }

  _singlePanel(e) {
    const d = e.def;
    let stats = '';
    if (e.kind === 'unit') {
      stats += `<span><b>${Math.ceil(e.hp)}</b>/${e.maxHp} HP</span>`;
      if (d.damage > 0) stats += `<span>DMG <b>${d.damage}</b></span>`;
      if (d.range > 20) stats += `<span>RNG <b>${Math.round(d.range / TILE)}</b></span>`;
      stats += `<span>ARM <b>${d.armor}</b></span>`;
      if (e.isWorker) {
        stats += `<span>Carrying <b class="mineral">◆ ${e.cargo}</b></span>`;
        let act = '';
        if (e.state === 'gather' && e.cargo === 0 && e.gatherPatch && !e.path) act = 'Mining…';
        else if (e.state === 'gather') act = 'Heading to minerals';
        else if (e.state === 'returnCargo') act = 'Returning to drop off ◆';
        else if (e.state === 'build') act = 'Building';
        if (act) stats += `<span style="color:var(--gold)">${act}</span>`;
      }
    } else {
      stats += `<span><b>${Math.ceil(e.hp)}</b>/${e.maxHp} HP</span>`;
      if (d.supplyProvided) stats += `<span>Supply <b>+${d.supplyProvided}</b></span>`;
      if (d.damage) stats += `<span>DMG <b>${d.damage}</b></span>`;
    }
    let html = `<div class="sel-title">${d.icon} ${d.name} <small>${e.team === TEAM.PLAYER ? '' : '(enemy)'}</small></div>`;
    html += `<div class="hpbar"><i style="width:${(e.hp / e.maxHp) * 100}%"></i></div>`;
    html += `<div class="sel-stats">${stats}</div>`;
    html += `<div class="sel-stats" style="margin-top:6px;font-style:italic">${d.desc || ''}</div>`;

    if (e.kind === 'building' && e.constructing) {
      html += `<div class="build-progress"><i style="width:${e.buildProgress * 100}%"></i></div>`;
      html += `<div class="sel-stats" style="margin-top:4px">Constructing… ${Math.round(e.buildProgress * 100)}%</div>`;
    }
    if (e.kind === 'building' && e.queue && e.queue.length) {
      html += '<div class="queue">';
      e.queue.forEach((q, i) => {
        const pr = (1 - q.timeLeft / q.totalTime) * 100;
        html += `<div class="q" data-qi="${i}" title="Click to cancel">${UNITS[q.key].icon}<div class="pf" style="height:${pr}%"></div></div>`;
      });
      html += '</div>';
    }
    return html;
  }

  _wireQueueCancel(e) {
    if (e.kind !== 'building' || !e.queue) return;
    this.selPanel.querySelectorAll('.q').forEach(el => {
      el.addEventListener('click', () => this.h.onQueueCancel(e, parseInt(el.dataset.qi, 10)));
    });
  }

  // ---- Command card ----
  _renderCommandCard() {
    const sel = this.g.selection.filter(e => !e.dead);
    const sig = this._cardSignature(sel);
    if (sig === this._lastSig && !this._cardDirty) return;
    this._lastSig = sig; this._cardDirty = false;
    this.cmdCard.innerHTML = '';

    if (!sel.length) return;
    const buttons = this._cardButtons(sel);
    for (const b of buttons) {
      const el = document.createElement('div');
      el.className = 'cmd-btn' + (b.disabled ? ' disabled' : '');
      el.innerHTML = `<span class="ico">${b.icon}</span><span>${b.label}</span>` +
        (b.hot ? `<span class="hot">${b.hot.toUpperCase()}</span>` : '') +
        (b.cost ? `<span class="cost">◆${b.cost}</span>` : '');
      el.title = b.tip || b.label;
      if (!b.disabled) el.addEventListener('click', b.onClick);
      this.cmdCard.appendChild(el);
    }
  }
  _cardSignature(sel) {
    if (!sel.length) return 'none';
    const g = this.g;
    const keys = [...new Set(sel.map(e => e.key))].sort().join(',');
    const m = Math.floor(g.players[TEAM.PLAYER].minerals / 25);
    const tech = (g.buildings.some(b => b.team === TEAM.PLAYER && b.key === 'factory' && !b.constructing) ? 'F' : '') +
                 (g.buildings.some(b => b.team === TEAM.PLAYER && b.key === 'barracks' && !b.constructing) ? 'B' : '');
    const q = sel[0].kind === 'building' && sel[0].queue ? sel[0].queue.length : 0;
    return `${keys}|${sel.length}|${m}|${tech}|${q}|${sel[0].constructing ? 'c' : ''}`;
  }

  _cardButtons(sel) {
    const g = this.g, h = this.h;
    const onlyBuildings = sel.every(e => e.kind === 'building');
    const playerOwned = sel.every(e => e.team === TEAM.PLAYER);
    if (!playerOwned) return [];

    if (onlyBuildings && sel.length === 1) {
      const b = sel[0];
      if (b.constructing) return [];
      const out = [];
      for (const key of (b.def.produces || [])) {
        const def = UNITS[key];
        const techOk = !def.requires || g.buildings.some(x => x.team === TEAM.PLAYER && x.key === def.requires && !x.constructing);
        const afford = g.players[TEAM.PLAYER].minerals >= def.cost;
        out.push({
          icon: def.icon, label: def.name.split(' ')[0], hot: PRODUCE_HOTKEYS[key], cost: def.cost,
          disabled: !techOk, tip: `${def.name} — ${def.desc}${!techOk ? ` (needs ${BUILDINGS[def.requires].name})` : ''}`,
          onClick: () => h.onProduce(b, key),
        });
      }
      return out;
    }

    // Units selected.
    const out = [];
    const hasMilitary = sel.some(e => e.kind === 'unit' && e.def.damage > 0);
    out.push({ icon: '🚩', label: 'Move', hot: 'm', tip: 'Move (M), then click', onClick: () => h.onCommandMode('move') });
    out.push({ icon: '⚔', label: 'Attack', hot: 'a', tip: 'Attack-move (A), then click', onClick: () => h.onCommandMode('attack') });
    out.push({ icon: '⏹', label: 'Stop', hot: 's', tip: 'Stop (S)', onClick: () => h.onCommand('stop') });
    out.push({ icon: '⛨', label: 'Hold', hot: 'h', tip: 'Hold position (H)', onClick: () => h.onCommand('hold') });

    const hasWorker = sel.some(e => e.kind === 'unit' && e.isWorker);
    if (hasWorker) {
      for (const key of BUILDABLE) {
        const def = BUILDINGS[key];
        const techOk = !def.requires || g.buildings.some(x => x.team === TEAM.PLAYER && x.key === def.requires && !x.constructing);
        out.push({
          icon: def.icon, label: def.name.split(' ')[0], hot: BUILD_HOTKEYS[key], cost: def.cost,
          disabled: !techOk, tip: `Build ${def.name} — ${def.desc}`,
          onClick: () => h.onBuild(key),
        });
      }
    }
    return out;
  }

  markCardDirty() { this._cardDirty = true; }

  // ---- Minimap ----
  _renderMinimap() {
    const g = this.g, ctx = this.mmCtx;
    const S = this.minimap.width;
    const sx = S / (g.W * TILE), sy = S / (g.H * TILE);
    ctx.fillStyle = '#05080d'; ctx.fillRect(0, 0, S, S);

    // terrain (downsampled): step over tiles.
    const step = Math.max(1, Math.floor(g.W / 110));
    for (let ty = 0; ty < g.H; ty += step) {
      for (let tx = 0; tx < g.W; tx += step) {
        if (!g.fog.isExploredTile(tx, ty)) continue;
        const terr = g.grid.terrain[g.grid.idx(tx, ty)];
        ctx.fillStyle = terr === TERRAIN.ROCK ? '#3a4049' : terr === TERRAIN.DIRT ? '#262217' : '#16281c';
        if (!g.fog.isVisibleTile(tx, ty)) ctx.globalAlpha = 0.55;
        ctx.fillRect(tx * TILE * sx, ty * TILE * sy, TILE * sx * step + 1, TILE * sy * step + 1);
        ctx.globalAlpha = 1;
      }
    }
    // resources
    for (const r of g.resources) {
      if (!g.fog.isExploredTile(r.tx, r.ty)) continue;
      ctx.fillStyle = '#5fe3c9';
      ctx.fillRect(r.x * sx - 1, r.y * sy - 1, 2, 2);
    }
    // buildings
    for (const b of g.buildings) {
      if (b.team !== TEAM.PLAYER && !g.fog.isVisibleTile(b.tx, b.ty)) continue;
      ctx.fillStyle = TEAM_COLOR[b.team];
      ctx.fillRect(b.tx * TILE * sx, b.ty * TILE * sy, Math.max(3, b.tw * TILE * sx), Math.max(3, b.th * TILE * sy));
    }
    // units
    for (const u of g.units) {
      if (u.team !== TEAM.PLAYER && !g.fog.isVisibleWorld(u.x, u.y)) continue;
      ctx.fillStyle = TEAM_COLOR[u.team];
      ctx.fillRect(u.x * sx - 1, u.y * sy - 1, u.isWorker ? 1.6 : 2.4, u.isWorker ? 1.6 : 2.4);
    }
    // attack pings
    for (const p of g.pings) {
      const a = 1 - p.t / p.max;
      ctx.globalAlpha = a; ctx.strokeStyle = p.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x * sx, p.y * sy, (1 - a) * 8 + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // camera viewport
    const b = g.camera.visibleBounds();
    ctx.strokeStyle = '#dbe7f5'; ctx.lineWidth = 1;
    ctx.strokeRect(b.x0 * sx, b.y0 * sy, (b.x1 - b.x0) * sx, (b.y1 - b.y0) * sy);
  }
}
