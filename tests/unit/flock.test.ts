import { describe, expect, it } from 'vitest';

import { alignment, cohesion, flee, separation } from '@/domain/flock';
import { IDLE } from '@/domain/herd';
import { CALM, FLEE_R, SHEEP_RUN, SHEEP_WALK } from '@/domain/world';

import { centroid, field, flockAt, simulate, spread, stay } from './helpers';

const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe('правила стаи по отдельности', () => {
  it('разделение: прочь от соседа ближе радиуса, вплотную — сильнее, дальше радиуса — ноль', () => {
    const me = { x: 0, y: 0 };
    const near = separation(me, [{ x: 4, y: 0 }], 10);
    const closer = separation(me, [{ x: 1.5, y: 0 }], 10);
    expect(near.x).toBeLessThan(0);
    expect(Math.abs(near.y)).toBeLessThan(1e-9);
    expect(closer.x).toBeLessThan(near.x);
    expect(separation(me, [{ x: 12, y: 0 }], 10)).toEqual({ x: 0, y: 0 });
  });

  it('разделение: соседи с двух сторон на равном расстоянии — толчки гасятся', () => {
    const s = separation(
      { x: 0, y: 0 },
      [
        { x: -4, y: 1 },
        { x: 4, y: -1 },
      ],
      10,
    );
    expect(len(s)).toBeLessThan(1e-9);
  });

  it('выравнивание: стоящую овцу тянет туда, куда бегут соседи; та же скорость — ноль', () => {
    const me = { x: 0, y: 0, vx: 0, vy: 0 };
    const others = [
      { x: 5, y: 0, vx: 10, vy: 0 },
      { x: 0, y: 5, vx: 10, vy: 2 },
    ];
    const a = alignment(me, others);
    expect(a.x).toBeCloseTo(10);
    expect(a.y).toBeCloseTo(1);
    expect(alignment({ ...me, vx: 10, vy: 1 }, others)).toEqual({ x: 0, y: 0 });
    expect(alignment(me, [])).toEqual({ x: 0, y: 0 });
  });

  it('сплочение: к центру соседей, длина не больше 1 и растёт с расстоянием', () => {
    const me = { x: 0, y: 0 };
    const far = cohesion(
      me,
      [
        { x: 40, y: 0 },
        { x: 40, y: 10 },
      ],
      14,
    );
    const near = cohesion(me, [{ x: 4, y: 0 }], 14);
    expect(far.x).toBeGreaterThan(0);
    expect(far.y).toBeGreaterThan(0);
    expect(len(far)).toBeCloseTo(1);
    expect(len(near)).toBeLessThan(len(far));
    expect(cohesion(me, [], 14)).toEqual({ x: 0, y: 0 });
  });

  it('бегство: прочь от собаки, вплотную сильнее; за радиусом — ноль', () => {
    const me = { x: 0, y: 0 };
    const close = flee(me, { x: -5, y: 0 }, FLEE_R);
    const away = flee(me, { x: -30, y: 0 }, FLEE_R);
    expect(close.x).toBeGreaterThan(away.x);
    expect(away.x).toBeGreaterThan(0);
    expect(flee(me, { x: -FLEE_R - 1, y: 0 }, FLEE_R)).toEqual({ x: 0, y: 0 });
  });
});

describe('стадо в симуляции', () => {
  it('овца бежит от собаки и никогда не быстрее SHEEP_RUN', () => {
    const level = field({ sheep: [{ x: 200, y: 120 }], dog: { x: 160, y: 120 } });
    let max = 0;
    const { run } = simulate(
      level,
      3,
      (r) => ({ ...IDLE, target: { x: r.sheep[0]?.x ?? 0, y: r.sheep[0]?.y ?? 0 } }),
      undefined,
      (r) => (max = Math.max(max, Math.hypot(r.sheep[0]?.vx ?? 0, r.sheep[0]?.vy ?? 0))),
    );
    const s = run.sheep[0];
    expect(Math.hypot((s?.x ?? 0) - 200, (s?.y ?? 0) - 120)).toBeGreaterThan(50);
    expect(max).toBeGreaterThan(SHEEP_RUN * 0.6);
    expect(max).toBeLessThanOrEqual(SHEEP_RUN + 1e-6);
  });

  it('без собаки стадо пасётся: шагом, больше половины времени щиплет траву, не расходится', () => {
    const level = field({ sheep: flockAt(190, 120, 12) });
    let max = 0;
    let grazing = 0;
    let total = 0;
    const { run } = simulate(level, 60, stay, undefined, (r) => {
      for (const s of r.sheep) {
        max = Math.max(max, Math.hypot(s.vx, s.vy));
        total++;
        if (s.mode === 'graze') grazing++;
      }
    });
    expect(max).toBeLessThanOrEqual(SHEEP_WALK * 1.1);
    expect(grazing / total).toBeGreaterThan(0.5);
    expect(spread(run.sheep)).toBeLessThan(spread(level.sheep) * 1.6);
  });

  it('спокойные овцы не дрожат: рисунок не скачет туда-обратно между пикселями', () => {
    const level = field({ sheep: flockAt(190, 120, 12) });
    const trail: [number, number][][] = level.sheep.map(() => []);
    const faces = level.sheep.map(() => 0);
    let flips = 0;
    let k = 0;
    simulate(level, 40, stay, undefined, (r) => {
      k++;
      r.sheep.forEach((s, i) => {
        // Кадр 60 Гц — каждый второй шаг.
        if (k % 2 === 0) trail[i]?.push([Math.round(s.x), Math.round(s.y)]);
        if (faces[i] !== 0 && faces[i] !== s.face) flips++;
        faces[i] = s.face;
      });
    });
    let flicker = 0;
    for (const t of trail) {
      for (let j = 2; j < t.length; j++) {
        const [a, b, c] = [t[j - 2], t[j - 1], t[j]] as [
          [number, number],
          [number, number],
          [number, number],
        ];
        if (a[0] === c[0] && a[1] === c[1] && (a[0] !== b[0] || a[1] !== b[1])) flicker++;
      }
    }
    expect(flicker).toBe(0);
    // Поворачивается спокойная овца не чаще раза в пять секунд.
    expect(flips / level.sheep.length).toBeLessThan(40 / 5);
  });

  it('испуганное стадо уходит от собаки вместе, а не рассыпается', () => {
    const sheep = flockAt(190, 120, 10);
    const level = field({ sheep, dog: { x: 120, y: 120 } });
    const { run } = simulate(level, 6, (r) => ({
      ...IDLE,
      target: { x: centroid(r.sheep).x - 30, y: 120 },
      pace: 0.6,
    }));
    expect(centroid(run.sheep).x).toBeGreaterThan(centroid(sheep).x + 25);
    expect(spread(run.sheep)).toBeLessThan(spread(sheep) * 1.6 + 6);
  });

  it('тревога передаётся: овцы вне досягаемости собаки тоже отходят', () => {
    const sheep = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 150 + i * 9, y: 120 }));
    const level = field({ sheep, dog: { x: 120, y: 120 } });
    const far = sheep.length - 1;
    expect(Math.abs((sheep[far]?.x ?? 0) - 120)).toBeGreaterThan(FLEE_R);
    let alarmed = 0;
    const { run } = simulate(
      level,
      2,
      () => ({ ...IDLE, target: { x: 135, y: 120 } }),
      undefined,
      (r) => {
        alarmed = Math.max(alarmed, r.sheep[far]?.alarm ?? 0);
      },
    );
    expect(alarmed).toBeGreaterThan(CALM);
    expect(run.sheep[far]?.x).toBeGreaterThan((sheep[far]?.x ?? 0) + 4);
  });

  it('собака ушла — стадо успокаивается и снова пасётся', () => {
    const level = field({ sheep: flockAt(190, 120, 8), dog: { x: 150, y: 120 } });
    let alarm = 0;
    const chased = simulate(
      level,
      2,
      () => ({ ...IDLE, target: { x: 175, y: 120 } }),
      undefined,
      (r) => {
        alarm = Math.max(alarm, ...r.sheep.map((s) => s.alarm));
      },
    ).run;
    expect(alarm).toBeGreaterThan(0.5);
    const after = simulate(level, 8, () => ({ ...IDLE, target: { x: 40, y: 190 } }), chased).run;
    for (const s of after.sheep) {
      expect(s.alarm).toBeLessThan(CALM);
      expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(SHEEP_WALK * 1.1);
    }
  });

  it('отбившаяся одиночка бредёт к лесу, а обычная овца — к своим', () => {
    const lone = field({ sheep: [{ x: 80, y: 120 }], wanderers: [0], dog: { x: 300, y: 190 } });
    const wandered = simulate(lone, 120).run.sheep[0];
    expect(wandered && (wandered.x < 70 || wandered.status === 'lost')).toBe(true);

    const sheep = [...flockAt(240, 120, 6), { x: 170, y: 120 }];
    const herd = field({ sheep, dog: { x: 40, y: 190 } });
    const back = simulate(herd, 40).run.sheep[6];
    expect(Math.hypot((back?.x ?? 0) - 240, (back?.y ?? 0) - 120)).toBeLessThan(45);
  });
});
