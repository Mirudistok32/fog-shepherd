import { describe, expect, it } from 'vitest';

import { penetration } from '@/domain/collision';
import { CELL, cellAt, isBlocked } from '@/domain/grid';
import { within } from '@/domain/herd';
import {
  CAMPAIGN,
  campaignLevel,
  generateLevel,
  inForest,
  type Level,
  LEVEL_COUNT,
  levelSeed,
} from '@/domain/level';
import { navAt, passable } from '@/domain/navigation';
import { COLS, HORIZON, ROWS, SHEEP_R, TILE } from '@/domain/world';

/** Все проверки одного уровня; сообщения — с сидом, чтобы упавший легко повторить. */
function checkLevel(level: Level) {
  const tag = `${level.seedText} (уровень ${level.spec.number})`;
  const { pen, grid } = level;
  expect(level.sheep, tag).toHaveLength(level.spec.sheep);
  expect(level.wanderers, tag).toHaveLength(level.spec.strays);

  for (const [i, s] of level.sheep.entries()) {
    const who = `${tag}: овца ${i} (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`;
    expect(penetration(grid, s.x, s.y, SHEEP_R), `${who} в препятствии`).toBe(0);
    expect(inForest(s), `${who} в лесу`).toBe(false);
    expect(within(s, pen.inner, -TILE - SHEEP_R), `${who} в загоне`).toBe(false);
    expect(Number.isFinite(navAt(level.nav, grid, s.x, s.y)), `${who}: загон недостижим`).toBe(
      true,
    );
    for (const o of level.sheep.slice(i + 1)) {
      expect(Math.hypot(o.x - s.x, o.y - s.y), `${who} в другой овце`).toBeGreaterThanOrEqual(
        9 - 1e-9,
      );
    }
  }

  // Нет карманов: из любой проходимой клетки луга путь до загона есть.
  for (let row = HORIZON / TILE; row < ROWS; row++)
    for (let col = 0; col < COLS; col++)
      if (passable(grid, col, row))
        expect(
          Number.isFinite(level.nav[row * COLS + col] as number),
          `${tag}: карман в ${col},${row}`,
        ).toBe(true);

  // Ворота открыты, через них путь короткий; собака стоит у ворот снаружи.
  for (let y = pen.gate.y; y < pen.gate.y + pen.gate.h; y += TILE)
    for (let x = pen.gate.x; x < pen.gate.x + pen.gate.w; x += TILE)
      expect(isBlocked(grid, x / TILE, y / TILE), `${tag}: ворота закрыты`).toBe(false);
  expect(navAt(level.nav, grid, pen.mouth.x, pen.mouth.y), tag).toBeLessThan(TILE * 3);
  expect(within(level.dog, pen.inner, 0), `${tag}: собака в загоне`).toBe(false);

  if (level.spec.stream) {
    expect(level.stream, tag).not.toBeNull();
    expect(level.stream?.bridges.length, tag).toBeGreaterThanOrEqual(1);
    for (const b of level.stream?.bridges ?? []) {
      const c = cellAt(
        grid,
        Math.floor((b.x + b.w / 2) / TILE),
        Math.floor((b.y + b.h / 2) / TILE),
      );
      expect(c, `${tag}: мостик`).toBe(CELL.bridge);
    }
  } else {
    expect(level.stream, tag).toBeNull();
  }
  expect(level.fences.length, tag).toBeGreaterThanOrEqual(level.spec.fences);
  expect(level.bushes, tag).toHaveLength(level.spec.bushes);
}

describe('кампания', () => {
  it('сложность растёт: больше овец, гуще туман, меньше запаса времени на овцу', () => {
    for (let i = 1; i < CAMPAIGN.length; i++) {
      const [a, b] = [CAMPAIGN[i - 1], CAMPAIGN[i]];
      if (!a || !b) throw new Error('нет уровня');
      expect(b.number).toBe(a.number + 1);
      expect(b.sheep).toBeGreaterThan(a.sheep);
      expect(b.fog).toBeGreaterThanOrEqual(a.fog);
      expect(b.time / b.sheep).toBeLessThan(a.time / a.sheep);
      expect(b.par).toBeLessThan(b.time);
    }
    expect(CAMPAIGN.at(-1)?.sheep).toBeGreaterThanOrEqual(30);
  });

  it.each(Array.from({ length: LEVEL_COUNT + 1 }, (_, n) => n))(
    'уровень %i собран правильно и одинаков при каждом заходе',
    (n) => {
      const level = campaignLevel(n);
      checkLevel(level);
      expect(campaignLevel(n)).toEqual(level);
      if (n > 0) expect(level.seedText).toBe(levelSeed(n));
    },
  );
});

describe('генератор на 520 сидах', () => {
  const SEEDS = 520;
  it(`для любого сида загон достижим, овцы не стоят в препятствиях, в лесу и в загоне`, () => {
    for (let k = 0; k < SEEDS; k++) {
      const spec = CAMPAIGN[k % CAMPAIGN.length];
      if (!spec) throw new Error('нет уровня');
      checkLevel(generateLevel(spec, `test-${k}`));
    }
  }, 120_000);

  it('разные сиды дают разные раскладки', () => {
    const spec = CAMPAIGN[5];
    if (!spec) throw new Error('нет уровня');
    const a = generateLevel(spec, 'a');
    const b = generateLevel(spec, 'b');
    expect(a.sheep).not.toEqual(b.sheep);
  });
});
