// Procedural sound effects via WebAudio — no asset files needed.

let ctx = null;
let master = null;
let enabled = true;
let lastPlay = {};

function ensure() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  } catch (e) { enabled = false; }
}

export function resumeAudio() {
  ensure();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setVolume(v) { ensure(); if (master) master.gain.value = v; }
export function toggleMute() { enabled = !enabled; return enabled; }

// Throttle so spammy events (many units firing) don't blow out.
function throttled(key, ms) {
  const now = performance.now();
  if (lastPlay[key] && now - lastPlay[key] < ms) return false;
  lastPlay[key] = now;
  return true;
}

function tone({ freq = 440, dur = 0.12, type = 'sine', vol = 0.5, slide = 0, delay = 0 }) {
  if (!enabled) return;
  ensure();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.4, lp = 1200, delay = 0 }) {
  if (!enabled) return;
  ensure();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = lp;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t0);
}

export const Sfx = {
  select() { if (throttled('sel', 60)) tone({ freq: 660, dur: 0.06, type: 'triangle', vol: 0.25 }); },
  command() { if (throttled('cmd', 60)) tone({ freq: 380, dur: 0.07, type: 'square', vol: 0.18, slide: 120 }); },
  shoot() { if (throttled('shoot', 45)) tone({ freq: 880, dur: 0.05, type: 'square', vol: 0.12, slide: -500 }); },
  cannon() { if (throttled('cannon', 80)) { tone({ freq: 180, dur: 0.18, type: 'sawtooth', vol: 0.3, slide: -90 }); noise({ dur: 0.14, vol: 0.22, lp: 800 }); } },
  hit() { if (throttled('hit', 50)) noise({ dur: 0.05, vol: 0.12, lp: 2500 }); },
  explode() { if (throttled('exp', 60)) { noise({ dur: 0.35, vol: 0.4, lp: 700 }); tone({ freq: 90, dur: 0.3, type: 'sawtooth', vol: 0.3, slide: -40 }); } },
  build() { tone({ freq: 300, dur: 0.1, type: 'triangle', vol: 0.25, slide: 200 }); tone({ freq: 500, dur: 0.12, type: 'triangle', vol: 0.2, delay: 0.1 }); },
  ready() { tone({ freq: 520, dur: 0.1, type: 'sine', vol: 0.3 }); tone({ freq: 780, dur: 0.14, type: 'sine', vol: 0.28, delay: 0.1 }); },
  gather() { if (throttled('gather', 120)) tone({ freq: 720, dur: 0.05, type: 'sine', vol: 0.1 }); },
  deny() { tone({ freq: 200, dur: 0.12, type: 'square', vol: 0.22, slide: -60 }); },
  alert() { tone({ freq: 440, dur: 0.12, type: 'sine', vol: 0.3 }); tone({ freq: 440, dur: 0.12, type: 'sine', vol: 0.3, delay: 0.16 }); },
  victory() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.32, delay: i * 0.16 })); },
  defeat() { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sawtooth', vol: 0.3, delay: i * 0.2 })); },
};
