/**
 * Путь до загона: расстояние от каждой клетки до внутренности загона в обход заборов,
 * кустов и воды. По нему генератор проверяет, что загон достижим, у ворот испуганная
 * овца находит проём, а бот выбирает, куда гнать стадо.
 */

import { center, type Grid, isBlocked } from './grid';
import { TILE } from './world';

/** Клетка проходима с запасом: она и четыре соседки свободны — овца шириной в две клетки пройдёт. */
export function passable(g: Grid, col: number, row: number): boolean {
  return (
    !isBlocked(g, col, row) &&
    !isBlocked(g, col - 1, row) &&
    !isBlocked(g, col + 1, row) &&
    !isBlocked(g, col, row - 1) &&
    !isBlocked(g, col, row + 1)
  );
}

const STEPS: readonly [number, number, number][] = [
  [1, 0, TILE],
  [-1, 0, TILE],
  [0, 1, TILE],
  [0, -1, TILE],
  [1, 1, TILE * Math.SQRT2],
  [1, -1, TILE * Math.SQRT2],
  [-1, 1, TILE * Math.SQRT2],
  [-1, -1, TILE * Math.SQRT2],
];

/** Дейкстра по проходимым клеткам от целей; Infinity — недостижимо. Углы не срезаются. */
export function distanceField(g: Grid, goals: readonly number[]): Float64Array {
  const cols = g.cols;
  const dist = new Float64Array(cols * g.rows).fill(Infinity);
  const hd: number[] = [];
  const hi: number[] = [];
  const push = (d: number, i: number) => {
    let k = hd.length;
    hd.push(d);
    hi.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if ((hd[p] as number) <= d) break;
      hd[k] = hd[p] as number;
      hi[k] = hi[p] as number;
      k = p;
    }
    hd[k] = d;
    hi[k] = i;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [hd[0] as number, hi[0] as number];
    const d = hd.pop() as number;
    const i = hi.pop() as number;
    const n = hd.length;
    if (n > 0) {
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (hd[r] as number) < (hd[l] as number) ? r : l;
        if ((hd[c] as number) >= d) break;
        hd[k] = hd[c] as number;
        hi[k] = hi[c] as number;
        k = c;
      }
      hd[k] = d;
      hi[k] = i;
    }
    return top;
  };
  for (const i of goals) {
    dist[i] = 0;
    push(0, i);
  }
  while (hd.length > 0) {
    const [d, i] = pop();
    if (d > (dist[i] as number)) continue;
    const col = i % cols;
    const row = (i - col) / cols;
    for (const [dc, dr, cost] of STEPS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!passable(g, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (!passable(g, col + dc, row) || !passable(g, col, row + dr)))
        continue;
      const nd = d + cost;
      const j = nr * cols + nc;
      if (nd < (dist[j] as number)) {
        dist[j] = nd;
        push(nd, j);
      }
    }
  }
  return dist;
}

const cellIndex = (x: number, y: number): [number, number] => [
  Math.floor(x / TILE),
  Math.floor(y / TILE),
];

const valueAt = (nav: Float64Array, g: Grid, col: number, row: number): number =>
  col < 0 || row < 0 || col >= g.cols || row >= g.rows
    ? Infinity
    : (nav[row * g.cols + col] as number);

/**
 * Расстояние до загона из точки. Овца у стены стоит в клетке «без запаса» — тогда берётся
 * лучшая соседняя клетка плюс шаг до неё.
 */
export function navAt(nav: Float64Array, g: Grid, x: number, y: number): number {
  const [col, row] = cellIndex(x, y);
  const own = valueAt(nav, g, col, row);
  if (Number.isFinite(own)) return own;
  let best = Infinity;
  for (const [dc, dr, cost] of STEPS)
    best = Math.min(best, valueAt(nav, g, col + dc, row + dr) + cost);
  return best;
}

/**
 * Куда идти из точки к загону: спуск по расстоянию на несколько клеток вперёд, чтобы
 * направление не дёргалось между восемью соседями. null — точка уже в загоне или пути нет.
 */
export function flowDir(
  nav: Float64Array,
  g: Grid,
  x: number,
  y: number,
  lookahead = 4,
): { x: number; y: number } | null {
  let [col, row] = cellIndex(x, y);
  let value = valueAt(nav, g, col, row);
  let moved = false;
  for (let k = 0; k < lookahead; k++) {
    let bc = col;
    let br = row;
    let bv = value;
    for (const [dc, dr] of STEPS) {
      const v = valueAt(nav, g, col + dc, row + dr);
      if (v < bv) {
        bv = v;
        bc = col + dc;
        br = row + dr;
      }
    }
    if (bc === col && br === row) break;
    col = bc;
    row = br;
    value = bv;
    moved = true;
    if (value === 0) break;
  }
  if (!moved) return null;
  const dx = center(col) - x;
  const dy = center(row) - y;
  const l = Math.hypot(dx, dy);
  return l > 1e-9 ? { x: dx / l, y: dy / l } : null;
}
