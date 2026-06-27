# PROGRESS — Astro Command (Browser RTS)

## Goal
Build the best self-contained, dependency-free browser Real-Time Strategy game.
Vanilla JS + Canvas 2D, ES modules, served by a tiny built-in Node static server
(no npm deps). Fully playable: economy, base building, unit production, combat,
pathfinding, fog of war, enemy AI, minimap, HUD, win/lose.

## How to run
```
node server.js        # serves on http://localhost:8080
```
Open http://localhost:8080 in a browser.

## Requirements / Feature checklist
- [x] Project scaffold + static server
- [x] Game loop (fixed-timestep update + render), camera (WASD/arrows/edge-pan/zoom)
- [x] Tile grid map w/ terrain (grass, rock obstacles), resource patches
- [x] Entities: Buildings, Units, Resources, Projectiles
- [x] Economy: minerals + supply cap, worker harvesting + drop-off
- [x] Production: build queues, rally points, worker-built structures w/ placement preview
- [x] Selection: click, drag-box, shift-add, double-click type select, control groups 1-9
- [x] Commands: move, attack-move (A), gather, build, stop (S), hold
- [x] Combat: auto-acquire, projectiles, splash, death, armor
- [x] Pathfinding: A* on grid + local collision avoidance (steering)
- [x] Fog of war: unexplored / explored / visible per line-of-sight
- [x] Enemy AI: economy ramp, army training, waves of attacks, difficulty
- [x] HUD: resource bar, command card (context buttons), selection panel
- [x] Minimap: terrain+units+fog, click-to-pan, right-click command
- [x] Audio: procedural WebAudio sfx (no asset files)
- [x] Menus: main menu, pause, victory/defeat
- [x] Particles/polish: explosions, muzzle flashes, selection rings, health bars, rally lines

## Architecture (src/)
- config.js   — constants + unit/building definitions
- util.js     — math/vec/random helpers
- audio.js    — procedural WebAudio sound
- grid.js     — tile map, terrain, buildability, occupancy
- pathfinding.js — A*
- camera.js   — viewport pan/zoom + world<->screen
- input.js    — mouse/keyboard state
- entities.js — Unit / Building / Resource / Projectile / Particle
- fog.js      — fog of war
- ai.js       — enemy AI controller
- game.js     — world state + all systems (the core)
- render.js   — world rendering
- ui.js       — HUD + minimap + selection + command card
- main.js     — bootstrap, menu, main loop

## Status: COMPLETE & VERIFIED v1.1. See README.md.

### v1.1 — Interactive tutorial (answers "how do I make my units collect?")
- New `src/tutorial.js`: step-driven, state-aware tutorial overlay.
  Steps: intro → ① select a Worker → ② right-click minerals to mine →
  ③ watch the auto drop-off raise your ◆ → done (with pro tips: D=train worker,
  box-select, Supply Depot). Task steps auto-advance when polled `done(g)` is met;
  intro/final advance via a button. Draws a pulsing ring + bobbing arrow on the
  canvas pointing at the relevant target (worker / mineral patch / command center).
- `src/game.js`: added `this.stats.playerDeliveries`, incremented on each player
  mineral drop-off in `_stateReturn` — that's the signal step ③ waits on.
- `index.html`: new `#btn-tutorial` menu button ("▶ TUTORIAL — learn to gather");
  updated How-to-play Economy line to spell out select→right-click and point at it.
- `styles.css`: `.bigbtn.alt` + `#tutorial`/`.tut-*` panel styles.
- `src/main.js`: `startGame(withTutorial)`; tutorial runs on Easy/Small, is updated
  (skipped while paused) and drawn each frame; finishing/skipping removes the panel.
- Tests: new `test/tutorial.mjs` (11 assertions, drives all steps incl. a real
  mined drop-off in the sim) wired into `npm test`; `test/dom-smoke.mjs` now also
  starts the tutorial through main.js and pumps frames (Tutorial draw/update covered).
  Full suite green: smoke + dom-smoke (0 errors) + tutorial (11/11).

### v1.1 — CRITICAL BUG FIX: manual gather never collected (root cause found)
SYMPTOM (operator): right-clicking a mineral patch with your own workers showed the
command sound + ping dot and the workers walked over, but cargo/minerals NEVER went
up — yet auto-gather (a worker finishing a building) worked fine.
ROOT CAUSE: `Resource` had no `team` property. `isEnemy(a,b)` is
`a.team !== b.team && b.team !== NEUTRAL`; with `b.team === undefined` it returned
TRUE for (worker, patch). `issueSelectionCommand` checked `isEnemy` BEFORE the
resource-gather branch, so a right-click on minerals issued an ATTACK on the crystals
instead of a GATHER. Only the player's manual path hit this; the AI and
auto-gather-after-build call `gather()`/set `state='gather'` directly, so they worked
— exactly matching "auto works, manual never does".
FIX:
- `src/entities.js`: `Resource.team = TEAM.NEUTRAL` (root cause).
- `src/game.js` `issueSelectionCommand`: check the resource-gather branch BEFORE the
  enemy branch (defense-in-depth).
Repro that nailed it: select all 5 starting workers, right-click the base mineral
line → before: 0/5 mined, minerals 150→150; after: 5/5 mined, 150→518, 46 deliveries.
Regression test added in `test/gather.mjs` (asserts right-click → state 'gather',
all workers collect, minerals rise).

### v1.1 — Supporting robustness/UX changes (kept; all help, none required for the fix)
- `src/game.js` `_stateGather`: widened mine-reach to `radius+patchRadius+TILE*0.8`
  (mineral tiles are solid so a worker can only stand on an adjacent tile; old +3
  reach was marginal and hurt crowded patches) + stuck-recovery (re-target nearest
  patch if it can't reach the clicked one for 2.5s, like auto-gather). Improves
  throughput on crowded/awkward patches.
- `src/game.js` `issueSelectionCommand`: right-click "snap" to a mineral within
  1.4 tiles when a worker is selected (forgives near-misses on the small crystal hitbox).
- `src/ui.js`: worker panel now shows "Carrying ◆ N" + a live activity line
  (Mining…/Heading to minerals/Returning…/Building).
- `src/server.js`: no-cache headers so playtests always get fresh JS (was a real risk
  of the browser masking fixes with stale modules).

### Verification done
- `node --check` on every JS file: pass.
- `npm test` → `test/smoke.mjs` (sim: economy, construction, AI ramp, win/lose on
  easy/normal/hard) ALL CHECKS PASSED; `test/dom-smoke.mjs` (1251 real render/UI/input
  frames with synthetic input via a stubbed DOM) 0 errors.
- Server serves all ES modules with correct `text/javascript` MIME.
- A real headless browser was NOT runnable here: chromium needs system libs
  (libglib-2.0.so.0) and there's no sudo/apt. Code path is covered by the DOM harness
  instead. To eyeball it: `node server.js` → open http://localhost:8080.

### Key bugs found & fixed during build (don't reintroduce)
1. Unit state switch was missing `case 'returnCargo'` → workers froze after mining. Fixed.
2. `_updateBuilding` re-checked builder distance to building CENTER too tightly (a 3x3
   building's center is ~72px from its edge) → construction stalled. Now trusts the
   on-site flag set by `_stateBuild`. Fixed.
3. AI packed buildings adjacent and walled its own workers out → AI economy stalled.
   `aiPlaceBuilding` now requires a 1-tile moat (`canBuild(tx-1,ty-1,tw+2,th+2)`). Fixed.
4. Added generic stuck-recovery (nudge + repath) in `_updateUnit` for boxed-in units.

## Next ideas (if resumed — all optional, game is fully done)
- More unit types (air), upgrades/tech tree, multiple AI expansion bases, save/load,
  touch controls, sound volume slider, replay of a real browser screenshot once a
  chromium with system libs is available.
</content>
</invoke>
