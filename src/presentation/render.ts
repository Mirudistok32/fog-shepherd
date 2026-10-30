/**
 * Отрисовка кадра: небо с рассветом и деревня, луг (нарисован заранее на отдельном
 * холсте), овцы и собака, туман с силуэтами, круги свиста и блеяния. Холст высотой
 * WORLD_H, ширина — по пропорциям окна; если луг не влезает целиком, камера едет за собакой.
 */

import type { Frame } from '@/application/game';
import { clearRadius, dawnOf, fogAt, fogDensity, lanternLight, silhouetteAt } from '@/domain/fog';
import { CELL, cellAt, cellOf } from '@/domain/grid';
import { type Dog, type HerdEvent, type Run, type Sheep } from '@/domain/herd';
import type { Bush, Fence, House, Level, Point, Tree } from '@/domain/level';
import { COLS, HORIZON, ROWS, TILE, WHISTLE_R, WORLD_H, WORLD_W } from '@/domain/world';

import { byDawn, fogColor, mix, PALETTES, type ScenePalette, SKY_LOW, SKY_TOP } from './palette';
import {
  bake,
  type Baked,
  DOG_DOWN,
  DOG_JUMP,
  DOG_OUTLINE,
  DOG_PAL,
  DOG_RUN,
  DOG_SIT,
  DOG_STAND,
  DOG_SWIM,
  DOG_UP,
  LANTERN,
  LANTERN_PAL,
  mirror,
  type Rows,
  RUN_BOB,
  SHEEP_ALERT,
  SHEEP_DOWN,
  SHEEP_GRAZE,
  SHEEP_OUTLINE,
  SHEEP_PAL,
  SHEEP_RUN,
  SHEEP_STAND,
  SHEEP_UP,
  SHEEP_WALK,
  silhouette,
} from './sprites';

/** Уже этого луг не сжимается: на узком экране камера едет за собакой. */
export const MIN_VIEW_W = 192;

/** Ширина холста в пикселях игры по пропорциям окна. */
export const viewWidth = (cssW: number, cssH: number): number =>
  Math.min(WORLD_W, Math.max(MIN_VIEW_W, Math.round((cssW / Math.max(1, cssH)) * WORLD_H)));

type Ctx = CanvasRenderingContext2D;

/** Детерминированный шум 0–1 по целому числу. */
function noise(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const noise2 = (x: number, y: number) =>
  noise(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663));

const WOOD = '#8A5A3C';
const WOOD_DARK = '#5E3E2A';
const WOOD_LIGHT = '#B0855A';
const PLANK = '#9C7148';
const WATTLE = '#8A6A44';
const WATTLE_DARK = '#6A5034';
const SNOW = '#F7FAFD';
const SILHOUETTE = '#2B3040';
const SHADOW = 'rgba(20, 24, 18, 0.28)';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16);
const FOG_PX = 2;
const NOISE_N = 64;

/** Плавный шум 64×64 для клочьев тумана: решётка 8×8, сглаженная билинейно, по кругу. */
function fogNoise(): Float32Array {
  const grid = 8;
  const pts = Array.from({ length: grid * grid }, (_, i) => noise(i * 7919 + 13));
  const out = new Float32Array(NOISE_N * NOISE_N);
  const cell = NOISE_N / grid;
  for (let y = 0; y < NOISE_N; y++) {
    for (let x = 0; x < NOISE_N; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => pts[(j % grid) * grid + (i % grid)] ?? 0;
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[y * NOISE_N + x] = top + (bottom - top) * sy;
    }
  }
  return out;
}

interface Effect {
  kind: 'bleat' | 'whistle' | 'penned' | 'stray' | 'lost';
  x: number;
  y: number;
  at: number;
  warm: boolean;
}

const LIFE: Record<Effect['kind'], number> = {
  bleat: 1.1,
  whistle: 0.75,
  penned: 0.7,
  stray: 1.4,
  lost: 1.8,
};

interface Village {
  windows: Point[];
  chimneys: Point[];
}

/** Куда развёрнут рисунок: боком, от нас или на нас. */
type Heading = 'side' | 'up' | 'down';

/** Что вид помнит про бегущего: только для анимации, на игру это не влияет. */
interface Motion {
  heading: Heading;
  face: number;
  /** Когда развернулся: на миг рисуется кадр поворота. */
  turned: number;
  /** С каких пор стоит и сколько пробежал с прошлого следа. */
  still: number;
  trail: number;
  vx: number;
  vy: number;
  /** Когда заблеяла и когда вошла в загон. */
  bleat: number;
  hop: number;
}

const newMotion = (face: number): Motion => ({
  heading: 'side',
  face,
  turned: -1,
  still: 0,
  trail: 0,
  vx: 0,
  vy: 0,
  bleat: -1,
  hop: -1,
});

/** Частица из-под лап; print — след на снегу, лежит и тает. */
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
}

const MAX_MOTES = 110;
const MAX_PRINTS = 160;
/** Кадр поворота и прыжок в загон, с. */
const TURN_TIME = 0.1;
const HOP_TIME = 0.4;

/** Смена направления с запасом, чтобы рисунок не мигал на диагонали. */
function headingOf(prev: Heading, vx: number, vy: number): Heading {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (prev === 'side' ? ay < ax * 1.4 : ay < ax * 0.8) return 'side';
  return vy < 0 ? 'up' : 'down';
}

export function createRenderer(canvas: HTMLCanvasElement, opts: { reducedMotion: () => boolean }) {
  const maybe = canvas.getContext('2d');
  if (!maybe) throw new Error('canvas 2d недоступен');
  const ctx: Ctx = maybe;
  let W = 320;
  let cam = 0;
  let camReady = false;
  let lastTime = 0;
  let effects: Effect[] = [];
  let background: {
    key: string;
    canvas: HTMLCanvasElement;
    village: Village;
    ripples: Point[];
  } | null = null;
  let dogMotion = newMotion(1);
  let sheepMotion: Motion[] = [];
  let lastRunTime = 0;
  let dogLift = 0;
  let motes: Mote[] = [];
  let prints: Mote[] = [];
  let spawned = 0;
  const fog = document.createElement('canvas');
  const fogCtx = fog.getContext('2d') as Ctx;
  let fogImage: ImageData | null = null;
  const wisps = fogNoise();

  const rect = (c: Ctx, x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  const disc = (c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string) => {
    c.fillStyle = color;
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)));
      c.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2, 1);
    }
  };

  /** Окружность пикселями (через точку при dotted) — для кругов свиста и блеяния. */
  const ring = (cx: number, cy: number, r: number, color: string, dotted = false) => {
    ctx.fillStyle = color;
    const n = Math.max(8, Math.round(r * 6.3));
    for (let i = 0; i < n; i++) {
      if (dotted && i % 2 === 1) continue;
      const a = (i / n) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
  };

  /* ---------- неподвижный фон уровня ---------- */

  function tree(c: Ctx, t: Tree, pal: ScenePalette) {
    const s = t.size;
    if (t.kind === 'fir') {
      rect(c, t.x - 1, t.y - 3, 2, 3, WOOD_DARK);
      const tiers: [number, number, number][] = [
        [t.y - s * 0.55, t.y - 2, s * 0.42],
        [t.y - s * 0.8, t.y - s * 0.4, s * 0.32],
        [t.y - s, t.y - s * 0.66, s * 0.2],
      ];
      for (const [top, bottom, half] of tiers) {
        const h = Math.max(1, bottom - top);
        for (let y = 0; y <= h; y++) {
          const w = Math.max(1, Math.round(half * (0.15 + 0.85 * (y / h))));
          rect(c, t.x - w, top + y, w, 1, pal.fir);
          rect(c, t.x, top + y, w, 1, pal.firDark);
        }
        if (pal.snow) rect(c, t.x - half * 0.35, top + 1, half * 0.7, 1, SNOW);
      }
    } else {
      rect(c, t.x - 1, t.y - s * 0.45, 2, s * 0.45, WOOD_DARK);
      const cy = t.y - s * 0.62;
      const r = s * 0.38;
      disc(c, t.x, cy, r, r * 0.9, pal.crownDark);
      disc(c, t.x - 1, cy - 1, r - 1.5, r * 0.9 - 1.5, pal.crown);
    }
  }

  function bush(c: Ctx, b: Bush, pal: ScenePalette) {
    const seed = Math.round(b.x * 31 + b.y * 17);
    disc(c, b.x + 1, b.y + 2, b.r, b.r * 0.55, SHADOW);
    disc(c, b.x, b.y, b.r, b.r * 0.85, pal.bushDark);
    disc(c, b.x - b.r * 0.3, b.y - b.r * 0.2, b.r * 0.6, b.r * 0.55, pal.bush);
    disc(c, b.x + b.r * 0.35, b.y - b.r * 0.1, b.r * 0.55, b.r * 0.5, pal.bush);
    for (let i = 0; i < 5; i++) {
      const a = noise(seed + i) * Math.PI * 2;
      const d = noise(seed + i + 9) * b.r * 0.7;
      rect(c, b.x + Math.cos(a) * d, b.y + Math.sin(a) * d * 0.7 - 1, 1, 1, pal.bushLight);
    }
    for (let i = 0; i < 4; i++) {
      const a = noise(seed + i + 40) * Math.PI * 2;
      const d = noise(seed + i + 60) * b.r * 0.75;
      rect(c, b.x + Math.cos(a) * d, b.y + Math.sin(a) * d * 0.7, 1, 1, pal.berry);
    }
    if (pal.snow) rect(c, b.x - b.r * 0.6, b.y - b.r * 0.75, b.r * 1.2, 1, SNOW);
  }

  /** Отрезок забора: столбики и две жерди; вертикальный — столбики и жерди сверху вниз. */
  function fence(c: Ctx, f: Fence, snow: boolean) {
    if (f.h === TILE) {
      rect(c, f.x, f.y + 4, f.w, 1, SHADOW);
      rect(c, f.x, f.y - 1, f.w, 1, WOOD_LIGHT);
      rect(c, f.x, f.y + 2, f.w, 1, WOOD_LIGHT);
      for (let x = f.x + 1; x < f.x + f.w; x += 6) {
        rect(c, x, f.y - 3, 2, 7, WOOD_DARK);
        rect(c, x, f.y - 3, 2, 1, snow ? SNOW : WOOD_LIGHT);
      }
      rect(c, f.x + f.w - 2, f.y - 3, 2, 7, WOOD_DARK);
    } else {
      rect(c, f.x + 3, f.y, 1, f.h, SHADOW);
      rect(c, f.x + 1, f.y - 2, 1, f.h, WOOD_LIGHT);
      rect(c, f.x + 2, f.y - 2, 1, f.h, WOOD);
      for (let y = f.y; y < f.y + f.h; y += 5) {
        rect(c, f.x + 1, y - 3, 2, 5, WOOD_DARK);
        rect(c, f.x + 1, y - 3, 2, 1, snow ? SNOW : WOOD_LIGHT);
      }
    }
  }

  function penWalls(c: Ctx, level: Level, pal: ScenePalette) {
    const p = level.pen;
    const x0 = p.inner.x - TILE;
    const y0 = p.inner.y - TILE;
    const x1 = p.inner.x + p.inner.w;
    const y1 = p.inner.y + p.inner.h;
    // Пол загона: вытоптанная земля и солома.
    rect(c, p.inner.x, p.inner.y, p.inner.w, p.inner.h, pal.penFloor);
    for (let i = 0; i < (p.inner.w * p.inner.h) / 10; i++) {
      const x = p.inner.x + noise(i * 3 + 1) * p.inner.w;
      const y = p.inner.y + noise(i * 3 + 2) * p.inner.h;
      rect(c, x, y, 2, 1, noise(i) < 0.5 ? '#C9A85A' : mix(pal.penFloor, '#000000', 0.15));
    }
    const pieces: Fence[] = [];
    const gate = p.gate;
    const horizontal = (y: number, from: number, to: number) => {
      if (p.side === (y === y0 ? 'top' : 'bottom') && gate.y === y) {
        if (gate.x > from) pieces.push({ x: from, y, w: gate.x - from, h: TILE });
        if (gate.x + gate.w < to)
          pieces.push({ x: gate.x + gate.w, y, w: to - gate.x - gate.w, h: TILE });
      } else pieces.push({ x: from, y, w: to - from, h: TILE });
    };
    const vertical = (x: number, from: number, to: number) => {
      if (p.side === (x === x0 ? 'left' : 'right') && gate.x === x) {
        if (gate.y > from) pieces.push({ x, y: from, w: TILE, h: gate.y - from });
        if (gate.y + gate.h < to)
          pieces.push({ x, y: gate.y + gate.h, w: TILE, h: to - gate.y - gate.h });
      } else pieces.push({ x, y: from, w: TILE, h: to - from });
    };
    vertical(x0, y0, y1 + TILE);
    vertical(x1, y0, y1 + TILE);
    horizontal(y0, x0, x1 + TILE);
    horizontal(y1, x0, x1 + TILE);
    for (const f of pieces.sort((a, b) => a.y - b.y)) fence(c, f, pal.snow);
    // Столбы ворот — выше и толще.
    const posts =
      p.side === 'top' || p.side === 'bottom'
        ? [
            { x: gate.x - 2, y: gate.y },
            { x: gate.x + gate.w, y: gate.y },
          ]
        : [
            { x: gate.x + 1, y: gate.y - 2 },
            { x: gate.x + 1, y: gate.y + gate.h },
          ];
    for (const q of posts) {
      rect(c, q.x, q.y - 6, 3, 10, WOOD_DARK);
      rect(c, q.x, q.y - 6, 3, 1, pal.snow ? SNOW : WOOD_LIGHT);
    }
  }

  function water(c: Ctx, level: Level, pal: ScenePalette) {
    const g = level.grid;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cell = cellAt(g, col, row);
        if (cell !== CELL.water && cell !== CELL.bridge) continue;
        const x = col * TILE;
        const y = row * TILE;
        rect(c, x, y, TILE, TILE, pal.water);
        const wet = (dc: number, dr: number) => {
          const n = cellAt(g, col + dc, row + dr);
          return n === CELL.water || n === CELL.bridge || row + dr < HORIZON / TILE;
        };
        if (!wet(-1, 0)) rect(c, x, y, 1, TILE, pal.waterDark);
        if (!wet(1, 0)) rect(c, x + TILE - 1, y, 1, TILE, pal.waterDark);
        if (!wet(0, -1)) rect(c, x, y, TILE, 1, pal.waterDark);
        if (!wet(0, 1)) rect(c, x, y + TILE - 1, TILE, 1, pal.waterDark);
        if (noise2(col, row) < 0.25) rect(c, x + 1, y + 1, 2, 1, pal.waterLight);
      }
    }
    for (const b of level.stream?.bridges ?? []) {
      const across = level.stream?.axis === 'vertical';
      rect(c, b.x, b.y, b.w, b.h, PLANK);
      if (across) {
        for (let x = b.x; x < b.x + b.w; x += 3) rect(c, x, b.y, 1, b.h, WOOD_DARK);
        rect(c, b.x, b.y, b.w, 1, WOOD_LIGHT);
        rect(c, b.x, b.y + b.h - 1, b.w, 1, WOOD_DARK);
        rect(c, b.x, b.y + b.h, b.w, 1, SHADOW);
      } else {
        for (let y = b.y; y < b.y + b.h; y += 3) rect(c, b.x, y, b.w, 1, WOOD_DARK);
        rect(c, b.x, b.y, 1, b.h, WOOD_LIGHT);
        rect(c, b.x + b.w - 1, b.y, 1, b.h, WOOD_DARK);
      }
      if (pal.snow) rect(c, b.x + 1, b.y + 1, b.w - 2, 1, SNOW);
    }
  }

  function house(c: Ctx, h: House, pal: ScenePalette, village: Village) {
    const base = HORIZON - 4;
    if (h.kind === 'church') {
      const cx = h.x + h.w / 2;
      rect(c, h.x + 4, base - 14, h.w - 8, 14, '#E4DED2');
      rect(c, h.x + 4, base - 14, h.w - 8, 1, '#C9C1B2');
      rect(c, cx - 5, base - 20, 10, 6, '#E4DED2');
      disc(c, cx, base - 23, 4, 4, pal.snow ? '#4A6FA5' : '#E8B04B');
      rect(c, cx, base - 31, 1, 5, '#C9A040');
      rect(c, cx - 1, base - 30, 3, 1, '#C9A040');
      village.windows.push({ x: cx - 1, y: base - 10 }, { x: h.x + 7, y: base - 9 });
      return;
    }
    const wallH = Math.round(h.h * 0.5);
    const wall = h.kind === 'barn' ? WOOD_DARK : WOOD;
    rect(c, h.x, base - wallH, h.w, wallH, wall);
    for (let y = base - wallH + 1; y < base; y += 2) rect(c, h.x, y, h.w, 1, WOOD_DARK);
    const roofH = h.h - wallH;
    for (let y = 0; y < roofH; y++) {
      const half = (h.w / 2 + 2) * ((y + 1) / roofH);
      const color =
        pal.snow && y < roofH * 0.6 ? SNOW : y % 3 === 0 ? mix(pal.roof, '#000000', 0.2) : pal.roof;
      rect(c, h.x + h.w / 2 - half, base - h.h + y, half * 2, 1, color);
    }
    if (h.kind === 'izba') {
      village.windows.push({ x: h.x + Math.round(h.w / 2) - 1, y: base - wallH + 2 });
      const chimney = { x: h.x + Math.round(h.w * 0.7), y: base - h.h + 2 };
      rect(c, chimney.x, chimney.y - 3, 2, 4, '#7A4A3A');
      village.chimneys.push(chimney);
    } else {
      rect(c, h.x + h.w / 2 - 3, base - wallH + 1, 6, wallH - 1, '#4A3020');
    }
  }

  /** Плетень под деревней: плетёные прутья, колья и горшки на кольях. */
  function wattle(c: Ctx) {
    const y0 = HORIZON - 4;
    for (let x = 0; x < WORLD_W; x++) {
      for (let y = 0; y < 4; y++) {
        rect(c, x, y0 + y, 1, 1, (x + y * 2) % 6 < 3 ? WATTLE : WATTLE_DARK);
      }
    }
    for (let x = 4; x < WORLD_W; x += 12) {
      rect(c, x, y0 - 3, 2, 7, WOOD_DARK);
      if ((x / 12) % 4 === 1) rect(c, x - 1, y0 - 5, 4, 2, '#A8563A');
    }
    rect(c, 0, HORIZON, WORLD_W, 1, SHADOW);
  }

  function buildBackground(level: Level): {
    canvas: HTMLCanvasElement;
    village: Village;
    ripples: Point[];
  } {
    const out = document.createElement('canvas');
    out.width = WORLD_W;
    out.height = WORLD_H;
    const c = out.getContext('2d') as Ctx;
    const pal = PALETTES[level.spec.season];
    const village: Village = { windows: [], chimneys: [] };
    // Земля: луг, под лесом темнее, мелкая рябь травы.
    rect(c, 0, HORIZON - 4, WORLD_W, WORLD_H - HORIZON + 4, pal.grass);
    for (let y = HORIZON; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const n = noise2(x, y);
        if (n < 0.05) rect(c, x, y, 1, 1, pal.grassDark);
        else if (n > 0.965) rect(c, x, y, 1, 1, pal.grassLight);
      }
    }
    const forest = mix(pal.forestFloor, pal.grass, 0.15);
    rect(c, 0, HORIZON, 16, WORLD_H - HORIZON, forest);
    rect(c, WORLD_W - 16, HORIZON, 16, WORLD_H - HORIZON, forest);
    rect(c, 0, WORLD_H - 16, WORLD_W, 16, forest);
    for (const d of level.decor) {
      if (d.kind === 'tuft') {
        rect(c, d.x, d.y - 2, 1, 2, pal.tuft);
        rect(c, d.x + 1, d.y - 3, 1, 3, pal.tuft);
        rect(c, d.x + 2, d.y - 1, 1, 1, pal.tuft);
      } else if (d.kind === 'flower') {
        const color = pal.flowers[Math.floor(d.v * pal.flowers.length)] ?? '#FFFFFF';
        rect(c, d.x, d.y, 2, 2, color);
        if (!pal.snow) rect(c, d.x, d.y + 2, 1, 1, pal.tuft);
      } else {
        rect(c, d.x, d.y, 4, 2, '#8C8F94');
        rect(c, d.x, d.y, 3, 1, '#B4B7BC');
      }
    }
    water(c, level, pal);
    penWalls(c, level, pal);
    for (const b of [...level.bushes].sort((a, q) => a.y - q.y)) bush(c, b, pal);
    for (const f of [...level.fences].sort((a, q) => a.y - q.y)) fence(c, f, pal.snow);
    for (const t of level.trees) tree(c, t, pal);
    for (const h of level.houses) house(c, h, pal, village);
    wattle(c);
    const ripples: Point[] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (cellAt(level.grid, col, row) === CELL.water)
          ripples.push({ x: col * TILE, y: row * TILE });
      }
    }
    return { canvas: out, village, ripples };
  }

  /* ---------- небо и деревня ---------- */

  function sky(p: number, time: number, village: Village, reduced: boolean) {
    const top = byDawn(SKY_TOP, p);
    const low = byDawn(SKY_LOW, p);
    for (let y = 0; y < HORIZON; y += 2) rect(ctx, 0, y, W, 2, mix(top, low, y / HORIZON));
    // Звёзды гаснут к рассвету.
    if (p < 0.55) {
      for (let i = 0; i < 26; i++) {
        const x = noise(i * 13 + 5) * WORLD_W - cam;
        const y = 2 + noise(i * 17 + 3) * 16;
        const tw = reduced ? 1 : 0.6 + 0.4 * Math.sin(time * 2 + i);
        ctx.fillStyle = `rgba(255, 250, 230, ${((0.55 - p) / 0.55) * 0.9 * tw})`;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    // Солнце встаёт из-за деревни.
    if (p > 0.3) {
      const k = (p - 0.3) / 0.7;
      const sx = WORLD_W * 0.7 - cam;
      const sy = HORIZON + 4 - k * 26;
      ctx.fillStyle = `rgba(255, 214, 150, ${0.25 + 0.2 * k})`;
      disc(ctx, sx, sy, 11, 11, ctx.fillStyle as string);
      disc(ctx, sx, sy, 6, 6, mix('#E8604A', '#FFE29A', k));
    }
    clouds(p, time, top, reduced);
    if (p > 0.62 && !reduced) birds(p, time);
    // Окна светятся ночью, дым идёт из труб.
    for (const w of village.windows) {
      ctx.fillStyle = `rgba(242, 193, 78, ${Math.max(0, 1 - p * 1.4)})`;
      ctx.fillRect(Math.round(w.x - cam), Math.round(w.y), 2, 2);
    }
    if (!reduced) {
      for (const ch of village.chimneys) {
        for (let k = 0; k < 4; k++) {
          const age = (time * 0.6 + k * 0.25 + noise(ch.x) * 0.5) % 1;
          const x = ch.x - cam + Math.sin(time + k * 2 + ch.x) * 1.5 + age * 4;
          const y = ch.y - 4 - age * 16;
          ctx.fillStyle = `rgba(210, 214, 222, ${0.55 * (1 - age)})`;
          const r = 1 + Math.round(age * 2);
          ctx.fillRect(Math.round(x - r / 2), Math.round(y), r, r);
        }
      }
    }
  }

  /** Облака плывут медленно и светлеют к рассвету. */
  function clouds(p: number, time: number, top: string, reduced: boolean) {
    const color = mix(top, p > 0.6 ? '#FFE3C2' : '#8E99B8', 0.55);
    for (let i = 0; i < 4; i++) {
      const w = 16 + noise(i + 70) * 18;
      const span = WORLD_W + w * 2;
      const drift = reduced ? 0 : time * (0.5 + noise(i + 80));
      const x = ((noise(i + 90) * span + drift) % span) - w - cam * 0.6;
      const y = 3 + noise(i + 95) * 9;
      rect(ctx, x, y, w, 2, color);
      rect(ctx, x + w * 0.2, y - 1, w * 0.5, 1, color);
      rect(ctx, x + w * 0.15, y + 2, w * 0.6, 1, color);
    }
  }

  /** На рассвете над деревней тянется стайка птиц: крылья то вверх, то вниз. */
  function birds(p: number, time: number) {
    const span = W + 60;
    const x0 = ((time * 11) % span) - 30;
    const y0 = 12 + Math.sin(time * 0.3) * 3;
    ctx.fillStyle = `rgba(30, 30, 44, ${Math.min(1, (p - 0.62) * 5)})`;
    for (let i = 0; i < 5; i++) {
      const x = Math.round(x0 - Math.abs(i - 2) * 6);
      const y = Math.round(y0 + Math.abs(i - 2) * 3 + (i - 2));
      const up = Math.floor(time * 5 + i * 0.7) % 2 === 0;
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x - 1, y + (up ? -1 : 1), 1, 1);
      ctx.fillRect(x + 1, y + (up ? -1 : 1), 1, 1);
    }
  }

  /** Вода рябит, лёд изредка поблёскивает. */
  function shimmer(ripples: readonly Point[], pal: ScenePalette, time: number, reduced: boolean) {
    if (reduced) return;
    const period = pal.snow ? 40 : 10;
    ctx.fillStyle = pal.waterLight;
    for (let i = 0; i < ripples.length; i += 2) {
      const r = ripples[i] as Point;
      if (r.x < cam - TILE || r.x > cam + W) continue;
      const phase = Math.floor(time * 3 + noise(i) * period) % period;
      if (phase > 2) continue;
      ctx.fillRect(r.x - cam + phase, r.y + 1 + (i % 3), 2, 1);
    }
  }

  /* ---------- живое ---------- */

  const flip = new Map<Rows, Rows>();
  const facing = (rows: Rows, face: number): Rows => {
    if (face >= 0) return rows;
    let m = flip.get(rows);
    if (!m) flip.set(rows, (m = mirror(rows)));
    return m;
  };

  /** Обновляет память бегущего: куда развёрнут, когда развернулся, сколько стоит. */
  function track(m: Motion, vx: number, vy: number, face: number, time: number, dt: number) {
    const speed = Math.hypot(vx, vy);
    if (speed > 5) {
      const heading = headingOf(m.heading, vx, vy);
      if (heading !== m.heading) {
        m.heading = heading;
        m.turned = time;
      }
    } else if (m.heading !== 'side') {
      m.heading = 'side';
    }
    if (face !== m.face) {
      m.face = face;
      if (m.heading === 'side') m.turned = time;
    }
    m.still = speed < 3 ? m.still + dt : 0;
  }

  function sheepRows(s: Sheep, m: Motion, time: number, reduced: boolean): Rows {
    const speed = Math.hypot(s.vx, s.vy);
    if (!reduced && time - m.turned < TURN_TIME) return SHEEP_DOWN[0] as Rows;
    const cycle = (rate: number) => Math.floor(time * rate + s.id * 0.37);
    if (m.heading === 'up') return SHEEP_UP[cycle(4 + speed * 0.25) % 2] as Rows;
    if (m.heading === 'down') return SHEEP_DOWN[cycle(4 + speed * 0.25) % 2] as Rows;
    if (speed > 20) return SHEEP_RUN[cycle(5 + speed * 0.3) % 4] as Rows;
    if (speed > 1.2) return SHEEP_WALK[cycle(3 + speed * 0.35) % 2] ?? SHEEP_STAND;
    if (time - m.bleat < 0.45 || s.alarm > 0.5) return SHEEP_ALERT;
    // Пасётся: голова то внизу, то поднимается оглядеться.
    const look = (time * 0.4 + s.id * 0.61) % 1 < 0.18;
    return s.mode === 'graze' && !look ? SHEEP_GRAZE : SHEEP_STAND;
  }

  /** Спрайты овцы: кадров мало, а овец много — запекаем один раз на кадр анимации. */
  const sheepBaked = new Map<Rows, { body: Baked; ghost: Baked }>();
  function sheepSprite(rows: Rows): { body: Baked; ghost: Baked } {
    let hit = sheepBaked.get(rows);
    if (!hit) {
      hit = { body: bake(rows, SHEEP_PAL, SHEEP_OUTLINE), ghost: silhouette(rows, SILHOUETTE) };
      sheepBaked.set(rows, hit);
    }
    return hit;
  }

  const motionOf = (s: Sheep): Motion => {
    let m = sheepMotion[s.id];
    if (!m) sheepMotion[s.id] = m = newMotion(s.face);
    return m;
  };

  /** Сколько точек над землёй: галоп подбрасывает, вошедшая в загон подпрыгивает от радости. */
  function sheepLift(s: Sheep, m: Motion, time: number, reduced: boolean): number {
    if (reduced) return 0;
    if (time - m.hop < HOP_TIME) {
      const k = (time - m.hop) / HOP_TIME;
      return Math.round(Math.sin(k * Math.PI) * 4);
    }
    const speed = Math.hypot(s.vx, s.vy);
    if (speed <= 20 || m.heading !== 'side') return 0;
    return RUN_BOB[Math.floor(time * (5 + speed * 0.3) + s.id * 0.37) % 4] ?? 0;
  }

  const inForestStrip = (x: number, y: number) => x < 16 || x > WORLD_W - 16 || y > WORLD_H - 16;

  /** fog — насколько овца скрыта туманом: в густом тумане видна только как силуэт поверх. */
  function drawSheep(s: Sheep, time: number, fog: number, reduced: boolean) {
    const shown = Math.min(1, Math.max(0, 1 - (fog - 0.25) / 0.35));
    if (shown <= 0) return;
    const m = motionOf(s);
    const rows = facing(sheepRows(s, m, time, reduced), s.face);
    const { body, ghost } = sheepSprite(rows);
    const x = Math.round(s.x - cam - body.w / 2);
    const lift = sheepLift(s, m, time, reduced);
    const y = Math.round(s.y - body.h + 3);
    ctx.globalAlpha = shown;
    ctx.fillStyle = SHADOW;
    ctx.fillRect(x + 2, y + body.h - 2, body.w - 4, 2);
    ctx.drawImage(body.canvas, x, y - lift);
    ctx.globalAlpha = 1;
    if (inForestStrip(s.x, s.y)) {
      // Среди деревьев овцу почти не видно.
      ctx.globalAlpha = 0.55;
      ctx.drawImage(ghost.canvas, x + 1, y + 1 - lift);
      ctx.globalAlpha = 1;
    }
  }

  function dogRows(dog: Dog, jumping: boolean, time: number, reduced: boolean): Rows {
    const speed = Math.hypot(dog.vx, dog.vy);
    const m = dogMotion;
    if (dog.swim) return DOG_SWIM;
    if (jumping) return DOG_JUMP;
    if (!reduced && time - m.turned < TURN_TIME) return DOG_DOWN[0] as Rows;
    if (speed > 6) {
      const rate = 9 + speed * 0.14;
      if (m.heading === 'up') return DOG_UP[Math.floor(time * rate) % 2] as Rows;
      if (m.heading === 'down') return DOG_DOWN[Math.floor(time * rate) % 2] as Rows;
      return DOG_RUN[Math.floor(time * rate) % 4] as Rows;
    }
    if (m.still > 1.2) return DOG_SIT[Math.floor(time * 3) % 2] as Rows;
    return DOG_STAND[Math.floor(time * 4) % 2] as Rows;
  }

  function drawDog(dog: Dog, level: Level, time: number, dt: number, reduced: boolean) {
    const cell = cellAt(level.grid, cellOf(dog.x), cellOf(dog.y));
    const jumping = cell === CELL.fence || cell === CELL.bush;
    const sprite = bake(
      facing(dogRows(dog, jumping, time, reduced), dog.face),
      DOG_PAL,
      DOG_OUTLINE,
    );
    const x = Math.round(dog.x - cam - sprite.w / 2);
    // Над забором собака плавно поднимается и опускается, а не прыгает на 4 точки разом.
    const want = jumping ? 4 : 0;
    dogLift = reduced ? want : dogLift + (want - dogLift) * Math.min(1, dt * 18);
    const y = Math.round(dog.y - sprite.h + 3 - dogLift + (dog.swim ? 3 : 0));
    // Светлое пятно под собакой: её видно и на тёмной траве, и в сумерках.
    disc(ctx, dog.x - cam, dog.y + 1, 9, 3, 'rgba(255, 246, 222, 0.22)');
    if (dog.swim) {
      const k = Math.floor(time * 6) % 2;
      rect(ctx, x - 1 + k, dog.y + 1, sprite.w + 2, 1, 'rgba(230, 240, 250, 0.8)');
    } else {
      disc(ctx, dog.x - cam, dog.y + 1, 5, 1.5, SHADOW);
    }
    ctx.drawImage(sprite.canvas, x, y);
  }

  /* ---------- пыль и следы ---------- */

  const spawn = (
    x: number,
    y: number,
    color: string,
    vx: number,
    vy: number,
    life: number,
    size = 1,
  ) => {
    spawned += 1;
    motes.push({ x, y, vx, vy, age: 0, life, color, size });
  };

  /** Пыль из-под лап, рябь в ручье, следы на снегу. Рисуется под туманом: ничего не выдаёт. */
  function kickUp(run: Run, level: Level, pal: ScenePalette, dt: number) {
    const dog = run.dog;
    const m = dogMotion;
    const speed = Math.hypot(dog.vx, dog.vy);
    const jolt = Math.hypot(dog.vx - m.vx, dog.vy - m.vy);
    if (jolt > 28 && speed > 12 && !dog.swim) {
      // Резкий поворот или рывок — облачко пыли.
      for (let i = 0; i < 4; i++) {
        const a = noise(spawned * 7 + i) * Math.PI * 2;
        const v = 6 + noise(spawned * 3 + i) * 10;
        spawn(dog.x, dog.y + 2, pal.dust, Math.cos(a) * v, Math.sin(a) * v * 0.5 - 3, 0.4, 2);
      }
    }
    m.vx = dog.vx;
    m.vy = dog.vy;
    m.trail += speed * dt;
    if (m.trail > 8) {
      m.trail = 0;
      if (dog.swim) {
        spawn(dog.x - dog.face * 6, dog.y + 2, '#E6F0FA', -dog.face * 3, 0, 0.5, 2);
      } else {
        if (speed > 30) {
          spawn(dog.x - dog.face * 4, dog.y + 2, pal.dust, -dog.vx * 0.12, -5, 0.35, 2);
        }
        if (pal.snow) footprint(dog.x, dog.y + 3, 3.5);
      }
    }
    for (const s of run.sheep) {
      if (s.status === 'lost') continue;
      const sm = motionOf(s);
      const sp = Math.hypot(s.vx, s.vy);
      sm.trail += sp * dt;
      if (sm.trail <= 14) continue;
      sm.trail = 0;
      const seen = s.status === 'penned' || fogAt(level, dog, run.t, s.x, s.y) < 0.5;
      if (!seen) continue;
      if (pal.snow) footprint(s.x, s.y + 3, 3);
      if (sp > 22) spawn(s.x - s.face * 4, s.y + 2, pal.dust, -s.vx * 0.1, -3, 0.3);
    }
    if (motes.length > MAX_MOTES) motes = motes.slice(-MAX_MOTES);
    if (prints.length > MAX_PRINTS) prints = prints.slice(-MAX_PRINTS);
  }

  const footprint = (x: number, y: number, life: number) => {
    prints.push({ x, y, vx: 0, vy: 0, age: 0, life, color: '', size: 1 });
  };

  function drawTrails(pal: ScenePalette, dt: number) {
    prints = prints.filter((f) => (f.age += dt) < f.life);
    ctx.fillStyle = pal.print;
    for (const f of prints) {
      ctx.globalAlpha = Math.min(1, (1 - f.age / f.life) * 1.5);
      ctx.fillRect(Math.round(f.x - cam), Math.round(f.y), 2, 1);
    }
    motes = motes.filter((f) => (f.age += dt) < f.life);
    for (const f of motes) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      ctx.globalAlpha = 0.85 * (1 - f.age / f.life);
      ctx.fillStyle = f.color;
      ctx.fillRect(Math.round(f.x - cam), Math.round(f.y), f.size, f.size);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- погода ---------- */

  /** Положение пылинки в пределах экрана по кругу; камера сдвигает её, как и всё в мире. */
  const wrap = (v: number, size: number) => ((v % size) + size) % size;

  /**
   * Погода по временам года — поверх тумана: весной лепестки, летом светлячки ночью и пыльца
   * к утру, осенью листья и порывы, зимой снег с метелью. С reduced-motion время стоит.
   */
  function weather(pal: ScenePalette, season: Level['spec']['season'], p: number, time: number) {
    const gust = 0.6 + 0.4 * Math.sin(time * 0.31) * Math.sin(time * 0.13 + 1);
    if (season === 'summer' && p < 0.6) {
      for (let i = 0; i < 16; i++) {
        const glow = Math.sin(time * (1.2 + noise(i) * 1.5) + i * 2.1);
        if (glow < 0.2) continue;
        const x = wrap(noise(i + 7) * WORLD_W + Math.sin(time * 0.4 + i) * 10 - cam, W);
        const y = HORIZON + noise(i + 9) * (WORLD_H - HORIZON) + Math.cos(time * 0.5 + i) * 6;
        ctx.fillStyle = glow > 0.7 ? '#F4F7A0' : '#B8C860';
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      return;
    }
    const big = season === 'autumn' || season === 'spring';
    const n = season === 'winter' ? 46 : season === 'autumn' ? 16 : season === 'spring' ? 18 : 12;
    const span = WORLD_H + 8;
    for (let i = 0; i < n; i++) {
      const fall =
        season === 'winter'
          ? 12 + noise(i) * 18
          : season === 'summer'
            ? 2 + noise(i) * 3
            : 8 + noise(i) * 9;
      const windK = season === 'winter' ? 26 : season === 'autumn' ? 22 : 9;
      const drift = (6 + noise(i + 50) * 10 + gust * windK) * time;
      const x = wrap(noise(i + 100) * W * 1.5 - drift - cam, W);
      const y = wrap(noise(i + 200) * span + time * fall, span) - 4;
      const sway = Math.sin(time * 1.4 + i) * (big ? 4 : 2);
      const color = pal.air[i % pal.air.length] ?? '#FFFFFF';
      const wide = big ? Math.floor(time * 4 + i) % 2 === 0 : i % 3 === 0;
      rect(ctx, x + sway, y, wide ? 2 : 1, big && !wide ? 2 : 1, color);
    }
  }

  function lantern(level: Level, time: number, reduced: boolean) {
    const l = level.pen.lantern;
    const frame = reduced ? 0 : Math.floor(time * 5 + noise(Math.floor(time * 5)) * 2) % 2;
    const sprite = bake(LANTERN[frame] ?? (LANTERN[0] as Rows), LANTERN_PAL, '#1E1614');
    ctx.drawImage(
      sprite.canvas,
      Math.round(l.x - cam - sprite.w / 2),
      Math.round(l.y - sprite.h + 2),
    );
  }

  /* ---------- туман ---------- */

  function drawFog(level: Level, run: Run, p: number, time: number) {
    const density = fogDensity(level, run.t);
    if (density <= 0.01) return;
    const fx0 = Math.floor(cam / FOG_PX);
    const w = Math.ceil(W / FOG_PX) + 1;
    const h = WORLD_H / FOG_PX;
    if (!fogImage || fogImage.width !== w) {
      fog.width = w;
      fog.height = h;
      fogImage = fogCtx.createImageData(w, h);
    }
    const data = fogImage.data;
    const r = clearRadius(level, run.t);
    const r0 = r * 0.55;
    const light = lanternLight(level);
    const l0 = light.r0;
    const dx0 = run.dog.x;
    const dy0 = run.dog.y;
    const [cr, cg, cb] = fogColor(p);
    const driftX = Math.floor(time * 1.6);
    const driftY = Math.floor(time * 0.5);
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let fy = 0; fy < h; fy++) {
      const y = fy * FOG_PX + 1;
      const thin = y < HORIZON ? 0.5 : 1;
      for (let i = 0; i < w; i++) {
        const fx = fx0 + i;
        const x = fx * FOG_PX + 1;
        const dd = Math.hypot(x - dx0, y - dy0);
        let k = dd <= r0 ? 0 : dd >= r ? 1 : smooth((dd - r0) / (r - r0));
        if (k > 0) {
          const dl = Math.hypot(x - light.x, y - light.y);
          k *= dl <= l0 ? 0 : dl >= light.r ? 1 : smooth((dl - l0) / (light.r - l0));
        }
        let a = 0;
        if (k > 0) {
          const n = wisps[((fy + driftY) & 63) * NOISE_N + ((fx + driftX) & 63)] ?? 0;
          a = Math.min(1, density * k * thin * (0.72 + 0.4 * n));
        }
        // Упорядоченный дизеринг в 16 ступеней: пиксельный туман без «ступенек» градиента.
        const step = Math.floor(a * 16 + (BAYER[(fy & 3) * 4 + (i & 3)] ?? 0));
        const o = (fy * w + i) * 4;
        data[o] = cr;
        data[o + 1] = cg;
        data[o + 2] = cb;
        data[o + 3] = Math.min(255, step * 16);
      }
    }
    fogCtx.putImageData(fogImage, 0, 0);
    ctx.drawImage(fog, 0, 0, w, h, fx0 * FOG_PX - cam, 0, w * FOG_PX, h * FOG_PX);
  }

  /** Силуэты овец в тумане: чем гуще туман и ближе собака, тем различимее. */
  function silhouettes(level: Level, run: Run, time: number, reduced: boolean) {
    for (const s of run.sheep) {
      if (s.status !== 'free') continue;
      const f = fogAt(level, run.dog, run.t, s.x, s.y);
      if (f < 0.2) continue;
      const vis = silhouetteAt(level, run.dog, run.t, s.x, s.y);
      if (vis <= 0.02) continue;
      const { ghost } = sheepSprite(facing(sheepRows(s, motionOf(s), time, reduced), s.face));
      ctx.globalAlpha = Math.min(0.85, f * 1.15) * vis * 0.8;
      ctx.drawImage(
        ghost.canvas,
        Math.round(s.x - cam - ghost.w / 2),
        Math.round(s.y - ghost.h + 3),
      );
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- эффекты поверх тумана ---------- */

  function drawEffects(time: number, reduced: boolean) {
    effects = effects.filter((e) => time - e.at < LIFE[e.kind]);
    for (const e of effects) {
      const age = time - e.at;
      const k = age / LIFE[e.kind];
      const sx = e.x - cam;
      if (e.kind === 'bleat') {
        // За краем экрана — метка у края: слышно, с какой стороны блеют.
        const x = Math.min(W - 3, Math.max(3, sx));
        const color = e.warm ? '242, 209, 107' : '244, 240, 230';
        ctx.globalAlpha = 1 - k;
        for (const r of reduced ? [4] : [2 + age * 7, 5 + age * 7]) {
          ring(x, e.y - 6, r, `rgb(${color})`, true);
        }
        ctx.globalAlpha = 1;
      } else if (e.kind === 'whistle') {
        ctx.globalAlpha = 1 - k;
        ring(sx, e.y, 4 + (WHISTLE_R - 4) * (reduced ? 1 : k), '#FFF6DA', true);
        ctx.globalAlpha = 1;
      } else if (e.kind === 'penned') {
        const c = '#F2D16B';
        const d = 2 + Math.round(k * 3);
        rect(ctx, sx, e.y - 8 - d, 1, 1, c);
        rect(ctx, sx - d, e.y - 8, 1, 1, c);
        rect(ctx, sx + d, e.y - 8, 1, 1, c);
        rect(ctx, sx, e.y - 8, 1, 1, '#FFFFFF');
      } else {
        if (Math.floor(age * 6) % 2 === 1 && e.kind === 'stray') continue;
        const x = Math.round(Math.min(W - 4, Math.max(2, sx)));
        const y = Math.round(e.y - 14 - k * 4);
        const color = e.kind === 'stray' ? '#E8604A' : '#C9CDD6';
        if (e.kind === 'stray') {
          rect(ctx, x, y, 2, 5, color);
          rect(ctx, x, y + 6, 2, 2, color);
        } else {
          rect(ctx, x, y, 4, 1, color);
          rect(ctx, x + 3, y + 1, 1, 2, color);
          rect(ctx, x + 1, y + 3, 2, 1, color);
          rect(ctx, x + 1, y + 4, 1, 1, color);
          rect(ctx, x + 1, y + 6, 1, 1, color);
        }
      }
    }
  }

  /** Загон за краем экрана — стрелка с огоньком фонаря у края. */
  function penArrow(level: Level) {
    const l = lanternLight(level);
    const sx = l.x - cam;
    if (sx >= 4 && sx <= W - 4) return;
    const left = sx < 4;
    const x = left ? 3 : W - 4;
    const y = Math.round(Math.min(WORLD_H - 12, Math.max(HORIZON + 8, l.y)));
    ctx.fillStyle = '#1E1614';
    for (let i = -4; i <= 4; i++)
      ctx.fillRect(x + (left ? Math.abs(i) : -Math.abs(i)) - 1, y + i, 3, 1);
    ctx.fillStyle = '#F2C14E';
    for (let i = -3; i <= 3; i++)
      ctx.fillRect(x + (left ? Math.abs(i) : -Math.abs(i)), y + i, 1, 1);
  }

  return {
    get width() {
      return W;
    },
    get camera() {
      return cam;
    },
    resize(width: number) {
      W = width;
      canvas.width = W;
      canvas.height = WORLD_H;
      ctx.imageSmoothingEnabled = false;
      camReady = false;
    },
    /** Точка экрана (clientX, clientY) → точка луга. */
    toWorld(clientX: number, clientY: number, box: DOMRect): Point {
      return {
        x: cam + ((clientX - box.left) / Math.max(1, box.width)) * W,
        y: ((clientY - box.top) / Math.max(1, box.height)) * WORLD_H,
      };
    },
    /** События шага → круги, искры и метки поверх тумана. */
    events(events: readonly HerdEvent[]) {
      for (const e of events) {
        const at = lastTime;
        if (e.type === 'bleat') {
          effects.push({ kind: 'bleat', x: e.x, y: e.y, at, warm: e.lonely });
          const m = sheepMotion[e.id];
          if (m) m.bleat = at;
        } else if (e.type === 'whistle')
          effects.push({ kind: 'whistle', x: e.x, y: e.y, at, warm: false });
        else if (e.type === 'penned') {
          effects.push({ kind: 'penned', x: e.x, y: e.y, at, warm: false });
          const m = sheepMotion[e.id];
          if (m) m.hop = at;
        } else if (e.type === 'stray')
          effects.push({ kind: 'stray', x: e.x, y: e.y, at, warm: false });
        else if (e.type === 'lost') effects.push({ kind: 'lost', x: e.x, y: e.y, at, warm: false });
      }
      if (effects.length > 60) effects = effects.slice(-60);
    },
    draw({ level, run, time, demo }: Frame) {
      const reduced = opts.reducedMotion();
      const dt = Math.min(0.1, Math.max(0, time - lastTime));
      lastTime = time;
      const key = `${level.seed}:${level.spec.number}:${level.spec.season}`;
      if (!background || background.key !== key) {
        background = { key, ...buildBackground(level) };
        camReady = false;
        effects = [];
      }
      // Новый забег: вид забывает, кто куда бежал, и убирает пыль и следы.
      if (run.t < lastRunTime || run.status === 'ready') {
        sheepMotion = [];
        dogMotion = newMotion(run.dog.face);
        dogLift = 0;
        motes = [];
        prints = [];
      }
      lastRunTime = run.t;
      const pal = PALETTES[level.spec.season];
      const p = dawnOf(level, run.t);
      const want = Math.min(WORLD_W - W, Math.max(0, run.dog.x - W / 2));
      cam = camReady ? cam + (want - cam) * Math.min(1, dt * 5) : want;
      if (Math.abs(want - cam) < 0.3) cam = want;
      camReady = true;
      cam = Math.round(cam);

      ctx.clearRect(0, 0, W, WORLD_H);
      sky(p, time, background.village, reduced);
      ctx.drawImage(background.canvas, cam, 0, W, WORLD_H, 0, 0, W, WORLD_H);
      shimmer(background.ripples, pal, time, reduced);
      // Ночь: луг темнее, к рассвету светлеет. Овцы и собака рисуются поверх — их видно.
      const night = 0.3 * Math.pow(1 - p, 1.4);
      if (night > 0.01) {
        ctx.fillStyle = `rgba(12, 18, 40, ${night})`;
        ctx.fillRect(0, 0, W, WORLD_H);
      }
      lantern(level, time, reduced);
      track(dogMotion, run.dog.vx, run.dog.vy, run.dog.face, time, dt);
      for (const s of run.sheep) {
        if (s.status !== 'lost') track(motionOf(s), s.vx, s.vy, s.face, time, dt);
      }
      if (!reduced) {
        kickUp(run, level, pal, dt);
        drawTrails(pal, dt);
      }
      const bodies: { y: number; draw: () => void }[] = [];
      for (const s of run.sheep) {
        if (s.status === 'lost') continue;
        if (s.x < cam - 12 || s.x > cam + W + 12) continue;
        const fog = s.status === 'free' ? fogAt(level, run.dog, run.t, s.x, s.y) : 0;
        bodies.push({ y: s.y, draw: () => drawSheep(s, time, fog, reduced) });
      }
      bodies.push({
        y: run.dog.y + 0.5,
        draw: () => drawDog(run.dog, level, time, dt, reduced),
      });
      bodies.sort((a, b) => a.y - b.y);
      for (const b of bodies) b.draw();
      // Свет фонаря: тёплый круг вокруг загона.
      const l = lanternLight(level);
      const glow = ctx.createRadialGradient(l.x - cam, l.y, 2, l.x - cam, l.y, l.r);
      glow.addColorStop(0, `rgba(255, 214, 140, ${0.22 * (1 - p * 0.7)})`);
      glow.addColorStop(1, 'rgba(255, 214, 140, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(Math.round(l.x - cam - l.r), Math.round(l.y - l.r), l.r * 2, l.r * 2);
      drawFog(level, run, p, reduced ? 0 : time);
      silhouettes(level, run, time, reduced);
      weather(pal, level.spec.season, p, reduced ? 0 : time);
      drawEffects(time, reduced);
      if (!demo) penArrow(level);
    },
  };
}

export type Renderer = ReturnType<typeof createRenderer>;
