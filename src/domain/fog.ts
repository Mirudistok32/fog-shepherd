/**
 * Туман: насколько точка скрыта, 0–1. Ясно вокруг собаки и у фонаря загона; к рассвету
 * туман редеет, а ясный круг растёт. Рисунок тумана и силуэты овец берут числа отсюда.
 */

import type { Level, Point } from './level';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Сколько ночи прошло к моменту t: 0 — начало, 1 — рассвет. */
export const dawnOf = (level: Level, t: number): number => clamp01(t / level.spec.time);

/** Плотность тумана вдали от собаки: со второй половины ночи редеет до четверти. */
export function fogDensity(level: Level, t: number): number {
  return level.spec.fog * (1 - 0.75 * smoothstep(0.45, 1, dawnOf(level, t)));
}

/** Радиус ясного круга вокруг собаки: к рассвету шире. */
export function clearRadius(level: Level, t: number): number {
  return level.spec.clear * (1 + 0.7 * smoothstep(0.5, 1, dawnOf(level, t)));
}

/** Свет фонаря: весь загон до углов — ясно (r0), дальше туман сгущается до r. */
export function lanternLight(level: Level): { x: number; y: number; r0: number; r: number } {
  const p = level.pen.inner;
  const half = Math.hypot(p.w, p.h) / 2;
  return { x: p.x + p.w / 2, y: p.y + p.h / 2, r0: half + 4, r: half + 22 };
}

/** Насколько точка (x, y) скрыта туманом, 0–1. */
export function fogAt(level: Level, dog: Point, t: number, x: number, y: number): number {
  const density = fogDensity(level, t);
  if (density <= 0) return 0;
  const r = clearRadius(level, t);
  const kDog = smoothstep(r * 0.55, r, Math.hypot(x - dog.x, y - dog.y));
  if (kDog === 0) return 0;
  const light = lanternLight(level);
  const kPen = smoothstep(light.r0, light.r, Math.hypot(x - light.x, y - light.y));
  return density * kDog * kPen;
}

/** Силуэт в тумане различим не дальше этого от собаки: 1 — ясно, 0 — не видно совсем. */
export function silhouetteAt(level: Level, dog: Point, t: number, x: number, y: number): number {
  const r = clearRadius(level, t);
  return 1 - smoothstep(r * 1.4, r * 2.6, Math.hypot(x - dog.x, y - dog.y));
}

/**
 * Видна ли овца игроку: туман над ней не густой или различим силуэт. При тумане от 0,5 рисунок
 * овцы бледнее трети — такую на лугу не заметить, поэтому она считается скрытой.
 */
export function sheepVisible(level: Level, dog: Point, t: number, x: number, y: number): boolean {
  return fogAt(level, dog, t, x, y) < 0.5 || silhouetteAt(level, dog, t, x, y) > 0.02;
}
