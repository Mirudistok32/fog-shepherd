/** Итог уровня: сколько овец загнано и за сколько, звёзды. */

import type { Run } from './herd';
import type { Level } from './level';
import type { Season } from './season';

export type Stars = 0 | 1 | 2 | 3;

export interface RunResult {
  /** Номер уровня: 0 — тренировка. */
  level: number;
  season: Season;
  total: number;
  saved: number;
  /** Ушли в лес. Остальные незагнанные остались в тумане. */
  lost: number;
  /** Секунд от первого шага до последней овцы в загоне или до рассвета. */
  time: number;
  limit: number;
  par: number;
  whistles: number;
  /** Загнано овец, которые успели побывать в лесу. */
  rescued: number;
  allIn: boolean;
  /** Рассвело раньше, чем стадо оказалось в загоне. */
  dawn: boolean;
  stars: Stars;
}

/** Две трети стада — для одной звезды. */
export const PASS_SHARE = 2 / 3;

/** ★ — две трети стада в загоне, ★★ — всё стадо, ★★★ — всё стадо быстрее норматива. */
export function starsFor(saved: number, total: number, time: number, par: number): Stars {
  if (total <= 0) return 0;
  if (saved >= total) return time <= par ? 3 : 2;
  return saved >= Math.ceil(total * PASS_SHARE - 1e-9) ? 1 : 0;
}

export function resultOf(run: Run, level: Level): RunResult {
  const total = run.sheep.length;
  const time = Math.round(Math.min(run.t, level.spec.time) * 10) / 10;
  return {
    level: level.spec.number,
    season: level.spec.season,
    total,
    saved: run.penned,
    lost: run.lost,
    time,
    limit: level.spec.time,
    par: level.spec.par,
    whistles: run.whistles,
    rescued: run.rescued,
    allIn: run.penned === total,
    dawn: run.status === 'dawn',
    stars: starsFor(run.penned, total, time, level.spec.par),
  };
}
