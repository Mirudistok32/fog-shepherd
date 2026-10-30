import { describe, expect, it } from 'vitest';

import { IDLE, startRun, step } from '@/domain/herd';
import { campaignLevel } from '@/domain/level';
import {
  DOG_R,
  DOG_SPEED,
  DOG_SWIM,
  DOG_TOP,
  SHEEP_R,
  STRAY_LOST,
  WHISTLE_COOLDOWN,
  WORLD_H,
  WORLD_W,
} from '@/domain/world';

import { DT, field, flockAt, simulate, spread, started, stay, withBot } from './helpers';

describe('забег', () => {
  it('до первого движения ничего не происходит; первое движение — событие start', () => {
    const level = field({ sheep: flockAt(200, 120, 5) });
    const run = startRun(level);
    const idle = step(run, level, IDLE, DT);
    expect(idle.run).toBe(run);
    expect(idle.events).toEqual([]);
    const moved = step(run, level, { ...IDLE, target: { x: 100, y: 100 } }, DT);
    expect(moved.run.status).toBe('running');
    expect(moved.events).toContainEqual({ type: 'start' });
  });

  it('таймер: время идёт шагами, на рассвете уровень кончается и больше не меняется', () => {
    const level = field({ sheep: flockAt(200, 150, 3), spec: { time: 5 } });
    let dawnAt = -1;
    const { run } = simulate(level, 10, stay, undefined, (r, ev) => {
      if (ev.some((e) => e.type === 'dawn')) dawnAt = r.t;
    });
    expect(run.status).toBe('dawn');
    expect(dawnAt).toBeGreaterThanOrEqual(5 - 1e-9);
    expect(dawnAt).toBeLessThan(5 + DT * 1.5);
    expect(step(run, level, { ...IDLE, target: { x: 0, y: 0 } }, DT).run).toBe(run);
  });

  it('овцы в загоне считаются; когда в загоне все — уровень пройден', () => {
    const level = field({
      sheep: [
        { x: 338, y: 48 },
        { x: 330, y: 42 },
      ],
      dog: { x: 200, y: 150 },
    });
    const { run, events } = simulate(level, 1, stay, startRun(level));
    expect(run.penned).toBe(2);
    expect(run.status).toBe('done');
    expect(events.filter((e) => e.type === 'penned')).toHaveLength(2);
    expect(events).toContainEqual({ type: 'done' });
  });

  it('овца, которую держат в лесу дольше STRAY_LOST, теряется', () => {
    const level = field({
      sheep: [
        { x: 10, y: 120 },
        { x: 200, y: 150 },
      ],
      dog: { x: 40, y: 120 },
    });
    const { run, events } = simulate(
      level,
      STRAY_LOST + 1,
      () => ({ ...IDLE, target: { x: 26, y: 120 } }),
      startRun(level),
    );
    expect(run.sheep[0]?.status).toBe('lost');
    expect(run.lost).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'stray', id: 0 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'lost', id: 0 }));
  });

  it('овцу, вернувшуюся из леса раньше срока, не теряют, а загнанную — считают спасённой', () => {
    const level = field({ sheep: [{ x: 372, y: 100 }], dog: { x: 300, y: 150 } });
    const first = simulate(level, 0.1).run;
    expect(first.sheep[0]?.strayed).toBe(true);
    const { run, events } = withBot(level, { limit: 60 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'back', id: 0 }));
    expect(run.status).toBe('done');
    expect(run.lost).toBe(0);
    expect(run.rescued).toBe(1);
  });

  it('свист собирает овец рядом в кучу; дальние не слышат; раньше перезарядки не сработает', () => {
    const near = [
      { x: 170, y: 150 },
      { x: 230, y: 150 },
      { x: 185, y: 180 },
      { x: 215, y: 180 },
    ];
    const level = field({ sheep: [...near, { x: 60, y: 190 }], dog: { x: 200, y: 100 } });
    const run = started(level);
    const first = step(run, level, { ...stay(run), whistle: true }, DT);
    expect(first.events).toContainEqual(expect.objectContaining({ type: 'whistle', count: 4 }));
    const again = step(first.run, level, { ...stay(first.run), whistle: true }, DT);
    expect(again.events.some((e) => e.type === 'whistle')).toBe(false);
    expect(again.run.whistles).toBe(1);
    const after = simulate(level, 3, stay, again.run).run;
    expect(spread(after.sheep.slice(0, 4))).toBeLessThan(spread(near) * 0.6);
    expect(after.sheep[4]?.gather).toBe(0);
    const later = simulate(level, WHISTLE_COOLDOWN, stay, again.run).run;
    expect(step(later, level, { ...stay(later), whistle: true }, DT).run.whistles).toBe(2);
  });

  it('свист помогает, а не ломает игру: бот, свистящий при каждой возможности, загоняет стадо', () => {
    const level = campaignLevel(6);
    const { run } = withBot(level, { whistleAlways: true });
    expect(run.whistles).toBeGreaterThan(10);
    expect(run.status).toBe('done');
    expect(run.penned).toBe(level.sheep.length);
  });

  it('один и тот же ввод — один и тот же забег', () => {
    const level = campaignLevel(4);
    expect(withBot(level, { limit: 30 }).run).toEqual(withBot(level, { limit: 30 }).run);
  });
});

describe('собака', () => {
  it('бежит к цели не быстрее DOG_SPEED и останавливается в ней без дрожи', () => {
    const level = field({ sheep: [{ x: 40, y: 60 }], dog: { x: 100, y: 150 } });
    const target = { x: 260, y: 120 };
    let max = 0;
    const tail: { x: number; y: number }[] = [];
    simulate(
      level,
      6,
      () => ({ ...IDLE, target }),
      undefined,
      (r) => {
        max = Math.max(max, Math.hypot(r.dog.vx, r.dog.vy));
        if (r.t > 5) tail.push({ x: r.dog.x, y: r.dog.y });
      },
    );
    expect(max).toBeLessThanOrEqual(DOG_SPEED + 1e-9);
    expect(max).toBeGreaterThan(DOG_SPEED * 0.95);
    for (const p of tail) expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeLessThan(1);
    expect(spread(tail)).toBeLessThan(0.01);
  });

  it('с клавиатуры бежит в сторону стрелок, в ручье плывёт медленнее', () => {
    const level = field({
      sheep: [{ x: 40, y: 60 }],
      water: [{ x: 200, y: 32, w: 40, h: 184 }],
      dog: { x: 100, y: 120 },
    });
    const right = () => ({ ...IDLE, move: { x: 1, y: 0 } });
    const land = simulate(level, 0.6, right).run;
    expect(Math.hypot(land.dog.vx, land.dog.vy)).toBeCloseTo(DOG_SPEED, 5);
    let swimMax = 0;
    simulate(level, 3, right, undefined, (r) => {
      if (r.dog.swim && r.dog.x > 210 && r.dog.x < 230)
        swimMax = Math.max(swimMax, Math.hypot(r.dog.vx, r.dog.vy));
    });
    expect(swimMax).toBeGreaterThan(0);
    expect(swimMax).toBeLessThanOrEqual(DOG_SPEED * DOG_SWIM + 1e-9);
  });

  it('не убегает за край луга и выше плетня', () => {
    const level = field({ sheep: [{ x: 200, y: 150 }], dog: { x: 100, y: 120 } });
    let ok = true;
    for (const move of [
      { x: -1, y: -1 },
      { x: 1, y: 1 },
    ]) {
      simulate(
        level,
        8,
        () => ({ ...IDLE, move }),
        undefined,
        (r) => {
          const { x, y } = r.dog;
          if (x < DOG_R || x > WORLD_W - DOG_R || y < DOG_TOP || y > WORLD_H - DOG_R) ok = false;
        },
      );
    }
    expect(ok).toBe(true);
  });

  it('не проходит сквозь овцу, даже прижатую к забору', () => {
    const level = field({
      sheep: [{ x: 195, y: 120 }],
      fences: [{ x: 200, y: 60, w: 4, h: 120 }],
      dog: { x: 150, y: 120 },
    });
    let closest = Infinity;
    simulate(
      level,
      4,
      () => ({ ...IDLE, target: { x: 230, y: 120 } }),
      undefined,
      (r) => {
        const s = r.sheep[0];
        if (s) closest = Math.min(closest, Math.hypot(s.x - r.dog.x, s.y - r.dog.y));
      },
    );
    expect(closest).toBeGreaterThan((DOG_R + SHEEP_R) * 0.8);
  });
});
