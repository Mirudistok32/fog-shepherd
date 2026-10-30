/** Сетка 4×4: что лежит в клетке. По ней считаются столкновения овец и путь до загона. */

import { COLS, ROWS, TILE } from './world';

export const CELL = { grass: 0, fence: 1, bush: 2, water: 3, bridge: 4 } as const;
export type Cell = (typeof CELL)[keyof typeof CELL];

export interface Grid {
  cols: number;
  rows: number;
  cells: Uint8Array;
}

export const emptyGrid = (): Grid => ({
  cols: COLS,
  rows: ROWS,
  cells: new Uint8Array(COLS * ROWS),
});

export const inside = (g: Grid, col: number, row: number): boolean =>
  col >= 0 && row >= 0 && col < g.cols && row < g.rows;

/** За краем мира — забор: туда не уйти никому. */
export const cellAt = (g: Grid, col: number, row: number): Cell =>
  inside(g, col, row) ? ((g.cells[row * g.cols + col] ?? CELL.fence) as Cell) : CELL.fence;

export function setCell(g: Grid, col: number, row: number, cell: Cell) {
  if (inside(g, col, row)) g.cells[row * g.cols + col] = cell;
}

/** Овца не проходит сквозь заборы, кусты и воду; мостик проходим. */
export const blocksSheep = (cell: Cell): boolean =>
  cell === CELL.fence || cell === CELL.bush || cell === CELL.water;

export const isBlocked = (g: Grid, col: number, row: number): boolean =>
  blocksSheep(cellAt(g, col, row));

export const cellOf = (v: number): number => Math.floor(v / TILE);

export const blockedAt = (g: Grid, x: number, y: number): boolean =>
  isBlocked(g, cellOf(x), cellOf(y));

export const waterAt = (g: Grid, x: number, y: number): boolean =>
  cellAt(g, cellOf(x), cellOf(y)) === CELL.water;

/** Центр клетки в координатах мира. */
export const center = (cell: number): number => cell * TILE + TILE / 2;
