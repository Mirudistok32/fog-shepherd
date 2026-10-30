/** Детерминированный «случай»: один сид — один и тот же уровень и одно и то же поведение стада. */

export type Rng = () => number;

/**
 * Один шаг mulberry32 над состоянием: [число на [0, 1), новое состояние]. Состояние хранится
 * в данных забега, поэтому симуляция остаётся чистой функцией и воспроизводится.
 */
export function nextRandom(state: number): [number, number] {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** mulberry32: быстрый 32-битный генератор, равномерный на [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    const [value, next] = nextRandom(a);
    a = next;
    return value;
  };
}

/** FNV-1a: сид из строки. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const between = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();

export const intBetween = (rng: Rng, min: number, max: number): number =>
  Math.floor(between(rng, min, max + 1));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick: пустой список');
  return item;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
