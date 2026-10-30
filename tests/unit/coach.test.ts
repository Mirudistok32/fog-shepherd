import { describe, expect, it } from 'vitest';

import { coach, COACH_START, coachFor, TIP_GAP, TIP_TIME, type TipId } from '@/domain/coach';
import type { Run } from '@/domain/herd';
import { campaignLevel, type Level } from '@/domain/level';
import { DOG_SPEED } from '@/domain/world';

import { field, flockAt, started } from './helpers';

const FRAME = 1 / 60;

/** Сколько секунд держать забег, пока не появится подсказка; null — так и не появилась. */
function tipAfter(level: Level, run: Run, seconds: number, state = COACH_START) {
  let s = state;
  for (let i = 0; i < seconds / FRAME; i++) {
    s = coach(s, run, level, FRAME);
    if (s.tip !== state.tip) return s;
  }
  return s;
}

const at = (run: Run, dog: Partial<Run['dog']>): Run => ({ ...run, dog: { ...run.dog, ...dog } });

// Загон справа сверху (PEN_RIGHT), стадо левее и ниже: сторона «за стадом» — слева снизу.
const flock = () => field({ sheep: flockAt(180, 120, 4) });

describe('подсказки', () => {
  it('только на тренировке и первых уровнях и только пока нет звезды', () => {
    expect(coachFor(0, 0)).toBe(true);
    expect(coachFor(3, 0)).toBe(true);
    expect(coachFor(4, 0)).toBe(false);
    expect(coachFor(2, 1)).toBe(false);
  });

  it('собака стоит между стадом и загоном — «обойдите овец»', () => {
    const level = flock();
    const run = at(started(level), { x: 230, y: 90, vx: 5, vy: 0 });
    expect(tipAfter(level, run, 3).tip).toBe<TipId>('behind');
  });

  it('собака правильно зашла за стадо — подсказки нет', () => {
    const level = flock();
    const run = at(started(level), { x: 140, y: 150, vx: 5, vy: 0 });
    expect(tipAfter(level, run, 3).tip).toBeNull();
  });

  it('налетела на стадо на бегу — «тише»; подсказка важнее «обойдите»', () => {
    const level = flock();
    const base = at(started(level), { x: 200, y: 110, vx: DOG_SPEED, vy: 0 });
    const run = { ...base, sheep: base.sheep.map((s) => ({ ...s, alarm: 0.9 })) };
    expect(tipAfter(level, run, 3).tip).toBe<TipId>('slow');
  });

  it('овца в лесу — подсказка сразу, даже в паузе между подсказками', () => {
    const level = flock();
    const base = at(started(level), { x: 140, y: 150, vx: 5, vy: 0 });
    const run = {
      ...base,
      sheep: base.sheep.map((s, i) => (i === 0 ? { ...s, stray: 0.5 } : s)),
    };
    const s = coach({ ...COACH_START, gap: TIP_GAP }, run, level, FRAME);
    expect(s.tip).toBe<TipId>('stray');
  });

  it('в тумане никого не видно — «ищите круги блеяния»', () => {
    const level = campaignLevel(1);
    const base = started(level);
    const run = {
      ...at(base, { x: 40, y: 200, vx: 5, vy: 0 }),
      sheep: base.sheep.map((s) => ({ ...s, x: 340, y: 200 })),
    };
    expect(tipAfter(level, run, 6).tip).toBe<TipId>('listen');
  });

  it('стадо разбрелось и свиста ещё не было — «свистните»; свистнул — молчит', () => {
    const level = field({
      sheep: [
        { x: 150, y: 120 },
        { x: 200, y: 120 },
        { x: 175, y: 90 },
        { x: 175, y: 160 },
      ],
    });
    const run = at(started(level), { x: 140, y: 150, vx: 5, vy: 0 });
    expect(tipAfter(level, run, 3).tip).toBe<TipId>('whistle');
    expect(tipAfter(level, { ...run, whistles: 1 }, 3).tip).toBeNull();
  });

  it('стадо за ручьём — «гоните к мостику»', () => {
    const level = campaignLevel(3);
    const stream = level.stream;
    if (!stream) throw new Error('на третьем уровне есть ручей');
    const base = started(level);
    // Ставим стадо на другой берег от ворот и собаку рядом.
    const side = stream.axis === 'horizontal' ? { x: 200, y: 190 } : { x: 40, y: 150 };
    const run = {
      ...at(base, { x: side.x - 20, y: side.y, vx: 5, vy: 0 }),
      sheep: base.sheep.map((s, i) => ({ ...s, x: side.x + i * 8, y: side.y })),
    };
    expect(tipAfter(level, run, 4).tip).toBe<TipId>('bridge');
  });

  it('каждая подсказка — один раз, исчезает сама и даёт передышку', () => {
    const level = flock();
    const run = at(started(level), { x: 230, y: 90, vx: 5, vy: 0 });
    const first = tipAfter(level, run, 3);
    expect(first.tip).toBe<TipId>('behind');
    let s = first;
    for (let i = 0; i < (TIP_TIME + 0.1) / FRAME; i++) s = coach(s, run, level, FRAME);
    expect(s.tip).toBeNull();
    expect(s.gap).toBeGreaterThan(0);
    for (let i = 0; i < 20 / FRAME; i++) {
      s = coach(s, run, level, FRAME);
      expect(s.tip).not.toBe('behind');
    }
  });

  it('исправил ошибку — подсказка уходит раньше времени, но не мигает', () => {
    const level = flock();
    const wrong = at(started(level), { x: 230, y: 90, vx: 5, vy: 0 });
    const right = at(wrong, { x: 140, y: 150 });
    let s = tipAfter(level, wrong, 3);
    s = coach(s, right, level, FRAME);
    expect(s.tip).toBe<TipId>('behind');
    for (let i = 0; i < 2.1 / FRAME; i++) s = coach(s, right, level, FRAME);
    expect(s.tip).toBeNull();
  });

  it('пока забег не начался и после него — молчит', () => {
    const level = flock();
    const run = at(started(level), { x: 230, y: 90 });
    expect(tipAfter(level, { ...run, status: 'ready' }, 6).tip).toBeNull();
    expect(tipAfter(level, { ...run, status: 'dawn' }, 6).tip).toBeNull();
  });
});
