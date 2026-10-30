/**
 * Журнал плейтеста (?playtest): что происходило с живым игроком на каждом уровне. Бэкенда
 * нет, поэтому журнал лежит в браузере, а игрок копирует отчёт и присылает автору. Как его
 * читать и что менять по итогам — docs/playtest.md.
 */

import type { RunResult } from './score';

/** Сколько попыток держать: старые вытесняются, журнал не разрастается. */
export const PLAYTEST_MAX = 300;

export type Controls = 'pointer' | 'keys' | 'none';

export interface Attempt {
  level: number;
  /** Сид, если раскладка не кампании. */
  seed: string | null;
  stars: number;
  saved: number;
  total: number;
  lost: number;
  /** Секунд с первого шага до конца или до того, как игрок бросил уровень. */
  time: number;
  limit: number;
  par: number;
  whistles: number;
  /** Бросил, не доиграв: начал заново или вышел в меню. */
  quit: boolean;
  dawn: boolean;
  controls: Controls;
}

export const attemptOf = (
  r: RunResult,
  seed: string | null,
  controls: Controls,
  quit = false,
): Attempt => ({
  level: r.level,
  seed,
  stars: quit ? 0 : r.stars,
  saved: r.saved,
  total: r.total,
  lost: r.lost,
  time: r.time,
  limit: r.limit,
  par: r.par,
  whistles: r.whistles,
  quit,
  dawn: !quit && r.dawn,
  controls,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Что прочиталось из хранилища; всё незнакомое пропускается. */
export function parseAttempts(raw: unknown): Attempt[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is Attempt =>
      isRecord(a) &&
      typeof a.level === 'number' &&
      typeof a.time === 'number' &&
      typeof a.limit === 'number' &&
      typeof a.total === 'number' &&
      typeof a.saved === 'number' &&
      typeof a.stars === 'number',
  );
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? hi : (hi + (sorted[mid - 1] ?? 0)) / 2;
};

const mmss = (s: number): string => {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Отчёт в Markdown: таблица по уровням и все попытки подряд. */
export function playtestReport(attempts: readonly Attempt[], nowIso: string, version: string) {
  const lines = [
    `Пастух в тумане — отчёт плейтеста, ${nowIso.slice(0, 10)}, версия ${version}`,
    '',
    '| Уровень | Попыток | Брошено | Лучшие ★ | Медиана времени | Доля ночи | Рассветов | Потеряно за попытку |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const levels = [...new Set(attempts.map((a) => a.level))].sort((a, b) => a - b);
  for (const n of levels) {
    const all = attempts.filter((a) => a.level === n);
    const played = all.filter((a) => !a.quit);
    const times = played.map((a) => a.time);
    const limit = all[0]?.limit ?? 1;
    const name = n === 0 ? 'тренировка' : String(n);
    lines.push(
      `| ${name} | ${all.length} | ${all.length - played.length} | ` +
        `${Math.max(0, ...played.map((a) => a.stars))} | ` +
        `${played.length ? mmss(median(times)) : '—'} | ` +
        `${played.length ? `${Math.round((median(times) / limit) * 100)} %` : '—'} | ` +
        `${played.filter((a) => a.dawn).length} | ` +
        `${played.length ? median(played.map((a) => a.lost)) : '—'} |`,
    );
  }
  lines.push('', 'Попытки: уровень, итог, овцы, потеряно, время из ночи, свистки, управление.');
  for (const a of attempts) {
    const end = a.quit ? 'бросил' : a.dawn ? `рассвет, ${a.stars}★` : `${a.stars}★`;
    lines.push(
      `${a.level}${a.seed ? ` (сид ${a.seed})` : ''}: ${end}, ${a.saved}/${a.total}, ` +
        `-${a.lost}, ${mmss(a.time)} из ${mmss(a.limit)}, свистков ${a.whistles}, ${a.controls}`,
    );
  }
  return lines.join('\n');
}
