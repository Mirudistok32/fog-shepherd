/**
 * Уровень: луг между деревней и лесом, загон с воротами и фонарём, заборы, кусты, ручей
 * с мостиками и разбредшееся стадо. Всё строится из сида: уровень одинаков при каждом
 * заходе, а тест проверяет сотни сидов — загон достижим, овцы не стоят в препятствиях.
 */

import { penetration } from './collision';
import { CELL, center, emptyGrid, type Grid, inside, setCell } from './grid';
import { distanceField, navAt, passable } from './navigation';
import { between, hashString, intBetween, mulberry32, type Rng } from './random';
import type { Season } from './season';
import { COLS, FOREST, HORIZON, MEADOW, ROWS, SHEEP_R, TILE, WORLD_H, WORLD_W } from './world';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = 'top' | 'bottom' | 'left' | 'right';

export interface Pen {
  /** Внутренность загона: овца загнана, когда целиком внутри. */
  inner: Rect;
  /** Стенки — по клетке вокруг inner, в одной из них проём ворот. */
  side: Side;
  gate: Rect;
  /** Середина проёма и нормаль наружу. */
  mouth: Point;
  out: Point;
  /** Фонарь на столбе у ворот: его свет пробивает туман. */
  lantern: Point;
}

/** Прямой отрезок забора толщиной в клетку. */
export type Fence = Rect;

export interface Bush {
  x: number;
  y: number;
  r: number;
}

export interface Stream {
  axis: 'vertical' | 'horizontal';
  /** Середина русла: для вертикального — x в каждой строке клеток, для горизонтального — y в каждом столбце. */
  center: readonly number[];
  width: number;
  bridges: readonly Rect[];
}

export interface Decor {
  kind: 'tuft' | 'flower' | 'stone';
  x: number;
  y: number;
  /** Вариант рисунка 0–1. */
  v: number;
}

export interface Tree {
  kind: 'fir' | 'round';
  x: number;
  y: number;
  size: number;
}

export interface House {
  kind: 'izba' | 'church' | 'barn';
  x: number;
  w: number;
  h: number;
}

export interface LevelSpec {
  /** 0 — тренировка, дальше — уровни кампании. */
  number: number;
  season: Season;
  sheep: number;
  /** На сколько кучек разбрелось стадо и сколько овец отбилось и бредёт к лесу. */
  groups: number;
  strays: number;
  fences: number;
  bushes: number;
  stream: boolean;
  /** Плотность тумана в начале 0–1 и радиус ясного круга вокруг собаки. */
  fog: number;
  clear: number;
  /** Секунд до рассвета и норматив трёх звёзд. */
  time: number;
  par: number;
}

export interface Level {
  spec: LevelSpec;
  seedText: string;
  seed: number;
  grid: Grid;
  pen: Pen;
  fences: readonly Fence[];
  bushes: readonly Bush[];
  stream: Stream | null;
  sheep: readonly Point[];
  /** Номера овец, которые отбились от стада: одни бредут к лесу. */
  wanderers: readonly number[];
  dog: Point;
  /** Расстояние до загона по клеткам (navigation.ts). */
  nav: Float64Array;
  decor: readonly Decor[];
  trees: readonly Tree[];
  houses: readonly House[];
}

/* ---------- кампания ---------- */

export const TRAINING: LevelSpec = {
  number: 0,
  season: 'spring',
  sheep: 3,
  groups: 1,
  strays: 0,
  fences: 0,
  bushes: 0,
  stream: false,
  fog: 0,
  clear: 60,
  time: 90,
  par: 30,
};

/**
 * Сложность растёт: больше овец, гуще туман и уже ясный круг, меньше запаса времени на овцу
 * (с 22 с на первом уровне до 5,6 с на двенадцатом). До рассвета — примерное время бота
 * (25 с + 3 с на овцу) × запас от 3 до 1,55; норматив трёх звёзд — время бота на этом
 * уровне × 1,5 (tests/unit/bot.test.ts, README → «Баланс»).
 */
type Row = [
  number: number,
  season: Season,
  sheep: number,
  groups: number,
  strays: number,
  fences: number,
  bushes: number,
  stream: boolean,
  fog: number,
  clear: number,
  time: number,
  par: number,
];

// Уровень, сезон, овец, кучек, одиночек, заборов, кустов, ручей, туман, ясно, до рассвета, норматив.
const TABLE: readonly Row[] = [
  [1, 'spring', 6, 1, 0, 1, 2, false, 0.55, 56, 130, 35],
  [2, 'spring', 8, 2, 0, 2, 2, false, 0.62, 54, 140, 40],
  [3, 'spring', 10, 2, 1, 2, 3, true, 0.68, 52, 150, 85],
  [4, 'summer', 12, 2, 1, 2, 3, false, 0.72, 50, 160, 75],
  [5, 'summer', 15, 3, 1, 3, 3, true, 0.76, 48, 175, 65],
  [6, 'summer', 18, 3, 1, 3, 4, true, 0.8, 46, 185, 120],
  [7, 'autumn', 21, 3, 2, 3, 4, false, 0.83, 44, 195, 135],
  [8, 'autumn', 24, 3, 2, 4, 4, true, 0.86, 42, 200, 165],
  [9, 'autumn', 27, 4, 2, 4, 5, true, 0.88, 40, 205, 155],
  [10, 'winter', 30, 4, 2, 4, 5, true, 0.9, 38, 210, 160],
  [11, 'winter', 34, 4, 3, 4, 5, true, 0.92, 36, 215, 120],
  [12, 'winter', 40, 4, 3, 5, 6, true, 0.95, 34, 225, 150],
];

export const CAMPAIGN: readonly LevelSpec[] = TABLE.map(
  ([number, season, sheep, groups, strays, fences, bushes, stream, fog, clear, time, par]) => ({
    number,
    season,
    sheep,
    groups,
    strays,
    fences,
    bushes,
    stream,
    fog,
    clear,
    time,
    par,
  }),
);

export const LEVEL_COUNT = CAMPAIGN.length;

export function specOf(n: number): LevelSpec {
  if (n === 0) return TRAINING;
  const spec = CAMPAIGN[n - 1];
  if (!spec) throw new Error(`Нет уровня ${n}`);
  return spec;
}

/** Сид уровня кампании. Смена генератора меняет уровни и рекорды — тогда v2 и запись в decisions.md. */
export const levelSeed = (n: number): string => `level-${n}:v1`;

/** Уровень кампании; seedText — свой сид для проверки или показа (?seed=…). */
export function campaignLevel(n: number, seedText?: string): Level {
  if (n === 0) return trainingLevel();
  return generateLevel(specOf(n), seedText ?? levelSeed(n));
}

/* ---------- построение ---------- */

const TOP_ROWS = HORIZON / TILE;
const FOREST_CELLS = FOREST / TILE;

interface Builder {
  rng: Rng;
  grid: Grid;
  /** Клетки, где нельзя ставить заборы и кусты: загон, подход к воротам, мостики. */
  reserved: Uint8Array;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function reserve(b: Builder, c0: number, r0: number, c1: number, r1: number) {
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++)
      if (inside(b.grid, col, row)) b.reserved[row * COLS + col] = 1;
}

/** Все клетки прямоугольника — трава, не зарезервированы и не в лесу. */
function clearArea(b: Builder, c0: number, r0: number, c1: number, r1: number, own?: Set<number>) {
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!inside(b.grid, col, row)) return false;
      const i = row * COLS + col;
      if (own?.has(i)) continue;
      if (b.grid.cells[i] !== CELL.grass || b.reserved[i]) return false;
    }
  }
  return true;
}

/** Расстояние от точки до кромки леса (слева, справа, снизу). */
export const forestDistance = (p: Point): number =>
  Math.min(p.x - MEADOW.x0, MEADOW.x1 - p.x, MEADOW.y1 - p.y);

export const inForest = (p: Point): boolean =>
  p.x < MEADOW.x0 || p.x > MEADOW.x1 || p.y > MEADOW.y1;

/** С какой стороны ручья точка: -1 или 1 (0 — ручья нет). */
export function streamSide(s: Stream | null, p: Point): number {
  if (!s) return 0;
  if (s.axis === 'vertical') {
    const c = s.center[clamp(Math.floor(p.y / TILE), 0, ROWS - 1)] ?? 0;
    return p.x < c ? -1 : 1;
  }
  const c = s.center[clamp(Math.floor(p.x / TILE), 0, COLS - 1)] ?? 0;
  return p.y < c ? -1 : 1;
}

function addStream(b: Builder): Stream {
  const vertical = b.rng() < 0.6;
  const width = 12;
  const amp = between(b.rng, 4, vertical ? 14 : 10);
  const freq = between(b.rng, 0.018, 0.034);
  const phase = b.rng() * Math.PI * 2;
  const base = vertical
    ? between(b.rng, 0.36, 0.64) * WORLD_W
    : between(b.rng, 0.5, 0.66) * WORLD_H;
  const n = vertical ? ROWS : COLS;
  const line: number[] = [];
  for (let i = 0; i < n; i++) line.push(base + amp * Math.sin(center(i) * freq + phase));
  const water = (col: number, row: number) =>
    vertical
      ? Math.abs(center(col) - (line[row] ?? 0)) <= width / 2
      : Math.abs(center(row) - (line[col] ?? 0)) <= width / 2;
  for (let row = TOP_ROWS; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) if (water(col, row)) setCell(b.grid, col, row, CELL.water);

  // Мостики: полоса в 4 клетки поперёк русла, далеко от леса и от плетня.
  const along: number[] = [];
  const count = b.rng() < 0.4 ? 2 : 1;
  const lo = vertical ? TOP_ROWS + 5 : FOREST_CELLS + 8;
  const hi = vertical ? ROWS - FOREST_CELLS - 9 : COLS - FOREST_CELLS - 12;
  for (let tries = 0; along.length < count && tries < 40; tries++) {
    const at = intBetween(b.rng, lo, hi);
    if (along.every((a) => Math.abs(a - at) >= 14)) along.push(at);
  }
  const bridges: Rect[] = [];
  for (const at of along.sort((p, q) => p - q)) {
    let min = Infinity;
    let max = -Infinity;
    for (let k = at; k < at + 4; k++) {
      for (let j = 0; j < (vertical ? COLS : ROWS); j++) {
        const [col, row] = vertical ? [j, k] : [k, j];
        if (!water(col, row)) continue;
        setCell(b.grid, col, row, CELL.bridge);
        min = Math.min(min, j);
        max = Math.max(max, j);
      }
    }
    if (vertical) {
      bridges.push({ x: min * TILE - 2, y: at * TILE, w: (max - min + 1) * TILE + 4, h: 4 * TILE });
      reserve(b, min - 5, at - 2, max + 5, at + 5);
    } else {
      bridges.push({ x: at * TILE, y: min * TILE - 2, w: 4 * TILE, h: (max - min + 1) * TILE + 4 });
      reserve(b, at - 2, min - 5, at + 5, max + 5);
    }
  }
  return { axis: vertical ? 'vertical' : 'horizontal', center: line, width, bridges };
}

export interface PenPlan {
  col0: number;
  row0: number;
  /** Внутренний размер в клетках. */
  iw: number;
  ih: number;
  side: Side;
  /** Первая клетка проёма вдоль стороны и ширина проёма в клетках. */
  from: number;
  gw: number;
}

const OUT: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Ставит стенки и ворота загона на сетку. */
function buildPen(grid: Grid, p: PenPlan): Pen {
  const c1 = p.col0 + p.iw + 1;
  const r1 = p.row0 + p.ih + 1;
  for (let col = p.col0; col <= c1; col++) {
    setCell(grid, col, p.row0, CELL.fence);
    setCell(grid, col, r1, CELL.fence);
  }
  for (let row = p.row0; row <= r1; row++) {
    setCell(grid, p.col0, row, CELL.fence);
    setCell(grid, c1, row, CELL.fence);
  }
  const horizontal = p.side === 'top' || p.side === 'bottom';
  for (let k = p.from; k < p.from + p.gw; k++) {
    if (p.side === 'top') setCell(grid, k, p.row0, CELL.grass);
    if (p.side === 'bottom') setCell(grid, k, r1, CELL.grass);
    if (p.side === 'left') setCell(grid, p.col0, k, CELL.grass);
    if (p.side === 'right') setCell(grid, c1, k, CELL.grass);
  }
  const wallCol = p.side === 'left' ? p.col0 : c1;
  const wallRow = p.side === 'top' ? p.row0 : r1;
  const gate: Rect = horizontal
    ? { x: p.from * TILE, y: wallRow * TILE, w: p.gw * TILE, h: TILE }
    : { x: wallCol * TILE, y: p.from * TILE, w: TILE, h: p.gw * TILE };
  const out = OUT[p.side];
  const mouth = { x: gate.x + gate.w / 2, y: gate.y + gate.h / 2 };
  // Фонарь — на столбе справа (или ниже) от проёма, чуть снаружи.
  const lantern = horizontal
    ? { x: gate.x + gate.w + 2, y: mouth.y + out.y * 3 }
    : { x: mouth.x + out.x * 3, y: gate.y + gate.h + 2 };
  return {
    inner: { x: (p.col0 + 1) * TILE, y: (p.row0 + 1) * TILE, w: p.iw * TILE, h: p.ih * TILE },
    side: p.side,
    gate,
    mouth,
    out,
    lantern,
  };
}

/** Цели пути: проходимые клетки внутри загона. */
export function penGoals(grid: Grid, pen: Pen): number[] {
  const goals: number[] = [];
  const c0 = pen.inner.x / TILE;
  const r0 = pen.inner.y / TILE;
  for (let row = r0; row < r0 + pen.inner.h / TILE; row++)
    for (let col = c0; col < c0 + pen.inner.w / TILE; col++)
      if (passable(grid, col, row)) goals.push(row * COLS + col);
  return goals;
}

function addPen(b: Builder, spec: LevelSpec, stream: Stream | null): Pen | null {
  const area = spec.sheep * 90;
  const w = clamp(ceilTo(Math.sqrt(area * 1.3), TILE), 24, 72);
  const h = clamp(ceilTo(area / w, TILE), 20, 56);
  const iw = w / TILE;
  const ih = h / TILE;
  const gw = spec.sheep > 15 ? 6 : 5;
  const minCol = FOREST_CELLS + 5;
  const maxCol = COLS - FOREST_CELLS - 5 - (iw + 2);
  const maxRow = ROWS - FOREST_CELLS - 5 - (ih + 2);
  for (let tries = 0; tries < 80; tries++) {
    const touchTop = b.rng() < 0.45;
    const col0 = intBetween(b.rng, minCol, maxCol);
    const row0 = touchTop ? TOP_ROWS : intBetween(b.rng, TOP_ROWS + 5, maxRow);
    const c1 = col0 + iw + 1;
    const r1 = row0 + ih + 1;
    if (!clearArea(b, col0 - 4, touchTop ? row0 : row0 - 4, c1 + 4, r1 + 4)) continue;
    // Ворота — к середине своей части луга.
    const cx = ((col0 + c1 + 1) * TILE) / 2;
    const cy = ((row0 + r1 + 1) * TILE) / 2;
    let tx = (MEADOW.x0 + MEADOW.x1) / 2;
    let ty = (MEADOW.y0 + MEADOW.y1) / 2;
    if (stream) {
      const side = streamSide(stream, { x: cx, y: cy });
      if (stream.axis === 'vertical') {
        const c = stream.center[Math.floor(cy / TILE)] ?? tx;
        tx = side < 0 ? (MEADOW.x0 + c) / 2 : (c + MEADOW.x1) / 2;
      } else {
        const c = stream.center[Math.floor(cx / TILE)] ?? ty;
        ty = side < 0 ? (MEADOW.y0 + c) / 2 : (c + MEADOW.y1) / 2;
      }
    }
    const dx = (tx - cx) / w;
    const dy = (ty - cy) / h;
    const side: Side = touchTop
      ? 'bottom'
      : Math.abs(dx) > Math.abs(dy)
        ? dx < 0
          ? 'left'
          : 'right'
        : dy < 0
          ? 'top'
          : 'bottom';
    const horizontal = side === 'top' || side === 'bottom';
    const span = horizontal ? iw : ih;
    if (span < gw) continue;
    const start = (horizontal ? col0 : row0) + 1;
    const from = start + Math.floor((span - gw) / 2) + intBetween(b.rng, -1, 1);
    const plan: PenPlan = {
      col0,
      row0,
      iw,
      ih,
      side,
      from: clamp(from, start, start + span - gw),
      gw,
    };
    // Перед воротами — свободный подход в 7 клеток.
    const lane =
      side === 'bottom'
        ? [plan.from - 2, r1 + 1, plan.from + gw + 1, r1 + 7]
        : side === 'top'
          ? [plan.from - 2, row0 - 7, plan.from + gw + 1, row0 - 1]
          : side === 'left'
            ? [col0 - 7, plan.from - 2, col0 - 1, plan.from + gw + 1]
            : [c1 + 1, plan.from - 2, c1 + 7, plan.from + gw + 1];
    const [l0, l1, l2, l3] = lane as [number, number, number, number];
    if (!clearArea(b, l0, l1, l2, l3)) continue;
    if (
      l1 < TOP_ROWS ||
      l3 >= ROWS - FOREST_CELLS ||
      l0 < FOREST_CELLS ||
      l2 >= COLS - FOREST_CELLS
    )
      continue;
    const pen = buildPen(b.grid, plan);
    reserve(b, col0 - 2, row0 - 2, c1 + 2, r1 + 2);
    reserve(b, l0 - 1, l1 - 1, l2 + 1, l3 + 1);
    return pen;
  }
  return null;
}

/** Забор: прямой отрезок, иногда с поворотом — получается угол, где овца может застрять. */
function addFence(b: Builder): Fence[] | null {
  for (let tries = 0; tries < 60; tries++) {
    const horizontal = b.rng() < 0.5;
    const len = intBetween(b.rng, 5, 12);
    const col = intBetween(
      b.rng,
      FOREST_CELLS + 3,
      COLS - FOREST_CELLS - 4 - (horizontal ? len : 1),
    );
    const row = intBetween(b.rng, TOP_ROWS + 4, ROWS - FOREST_CELLS - 4 - (horizontal ? 1 : len));
    const pieces: Rect[] = [
      horizontal
        ? { x: col * TILE, y: row * TILE, w: len * TILE, h: TILE }
        : { x: col * TILE, y: row * TILE, w: TILE, h: len * TILE },
    ];
    if (b.rng() < 0.4) {
      // Угол: второй отрезок от одного из концов, перпендикулярно.
      const len2 = intBetween(b.rng, 3, 6);
      const atEnd = b.rng() < 0.5;
      const dir = b.rng() < 0.5 ? -1 : 1;
      if (horizontal) {
        const c = atEnd ? col + len - 1 : col;
        const r = dir < 0 ? row - len2 : row + 1;
        pieces.push({ x: c * TILE, y: r * TILE, w: TILE, h: len2 * TILE });
      } else {
        const r = atEnd ? row + len - 1 : row;
        const c = dir < 0 ? col - len2 : col + 1;
        pieces.push({ x: c * TILE, y: r * TILE, w: len2 * TILE, h: TILE });
      }
    }
    const own = new Set<number>();
    for (const p of pieces)
      for (let r = p.y / TILE; r < (p.y + p.h) / TILE; r++)
        for (let c = p.x / TILE; c < (p.x + p.w) / TILE; c++) own.add(r * COLS + c);
    let ok = true;
    for (const i of own) {
      const c = i % COLS;
      const r = (i - c) / COLS;
      if (
        c < FOREST_CELLS + 2 ||
        c >= COLS - FOREST_CELLS - 2 ||
        r < TOP_ROWS + 3 ||
        r >= ROWS - FOREST_CELLS - 2 ||
        !clearArea(b, c - 3, r - 3, c + 3, r + 3, own)
      ) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (const i of own) b.grid.cells[i] = CELL.fence;
    return pieces;
  }
  return null;
}

function addBush(b: Builder): Bush | null {
  for (let tries = 0; tries < 60; tries++) {
    const r = between(b.rng, 5, 9);
    const x = between(b.rng, MEADOW.x0 + 14, MEADOW.x1 - 14);
    const y = between(b.rng, MEADOW.y0 + 14, MEADOW.y1 - 12);
    const cells: number[] = [];
    for (let row = Math.floor((y - r) / TILE); row <= Math.floor((y + r) / TILE); row++)
      for (let col = Math.floor((x - r) / TILE); col <= Math.floor((x + r) / TILE); col++)
        if (Math.hypot(center(col) - x, center(row) - y) <= r) cells.push(row * COLS + col);
    if (cells.length === 0) continue;
    const own = new Set(cells);
    const ok = cells.every((i) => {
      const c = i % COLS;
      const row = (i - c) / COLS;
      return clearArea(b, c - 3, row - 3, c + 3, row + 3, own);
    });
    if (!ok) continue;
    for (const i of cells) b.grid.cells[i] = CELL.bush;
    return { x, y, r };
  }
  return null;
}

/** Все проходимые клетки ниже плетня достижимы: нет карманов, откуда овцу не выгнать. */
function connected(grid: Grid, nav: Float64Array): boolean {
  for (let row = TOP_ROWS; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      if (passable(grid, col, row) && !Number.isFinite(nav[row * COLS + col] as number))
        return false;
  return true;
}

/** Овца может стоять здесь в начале уровня: на лугу, не в препятствиях, путь до загона есть. */
export function canStand(level: Pick<Level, 'grid' | 'nav' | 'pen'>, p: Point): boolean {
  if (p.x < MEADOW.x0 + 20 || p.x > MEADOW.x1 - 20) return false;
  if (p.y < MEADOW.y0 + 8 || p.y > MEADOW.y1 - 20) return false;
  if (penetration(level.grid, p.x, p.y, SHEEP_R + 2) > 0) return false;
  if (!Number.isFinite(navAt(level.nav, level.grid, p.x, p.y))) return false;
  const pen = level.pen.inner;
  const m = TILE + 10;
  return !(
    p.x > pen.x - m &&
    p.x < pen.x + pen.w + m &&
    p.y > pen.y - m &&
    p.y < pen.y + pen.h + m
  );
}

function splitSizes(rng: Rng, total: number, groups: number): number[] {
  const sizes = Array.from(
    { length: groups },
    (_, i) => Math.floor(total / groups) + (i < total % groups ? 1 : 0),
  );
  for (let k = 0; k < groups; k++) {
    const a = Math.floor(rng() * groups);
    const c = Math.floor(rng() * groups);
    if (a !== c && (sizes[a] ?? 0) > 3) {
      sizes[a] = (sizes[a] ?? 0) - 1;
      sizes[c] = (sizes[c] ?? 0) + 1;
    }
  }
  return sizes;
}

const meadowPoint = (rng: Rng): Point => ({
  x: between(rng, MEADOW.x0 + 20, MEADOW.x1 - 20),
  y: between(rng, MEADOW.y0 + 8, MEADOW.y1 - 20),
});

function placeFlock(
  b: Builder,
  spec: LevelSpec,
  level: Pick<Level, 'grid' | 'nav' | 'pen' | 'stream' | 'dog'>,
): { sheep: Point[]; wanderers: number[] } | null {
  const sheep: Point[] = [];
  const sizes = splitSizes(b.rng, spec.sheep - spec.strays, spec.groups);
  const centers: Point[] = [];
  const pen = level.pen.inner;
  const penSide = streamSide(level.stream, { x: pen.x + pen.w / 2, y: pen.y + pen.h / 2 });
  for (let gi = 0; gi < sizes.length; gi++) {
    // С ручьём первая кучка — на том берегу: стадо придётся гнать через мостик.
    const far = level.stream !== null && gi === 0 && sizes.length >= 2;
    let c: Point | null = null;
    for (let t = 0; t < 400 && !c; t++) {
      const p = meadowPoint(b.rng);
      if (!canStand(level, p)) continue;
      if (navAt(level.nav, level.grid, p.x, p.y) < 80) continue;
      if (dist(p, level.dog) < 70 || centers.some((q) => dist(p, q) < 56)) continue;
      if (far && streamSide(level.stream, p) === penSide) continue;
      c = p;
    }
    if (!c) return null;
    centers.push(c);
    const size = sizes[gi] ?? 0;
    for (let k = 0; k < size; k++) {
      let p: Point | null = null;
      for (let t = 0; t < 400 && !p; t++) {
        const radius = 7 + 3.2 * Math.sqrt(size) + t / 25;
        const a = b.rng() * Math.PI * 2;
        const r = Math.sqrt(b.rng()) * radius;
        const q = { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
        if (canStand(level, q) && sheep.every((o) => dist(o, q) >= 9)) p = q;
      }
      if (!p) return null;
      sheep.push(p);
    }
  }
  const wanderers: number[] = [];
  for (let k = 0; k < spec.strays; k++) {
    let p: Point | null = null;
    for (let t = 0; t < 600 && !p; t++) {
      const q = meadowPoint(b.rng);
      const edge = forestDistance(q);
      if (edge < 40 || edge > 70 || !canStand(level, q)) continue;
      if (navAt(level.nav, level.grid, q.x, q.y) < 60 || dist(q, level.dog) < 70) continue;
      if (sheep.some((o) => dist(o, q) < 60)) continue;
      p = q;
    }
    if (!p) return null;
    wanderers.push(sheep.length);
    sheep.push(p);
  }
  return { sheep, wanderers };
}

/* ---------- декорации: не влияют на правила ---------- */

function decorOf(rng: Rng, grid: Grid, pen: Pen): Decor[] {
  const out: Decor[] = [];
  for (let i = 0; i < 170; i++) {
    const x = between(rng, MEADOW.x0 + 2, MEADOW.x1 - 2);
    const y = between(rng, MEADOW.y0 + 3, MEADOW.y1 - 2);
    const v = rng();
    const k = rng();
    if (penetration(grid, x, y, 2) > 0) continue;
    const p = pen.inner;
    if (x > p.x - 6 && x < p.x + p.w + 6 && y > p.y - 6 && y < p.y + p.h + 6) continue;
    out.push({ kind: k < 0.62 ? 'tuft' : k < 0.92 ? 'flower' : 'stone', x, y, v });
  }
  return out.sort((a, c) => a.y - c.y);
}

function treesOf(rng: Rng): Tree[] {
  const out: Tree[] = [];
  const tree = (x: number, y: number) =>
    out.push({
      kind: rng() < 0.62 ? 'fir' : 'round',
      x: x + between(rng, -2, 2),
      y: y + between(rng, -2, 2),
      size: intBetween(rng, 10, 15),
    });
  for (let y = HORIZON - 2; y < WORLD_H + 8; y += 7) {
    for (const x of [3, 11]) tree(x, y + (x === 11 ? 3 : 0));
    for (const x of [WORLD_W - 4, WORLD_W - 12]) tree(x, y + (x === WORLD_W - 12 ? 3 : 0));
  }
  for (let x = 20; x < WORLD_W - 18; x += 7) {
    tree(x, WORLD_H - 9 + (Math.floor(x / 7) % 2) * 2);
    tree(x + 3, WORLD_H + 1);
  }
  return out.sort((a, c) => a.y - c.y);
}

function housesOf(rng: Rng): House[] {
  const out: House[] = [];
  const church = intBetween(rng, 120, 240);
  let x = intBetween(rng, -6, 6);
  while (x < WORLD_W) {
    if (Math.abs(x - church) < 30 && !out.some((h) => h.kind === 'church')) {
      out.push({ kind: 'church', x: church - 12, w: 24, h: 26 });
      x = church + 18;
      continue;
    }
    const barn = rng() < 0.18;
    const w = barn ? intBetween(rng, 26, 32) : intBetween(rng, 18, 24);
    out.push({ kind: barn ? 'barn' : 'izba', x, w, h: barn ? 13 : intBetween(rng, 14, 18) });
    x += w + intBetween(rng, 6, 16);
  }
  return out;
}

/* ---------- сборка уровня ---------- */

function build(spec: LevelSpec, seedText: string, seed: number, rng: Rng): Level | null {
  const grid = emptyGrid();
  for (let row = 0; row < TOP_ROWS; row++)
    for (let col = 0; col < COLS; col++) setCell(grid, col, row, CELL.fence);
  const b: Builder = { rng, grid, reserved: new Uint8Array(COLS * ROWS) };
  const stream = spec.stream ? addStream(b) : null;
  const pen = addPen(b, spec, stream);
  if (!pen) return null;
  const fences: Fence[] = [];
  for (let i = 0; i < spec.fences; i++) {
    const f = addFence(b);
    if (!f) return null;
    fences.push(...f);
  }
  const bushes: Bush[] = [];
  for (let i = 0; i < spec.bushes; i++) {
    const bush = addBush(b);
    if (!bush) return null;
    bushes.push(bush);
  }
  const nav = distanceField(grid, penGoals(grid, pen));
  if (!connected(grid, nav)) return null;
  const dog = { x: pen.mouth.x + pen.out.x * 16, y: pen.mouth.y + pen.out.y * 16 };
  const flock = placeFlock(b, spec, { grid, nav, pen, stream, dog });
  if (!flock) return null;
  return {
    spec,
    seedText,
    seed,
    grid,
    pen,
    fences,
    bushes,
    stream,
    sheep: flock.sheep,
    wanderers: flock.wanderers,
    dog,
    nav,
    decor: decorOf(rng, grid, pen),
    trees: treesOf(rng),
    houses: housesOf(rng),
  };
}

export function generateLevel(spec: LevelSpec, seedText: string): Level {
  const seed = hashString(`fog-shepherd:${seedText}`);
  for (let attempt = 0; attempt < 120; attempt++) {
    const level = build(
      spec,
      seedText,
      seed,
      mulberry32((seed + Math.imul(attempt, 0x9e3779b1)) >>> 0),
    );
    if (level) return level;
  }
  throw new Error(`Уровень «${seedText}» не построился`);
}

/** Части уровня, собранного вручную: тренировка и проверки физики в тестах. */
export interface LevelParts {
  spec?: Partial<LevelSpec>;
  seedText?: string;
  pen: PenPlan;
  fences?: readonly Fence[];
  bushes?: readonly Bush[];
  /** Прямоугольники воды и мостиков (в координатах мира, кратно клетке). */
  water?: readonly Rect[];
  bridges?: readonly Rect[];
  sheep: readonly Point[];
  wanderers?: readonly number[];
  dog: Point;
}

const cellsOf = (r: Rect, each: (col: number, row: number) => void) => {
  for (let row = Math.floor(r.y / TILE); row < Math.ceil((r.y + r.h) / TILE); row++)
    for (let col = Math.floor(r.x / TILE); col < Math.ceil((r.x + r.w) / TILE); col++)
      each(col, row);
};

/** Уровень из готовых частей: та же сетка, загон и путь, что у сгенерированного. */
export function assembleLevel(parts: LevelParts): Level {
  const grid = emptyGrid();
  for (let row = 0; row < TOP_ROWS; row++)
    for (let col = 0; col < COLS; col++) setCell(grid, col, row, CELL.fence);
  for (const r of parts.water ?? []) cellsOf(r, (c, w) => setCell(grid, c, w, CELL.water));
  for (const r of parts.bridges ?? []) cellsOf(r, (c, w) => setCell(grid, c, w, CELL.bridge));
  for (const f of parts.fences ?? []) cellsOf(f, (c, w) => setCell(grid, c, w, CELL.fence));
  for (const b of parts.bushes ?? []) {
    cellsOf({ x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 }, (c, w) => {
      if (Math.hypot(center(c) - b.x, center(w) - b.y) <= b.r) setCell(grid, c, w, CELL.bush);
    });
  }
  const pen = buildPen(grid, parts.pen);
  const nav = distanceField(grid, penGoals(grid, pen));
  const seedText = parts.seedText ?? 'custom';
  const rng = mulberry32(hashString(`fog-shepherd:${seedText}`));
  return {
    spec: { ...TRAINING, sheep: parts.sheep.length, ...parts.spec },
    seedText,
    seed: hashString(`fog-shepherd:${seedText}`),
    grid,
    pen,
    fences: parts.fences ?? [],
    bushes: parts.bushes ?? [],
    stream: null,
    sheep: parts.sheep,
    wanderers: parts.wanderers ?? [],
    dog: parts.dog,
    nav,
    decor: decorOf(rng, grid, pen),
    trees: treesOf(rng),
    houses: housesOf(rng),
  };
}

/** Тренировка: три овцы прямо перед воротами, собака позади, тумана нет. */
export function trainingLevel(): Level {
  return assembleLevel({
    seedText: 'training',
    pen: { col0: 65, row0: 21, iw: 8, ih: 7, side: 'left', from: 23, gw: 5 },
    sheep: [
      { x: 200, y: 99 },
      { x: 210, y: 106 },
      { x: 190, y: 106 },
    ],
    dog: { x: 134, y: 103 },
  });
}
