// Static game data: tuning constants + unit/building definitions.

export const TILE = 28;                 // pixels per tile
export const TICK = 1 / 60;             // fixed simulation step (seconds)

export const MAP_SIZES = {
  small:  { w: 56, h: 56 },
  medium: { w: 76, h: 76 },
  large:  { w: 100, h: 100 },
};

export const TEAM = { PLAYER: 0, ENEMY: 1, NEUTRAL: 2 };
export const TEAM_COLOR = { 0: '#3da9fc', 1: '#ef5366', 2: '#9bb0c9' };
export const TEAM_COLOR_DARK = { 0: '#1d5f96', 1: '#9a2f3e', 2: '#5a6b80' };

export const MINERAL_PER_TRIP = 8;
export const MINERAL_PATCH_AMOUNT = 1500;

export const START_MINERALS = 150;
export const START_SUPPLY_CAP = 11;     // from the starting command center
export const SUPPLY_HARD_CAP = 200;

export const DIFFICULTY = {
  easy:   { aiMineralMult: 0.85, aiBuildDelay: 1.4, aiArmySize: 6,  aiFirstAttack: 150, label: 'Easy' },
  normal: { aiMineralMult: 1.0,  aiBuildDelay: 1.0, aiArmySize: 9,  aiFirstAttack: 110, label: 'Normal' },
  hard:   { aiMineralMult: 1.25, aiBuildDelay: 0.7, aiArmySize: 13, aiFirstAttack: 80,  label: 'Hard' },
};

// ---- Unit definitions ----
// radius in px, speed px/s, range in px, sight in tiles.
export const UNITS = {
  worker: {
    key: 'worker', name: 'Worker', icon: '⛏', glyph: 'W',
    hp: 45, armor: 0, radius: 8, speed: 95, sight: 7,
    damage: 4, range: 16, attackCooldown: 1.1, attackKind: 'melee',
    cost: 50, supply: 1, buildTime: 11,
    canGather: true, canBuild: true,
    desc: 'Gathers minerals and constructs buildings.',
  },
  marine: {
    key: 'marine', name: 'Marine', icon: '🔫', glyph: 'M',
    hp: 55, armor: 0, radius: 8, speed: 90, sight: 8,
    damage: 7, range: 130, attackCooldown: 0.8, attackKind: 'ranged',
    projSpeed: 520, projColor: '#ffe08a',
    cost: 50, supply: 1, buildTime: 14, from: 'barracks',
    desc: 'Cheap ranged infantry. Backbone of any army.',
  },
  ranger: {
    key: 'ranger', name: 'Ranger', icon: '🎯', glyph: 'R',
    hp: 75, armor: 1, radius: 9, speed: 78, sight: 10,
    damage: 14, range: 185, attackCooldown: 1.5, attackKind: 'ranged',
    projSpeed: 640, projColor: '#9be7ff',
    cost: 75, supply: 2, buildTime: 22, from: 'barracks', requires: 'factory',
    desc: 'Long-range sniper. Great vs clustered enemies.',
  },
  tank: {
    key: 'tank', name: 'Siege Tank', icon: '🛡', glyph: 'T',
    hp: 220, armor: 3, radius: 13, speed: 58, sight: 9,
    damage: 32, range: 175, attackCooldown: 2.0, attackKind: 'ranged',
    projSpeed: 460, projColor: '#ffb15a', splash: 34,
    cost: 175, supply: 4, buildTime: 36, from: 'factory',
    desc: 'Heavy armor with splash damage. Slow but devastating.',
  },
};

// ---- Building definitions ----
// tw/th = footprint in tiles.
export const BUILDINGS = {
  command: {
    key: 'command', name: 'Command Center', icon: '🏛', tw: 3, th: 3,
    hp: 1600, armor: 4, sight: 10,
    cost: 400, supplyProvided: 11, isDropoff: true,
    produces: ['worker'], rally: true,
    desc: 'Trains Workers, stores minerals, supplies 11.',
  },
  depot: {
    key: 'depot', name: 'Supply Depot', icon: '📦', tw: 2, th: 2,
    hp: 450, armor: 2, sight: 5,
    cost: 100, supplyProvided: 8,
    desc: 'Raises your supply cap by 8.',
  },
  barracks: {
    key: 'barracks', name: 'Barracks', icon: '🏭', tw: 3, th: 3,
    hp: 1000, armor: 3, sight: 7,
    cost: 150, supplyProvided: 0, produces: ['marine', 'ranger'], rally: true,
    desc: 'Trains Marines and (with a Factory) Rangers.',
  },
  factory: {
    key: 'factory', name: 'Factory', icon: '⚙', tw: 3, th: 3,
    hp: 1250, armor: 3, sight: 7,
    cost: 200, supplyProvided: 0, produces: ['tank'], rally: true,
    requires: 'barracks',
    desc: 'Trains Siege Tanks. Unlocks Rangers. Requires Barracks.',
  },
  turret: {
    key: 'turret', name: 'Turret', icon: '🔺', tw: 2, th: 2,
    hp: 650, armor: 4, sight: 9,
    cost: 125, supplyProvided: 0,
    damage: 12, range: 175, attackCooldown: 0.7, attackKind: 'ranged',
    projSpeed: 600, projColor: '#ff8a5a',
    desc: 'Automated defense. Attacks nearby enemies.',
  },
};

// What a worker can build, in command-card order.
export const BUILDABLE = ['depot', 'barracks', 'factory', 'turret'];

export function unitDef(k) { return UNITS[k]; }
export function buildingDef(k) { return BUILDINGS[k]; }
