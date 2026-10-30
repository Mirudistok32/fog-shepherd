import { describe, expect, it } from 'vitest';

import {
  clearRadius,
  fogAt,
  fogDensity,
  lanternLight,
  sheepVisible,
  silhouetteAt,
} from '@/domain/fog';
import { CAMPAIGN, campaignLevel } from '@/domain/level';

describe('туман', () => {
  const level = campaignLevel(8);
  const light = lanternLight(level);
  // Собака в стороне от загона.
  const dog = { x: light.x < 192 ? 300 : 80, y: 170 };

  it('у собаки и под фонарём загона ясно, вдали — туман уровня', () => {
    expect(fogAt(level, dog, 0, dog.x, dog.y)).toBe(0);
    expect(fogAt(level, dog, 0, light.x, light.y)).toBe(0);
    // Точка вдали и от собаки, и от фонаря.
    const r = clearRadius(level, 0);
    let far: { x: number; y: number } | null = null;
    for (let y = 40; y < 200 && !far; y += 8)
      for (let x = 20; x < 364 && !far; x += 8)
        if (Math.hypot(x - light.x, y - light.y) > light.r && Math.hypot(x - dog.x, y - dog.y) > r)
          far = { x, y };
    expect(far).not.toBeNull();
    expect(fogAt(level, dog, 0, far?.x ?? 0, far?.y ?? 0)).toBeCloseTo(level.spec.fog, 5);
  });

  it('весь загон под светом фонаря: тумана нет даже в углах', () => {
    const p = level.pen.inner;
    for (const [x, y] of [
      [p.x, p.y],
      [p.x + p.w, p.y],
      [p.x, p.y + p.h],
      [p.x + p.w, p.y + p.h],
    ] as const) {
      expect(fogAt(level, dog, 0, x, y)).toBe(0);
    }
  });

  it('к рассвету туман редеет, а ясный круг вокруг собаки растёт', () => {
    const end = level.spec.time;
    expect(fogDensity(level, end)).toBeLessThan(fogDensity(level, 0) * 0.5);
    expect(clearRadius(level, end)).toBeGreaterThan(clearRadius(level, 0) * 1.4);
    let prev = Infinity;
    for (let t = 0; t <= end; t += end / 20) {
      const d = fogDensity(level, t);
      expect(d).toBeLessThanOrEqual(prev + 1e-12);
      prev = d;
    }
  });

  it('чем дальше уровень, тем гуще туман и уже ясный круг', () => {
    for (let i = 1; i < CAMPAIGN.length; i++) {
      const [a, b] = [CAMPAIGN[i - 1], CAMPAIGN[i]];
      expect(b?.fog).toBeGreaterThanOrEqual(a?.fog ?? 0);
      expect(b?.clear).toBeLessThanOrEqual(a?.clear ?? Infinity);
    }
    expect(CAMPAIGN.at(-1)?.fog).toBeGreaterThan(CAMPAIGN[0]?.fog ?? 1);
  });

  it('силуэты различимы рядом с собакой и пропадают вдали', () => {
    const r = clearRadius(level, 0);
    expect(silhouetteAt(level, dog, 0, dog.x + r * 1.2, dog.y)).toBe(1);
    expect(silhouetteAt(level, dog, 0, dog.x + r * 3, dog.y)).toBe(0);
  });

  it('на тренировке тумана нет', () => {
    const training = campaignLevel(0);
    expect(fogAt(training, { x: 50, y: 50 }, 0, 300, 180)).toBe(0);
  });
});

describe('видимость овцы игроку', () => {
  const level = campaignLevel(12);
  const dog = { x: 100, y: 120 };

  it('рядом с собакой видна, вдалеке в густом тумане — нет, у фонаря — видна', () => {
    expect(sheepVisible(level, dog, 0, dog.x + 10, dog.y)).toBe(true);
    const far = { x: dog.x + level.spec.clear * 3, y: dog.y };
    const penFar = Math.hypot(far.x - lanternLight(level).x, far.y - lanternLight(level).y);
    expect(penFar).toBeGreaterThan(lanternLight(level).r);
    expect(sheepVisible(level, dog, 0, far.x, far.y)).toBe(false);
    const l = lanternLight(level);
    expect(sheepVisible(level, { x: 40, y: 200 }, 0, l.x, l.y)).toBe(true);
  });
});
