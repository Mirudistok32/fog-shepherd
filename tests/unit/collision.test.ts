import { describe, expect, it } from 'vitest';

import { moveCircle, penetration, resolve } from '@/domain/collision';
import { CELL, emptyGrid, type Grid, setCell } from '@/domain/grid';
import { IDLE, within } from '@/domain/herd';
import { campaignLevel } from '@/domain/level';
import { DOG_R, SHEEP_R, TILE } from '@/domain/world';

import { field, simulate, withBot } from './helpers';

const R = SHEEP_R;

/** Сетка с забором из прямоугольников в клетках (без плетня — только то, что задано). */
function grid(walls: [col: number, row: number, w: number, h: number][]): Grid {
  const g = emptyGrid();
  for (const [c0, r0, w, h] of walls)
    for (let r = r0; r < r0 + h; r++)
      for (let c = c0; c < c0 + w; c++) setCell(g, c, r, CELL.fence);
  return g;
}

describe('круг и стены', () => {
  // Вертикальный забор толщиной в клетку: x от 200 до 204.
  const wall = grid([[50, 10, 1, 30]]);

  it('упирается в забор и не заходит в него', () => {
    const c = moveCircle(wall, 190, 100, 20, 0, R);
    expect(c.hit).toBe(true);
    expect(c.x).toBeLessThanOrEqual(200 - R + 1e-6);
    expect(penetration(wall, c.x, c.y, R)).toBe(0);
  });

  it('на огромной скорости за один шаг не проскакивает забор толщиной в клетку', () => {
    for (const dx of [50, 137, 500, 5000]) {
      const c = moveCircle(wall, 190, 100, dx, 0, R);
      expect(c.x, `dx = ${dx}`).toBeLessThanOrEqual(200 - R + 1e-6);
    }
    const back = moveCircle(wall, 214, 100, -900, 0, R);
    expect(back.x).toBeGreaterThanOrEqual(204 + R - 1e-6);
  });

  it('по косой скользит вдоль стены, а не останавливается', () => {
    const c = moveCircle(wall, 195, 100, 20, 20, R);
    expect(c.x).toBeLessThanOrEqual(200 - R + 1e-6);
    expect(c.y).toBeCloseTo(120, 5);
  });

  it('вдоль длинной стены из многих клеток едет без зацепов на стыках', () => {
    const floor = grid([[5, 30, 85, 1]]); // x 20–360, y 120–124
    let x = 50;
    let y = 120 - R;
    for (let i = 0; i < 400; i++) {
      const c = moveCircle(floor, x, y, 0.6, 0.3, R);
      expect(c.y).toBeCloseTo(120 - R, 5);
      x = c.x;
      y = c.y;
    }
    expect(x).toBeCloseTo(50 + 0.6 * 400, 4);
  });

  it('во внутреннем углу останавливается в самом углу: без проникновения и без дрожи', () => {
    // Угол «Г»: забор сверху (y 80–84) и справа (x 200–204).
    const corner = grid([
      [35, 20, 16, 1],
      [50, 20, 1, 15],
    ]);
    let x = 180;
    let y = 100;
    const tail: [number, number][] = [];
    for (let i = 0; i < 300; i++) {
      const c = moveCircle(corner, x, y, 0.5, -0.5, R);
      x = c.x;
      y = c.y;
      expect(penetration(corner, x, y, R)).toBe(0);
      if (i >= 250) tail.push([x, y]);
    }
    expect(x).toBeCloseTo(200 - R, 4);
    expect(y).toBeCloseTo(84 + R, 4);
    for (const [px, py] of tail) {
      expect(Math.abs(px - x) + Math.abs(py - y)).toBeLessThan(1e-6);
    }
  });

  it('внешний угол огибает плавно', () => {
    const block = grid([[50, 25, 1, 1]]); // клетка x 200–204, y 100–104
    let x = 190;
    let y = 102;
    let prev = x;
    for (let i = 0; i < 120; i++) {
      const c = moveCircle(block, x, y, 0.4, 0.15, R);
      expect(penetration(block, c.x, c.y, R)).toBe(0);
      expect(c.x).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c.x;
      x = c.x;
      y = c.y;
    }
    expect(x).toBeGreaterThan(204);
  });

  it('центр внутри клетки — выталкивается в свободную сторону', () => {
    const block = grid([[50, 25, 1, 1]]);
    const c = resolve(block, 201, 102, R);
    expect(penetration(block, c.x, c.y, R)).toBe(0);
    expect(c.x).toBeLessThan(200);
  });

  it('за краем мира — стена', () => {
    const open = grid([]);
    const c = moveCircle(open, 10, 100, -400, 0, R);
    expect(c.x).toBeGreaterThanOrEqual(R - 1e-6);
  });
});

describe('столкновения в симуляции', () => {
  it('в давке на трудном уровне овцы не заходят в заборы, кусты и воду и не проходят друг сквозь друга', () => {
    const level = campaignLevel(12);
    let deepest = 0;
    let closest = Infinity;
    let dogClosest = Infinity;
    withBot(level, {
      limit: 70,
      each: (run) => {
        const live = run.sheep.filter((s) => s.status !== 'lost');
        for (const s of live) deepest = Math.max(deepest, penetration(level.grid, s.x, s.y, R));
        for (let i = 0; i < live.length; i++) {
          const a = live[i];
          if (!a) continue;
          dogClosest = Math.min(dogClosest, Math.hypot(a.x - run.dog.x, a.y - run.dog.y));
          for (let j = i + 1; j < live.length; j++) {
            const b = live[j];
            if (b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
          }
        }
      },
    });
    expect(deepest).toBeLessThan(1e-3);
    expect(closest).toBeGreaterThan(R * 2 * 0.8);
    expect(dogClosest).toBeGreaterThan((DOG_R + R) * 0.8);
  }, 60_000);

  it('прижатая собакой к забору овца скользит вдоль него и обходит конец', () => {
    // Забор x 200–204, y 60–180; собака давит слева.
    const level = field({
      fences: [{ x: 200, y: 60, w: TILE, h: 120 }],
      sheep: [{ x: 192, y: 120 }],
      dog: { x: 150, y: 121 },
    });
    let maxPen = 0;
    const { run } = simulate(
      level,
      12,
      (r) => ({
        ...IDLE,
        target: { x: (r.sheep[0]?.x ?? 0) - 14, y: r.sheep[0]?.y ?? 0 },
        pace: 0.7,
      }),
      undefined,
      (r) =>
        (maxPen = Math.max(
          maxPen,
          penetration(level.grid, r.sheep[0]?.x ?? 0, r.sheep[0]?.y ?? 0, R),
        )),
    );
    const s = run.sheep[0];
    expect(maxPen).toBe(0);
    expect(s && (s.y < 60 - R || s.y > 180 + R || s.x > 204 + R)).toBe(true);
  });

  it('загнанные в угол «Г» овцы выбираются, даже если собака стоит у выхода', () => {
    const level = field({
      fences: [
        { x: 140, y: 80, w: 64, h: TILE },
        { x: 200, y: 80, w: TILE, h: 64 },
      ],
      sheep: [
        { x: 192, y: 92 },
        { x: 190, y: 101 },
        { x: 182, y: 93 },
      ],
      dog: { x: 150, y: 140 },
    });
    const escaped = new Set<number>();
    simulate(
      level,
      8,
      () => ({ ...IDLE, target: { x: 174, y: 112 } }),
      undefined,
      (r) => {
        for (const s of r.sheep) if (Math.hypot(s.x - 200, s.y - 84) > 30) escaped.add(s.id);
      },
    );
    expect(escaped.size).toBe(3);
  });

  it('загнанная овца не выходит из загона, даже когда собака забегает внутрь', () => {
    const level = field({ sheep: [{ x: 340, y: 50 }], dog: { x: 330, y: 80 } });
    const pen = level.pen.inner;
    let penned = false;
    let left = false;
    simulate(
      level,
      15,
      (r) => ({
        ...IDLE,
        target: { x: 300 + 40 * Math.sin(r.t * 2), y: 48 + 10 * Math.cos(r.t * 3) },
      }),
      undefined,
      (r) => {
        const s = r.sheep[0];
        if (!s) return;
        if (s.status === 'penned') penned = true;
        if (penned && !within(s, pen, SHEEP_R - 1e-6)) left = true;
      },
    );
    expect(penned).toBe(true);
    expect(left).toBe(false);
  });
});
