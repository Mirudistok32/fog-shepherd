/**
 * Задание дня: одна раскладка на всех на сутки (по UTC). Это обычный режим ?seed= с сидом
 * из даты: ссылка работает у любого, а итог, как и у любого своего сида, не идёт в рекорды.
 */

import { LEVEL_COUNT } from './level';
import { hashString } from './random';

/** Какие уровни годятся: не самые простые и не самые длинные. */
const FROM = 3;
const TO = Math.min(10, LEVEL_COUNT);

const SEED = /^day-(\d{4}-\d{2}-\d{2})$/;

export const dailySeed = (nowIso: string): string => `day-${nowIso.slice(0, 10)}`;

/** Трудность зависит только от даты: у всех в этот день один и тот же уровень. */
export const dailyLevel = (seed: string): number => FROM + (hashString(seed) % (TO - FROM + 1));

/** Адрес задания дня относительно страницы. */
export function dailyQuery(nowIso: string): string {
  const seed = dailySeed(nowIso);
  return `?seed=${seed}&level=${dailyLevel(seed)}`;
}

/** Дата задания, если сид — задание дня. */
export const dailyDate = (seed: string | null): string | null =>
  seed === null ? null : (SEED.exec(seed)?.[1] ?? null);
