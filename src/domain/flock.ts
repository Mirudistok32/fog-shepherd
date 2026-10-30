/**
 * Правила стаи (boids): разделение, выравнивание, сплочение и бегство от собаки. Каждое —
 * чистая функция «овца и соседи → вектор», поэтому проверяется отдельно; как они
 * смешиваются в желаемую скорость, решает herd.ts.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Body extends Vec {
  vx: number;
  vy: number;
}

export const ZERO: Vec = { x: 0, y: 0 };

export const length = (v: Vec): number => Math.hypot(v.x, v.y);

export function normalize(v: Vec): Vec {
  const l = length(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : ZERO;
}

/** Разделение: прочь от соседей ближе radius; каждый даёт вклад 0–1, тем больше, чем ближе. */
export function separation(me: Vec, others: readonly Vec[], radius: number): Vec {
  let x = 0;
  let y = 0;
  for (const o of others) {
    const dx = me.x - o.x;
    const dy = me.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d >= radius || d < 1e-9) continue;
    const k = 1 - d / radius;
    x += (dx / d) * k;
    y += (dy / d) * k;
  }
  return { x, y };
}

/** Выравнивание: на сколько скорость соседей в среднем отличается от своей. */
export function alignment(me: Body, others: readonly Body[]): Vec {
  if (others.length === 0) return ZERO;
  let x = 0;
  let y = 0;
  for (const o of others) {
    x += o.vx;
    y += o.vy;
  }
  return { x: x / others.length - me.vx, y: y / others.length - me.vy };
}

/** Сплочение: к центру соседей; длина 0–1 и растёт с расстоянием до центра (полная — от scale). */
export function cohesion(me: Vec, others: readonly Vec[], scale: number): Vec {
  if (others.length === 0) return ZERO;
  let x = 0;
  let y = 0;
  for (const o of others) {
    x += o.x;
    y += o.y;
  }
  const dx = x / others.length - me.x;
  const dy = y / others.length - me.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return ZERO;
  const k = Math.min(1, d / scale);
  return { x: (dx / d) * k, y: (dy / d) * k };
}

/** Бегство: прочь от собаки; длина 0–1 — 1 вплотную, 0 на границе radius и дальше. */
export function flee(me: Vec, dog: Vec, radius: number): Vec {
  const dx = me.x - dog.x;
  const dy = me.y - dog.y;
  const d = Math.hypot(dx, dy);
  if (d >= radius) return ZERO;
  if (d < 1e-9) return { x: 0, y: -1 };
  const k = 1 - d / radius;
  return { x: (dx / d) * k, y: (dy / d) * k };
}
