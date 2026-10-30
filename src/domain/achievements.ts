import type { RunResult } from './score';
import { type Season, SEASONS } from './season';

/** id ачивок — ключи в сохранении: не переименовывать без миграции. */
export const ACHIEVEMENT_IDS = [
  'first-flock',
  'whole-flock',
  'quiet',
  'early',
  'rescuer',
  'big-flock',
  'seasons',
  'hundred',
  'gold',
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export const isAchievementId = (value: unknown): value is AchievementId =>
  typeof value === 'string' && (ACHIEVEMENT_IDS as readonly string[]).includes(value);

/** С какого уровня считается «Тихий пастух» и «Затемно»: на первых это слишком просто. */
export const QUIET_FROM = 3;
export const EARLY_FROM = 2;
/** «Затемно» — всё стадо в загоне, а прошло не больше этой доли ночи. */
export const EARLY_SHARE = 0.5;
export const BIG_FLOCK = 30;
export const HUNDRED = 100;

/** Накопленное за все игры — от этого зависят ачивки «на всё время» (уже с этой игрой). */
export interface Totals {
  penned: number;
  /** Времена года, в которые пройден хотя бы один уровень. */
  seasons: readonly Season[];
  /** Сколько уровней кампании пройдено на три звезды и сколько их всего. */
  gold: number;
  levels: number;
}

/** Какие ачивки заслужены этой игрой с учётом итогов. */
export function earnedBy(r: RunResult, totals: Totals): AchievementId[] {
  const out: AchievementId[] = [];
  const campaign = r.level >= 1;
  if (r.stars >= 1) out.push('first-flock');
  if (campaign && r.allIn) out.push('whole-flock');
  if (r.level >= QUIET_FROM && r.allIn && r.whistles === 0) out.push('quiet');
  if (r.level >= EARLY_FROM && r.allIn && r.time <= r.limit * EARLY_SHARE) out.push('early');
  if (r.rescued >= 1) out.push('rescuer');
  if (r.allIn && r.total >= BIG_FLOCK) out.push('big-flock');
  if (SEASONS.every((s) => totals.seasons.includes(s))) out.push('seasons');
  if (totals.penned >= HUNDRED) out.push('hundred');
  if (totals.levels > 0 && totals.gold >= totals.levels) out.push('gold');
  return out;
}
