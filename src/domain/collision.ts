/**
 * Столкновения круга с занятыми клетками. Движение режется на шаги не длиннее половины
 * радиуса, поэтому даже очень быстрая овца не проскакивает сквозь забор в одну клетку,
 * а после касания скользит вдоль стены.
 */

import { type Grid, isBlocked } from './grid';
import { TILE } from './world';

export interface Contact {
  x: number;
  y: number;
  /** Сумма нормалей касаний; (0, 0) — касаний не было. */
  nx: number;
  ny: number;
  hit: boolean;
}

interface Push {
  nx: number;
  ny: number;
  depth: number;
}

/** Выталкивание, если центр круга оказался внутри клетки: через ближайшую свободную грань. */
function outOfCell(g: Grid, col: number, row: number, x: number, y: number, r: number): Push {
  const x0 = col * TILE;
  const y0 = row * TILE;
  const faces: [number, number, number, boolean][] = [
    [-1, 0, x - x0, isBlocked(g, col - 1, row)],
    [1, 0, x0 + TILE - x, isBlocked(g, col + 1, row)],
    [0, -1, y - y0, isBlocked(g, col, row - 1)],
    [0, 1, y0 + TILE - y, isBlocked(g, col, row + 1)],
  ];
  let best: Push | null = null;
  let bestFree = false;
  for (const [nx, ny, dist, blocked] of faces) {
    const free = !blocked;
    if (!best || (free && !bestFree) || (free === bestFree && dist + r < best.depth)) {
      best = { nx, ny, depth: dist + r };
      bestFree = free;
    }
  }
  return best as Push;
}

/** Самое глубокое пересечение круга (x, y, r) с занятыми клетками; null — круг свободен. */
function deepest(g: Grid, x: number, y: number, r: number): Push | null {
  const c0 = Math.floor((x - r) / TILE);
  const c1 = Math.floor((x + r) / TILE);
  const r0 = Math.floor((y - r) / TILE);
  const r1 = Math.floor((y + r) / TILE);
  let best: Push | null = null;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isBlocked(g, col, row)) continue;
      const bx0 = col * TILE;
      const by0 = row * TILE;
      const cx = x < bx0 ? bx0 : x > bx0 + TILE ? bx0 + TILE : x;
      const cy = y < by0 ? by0 : y > by0 + TILE ? by0 + TILE : y;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      let push: Push;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        push = { nx: dx / d, ny: dy / d, depth: r - d };
      } else {
        push = outOfCell(g, col, row, x, y, r);
      }
      if (!best || push.depth > best.depth) best = push;
    }
  }
  return best;
}

/** Выталкивает круг из занятых клеток: сначала из самого глубокого касания. */
export function resolve(g: Grid, x: number, y: number, r: number): Contact {
  let nx = 0;
  let ny = 0;
  let hit = false;
  for (let i = 0; i < 6; i++) {
    const p = deepest(g, x, y, r);
    if (!p) break;
    x += p.nx * (p.depth + 1e-6);
    y += p.ny * (p.depth + 1e-6);
    nx += p.nx;
    ny += p.ny;
    hit = true;
  }
  return { x, y, nx, ny, hit };
}

/** Сдвигает круг на (dx, dy) с проверкой на каждом отрезке не длиннее r/2 и скольжением. */
export function moveCircle(
  g: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
): Contact {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (r * 0.5)));
  let sx = dx / n;
  let sy = dy / n;
  let nx = 0;
  let ny = 0;
  let hit = false;
  for (let i = 0; i < n; i++) {
    const c = resolve(g, x + sx, y + sy, r);
    x = c.x;
    y = c.y;
    if (!c.hit) continue;
    hit = true;
    nx += c.nx;
    ny += c.ny;
    // Остаток пути — вдоль стены: составляющая в стену гасится.
    const l = Math.hypot(c.nx, c.ny);
    if (l > 1e-9) {
      const ux = c.nx / l;
      const uy = c.ny / l;
      const into = sx * ux + sy * uy;
      if (into < 0) {
        sx -= into * ux;
        sy -= into * uy;
      }
    }
  }
  return { x, y, nx, ny, hit };
}

/** Сколько круг заходит в занятые клетки (0 — нисколько). Для тестов и проверок уровня. */
export function penetration(g: Grid, x: number, y: number, r: number): number {
  return deepest(g, x, y, r)?.depth ?? 0;
}

/**
 * Куда отталкивают стены рядом: сумма направлений от ближних занятых клеток, каждое с весом
 * 0–1 (1 — вплотную). По ней овца скользит вдоль забора, а не упирается в него.
 */
export function wallNormal(g: Grid, x: number, y: number, reach: number): { x: number; y: number } {
  const c0 = Math.floor((x - reach) / TILE);
  const c1 = Math.floor((x + reach) / TILE);
  const r0 = Math.floor((y - reach) / TILE);
  const r1 = Math.floor((y + reach) / TILE);
  let nx = 0;
  let ny = 0;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (!isBlocked(g, col, row)) continue;
      const bx0 = col * TILE;
      const by0 = row * TILE;
      const cx = x < bx0 ? bx0 : x > bx0 + TILE ? bx0 + TILE : x;
      const cy = y < by0 ? by0 : y > by0 + TILE ? by0 + TILE : y;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= reach || d < 1e-9) continue;
      const k = 1 - d / reach;
      nx += (dx / d) * k;
      ny += (dy / d) * k;
    }
  }
  return { x: nx, y: ny };
}
