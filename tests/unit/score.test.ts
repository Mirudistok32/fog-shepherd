import { describe, expect, it } from 'vitest';

import { campaignLevel } from '@/domain/level';
import { resultOf, starsFor } from '@/domain/score';

import { field, simulate, stay } from './helpers';

describe('звёзды', () => {
  it('★ — две трети стада, ★★ — всё стадо, ★★★ — всё стадо быстрее норматива', () => {
    expect(starsFor(12, 12, 50, 60)).toBe(3);
    expect(starsFor(12, 12, 60, 60)).toBe(3);
    expect(starsFor(12, 12, 61, 60)).toBe(2);
    expect(starsFor(11, 12, 30, 60)).toBe(1);
    expect(starsFor(8, 12, 30, 60)).toBe(1);
    expect(starsFor(7, 12, 30, 60)).toBe(0);
    expect(starsFor(4, 6, 30, 60)).toBe(1);
    expect(starsFor(3, 6, 30, 60)).toBe(0);
    expect(starsFor(0, 0, 0, 60)).toBe(0);
  });
});

describe('итог уровня', () => {
  it('рассвело: сколько в загоне, сколько в лесу, время — не дольше ночи', () => {
    const level = field({
      sheep: [
        { x: 338, y: 48 },
        { x: 200, y: 150 },
        { x: 220, y: 160 },
      ],
      spec: { time: 4, par: 3 },
    });
    const { run } = simulate(level, 6);
    const r = resultOf(run, level);
    expect(r).toMatchObject({
      total: 3,
      saved: 1,
      lost: 0,
      time: 4,
      dawn: true,
      allIn: false,
      stars: 0,
    });
  });

  it('всё стадо в загоне — две или три звезды по нормативу', () => {
    const level = field({ sheep: [{ x: 338, y: 48 }], spec: { time: 60, par: 10 } });
    const { run } = simulate(level, 1, stay);
    const r = resultOf(run, level);
    expect(r).toMatchObject({ saved: 1, allIn: true, dawn: false, stars: 3 });
    expect(resultOf({ ...run, t: 20 }, level).stars).toBe(2);
  });

  it('номер и время года уровня попадают в итог', () => {
    const level = campaignLevel(7);
    const r = resultOf({ ...simulate(level, 0.1).run }, level);
    expect(r.level).toBe(7);
    expect(r.season).toBe('autumn');
    expect(r.limit).toBe(level.spec.time);
    expect(r.par).toBe(level.spec.par);
  });
});
