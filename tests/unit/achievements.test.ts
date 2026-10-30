import { describe, expect, it } from 'vitest';

import {
  ACHIEVEMENT_IDS,
  BIG_FLOCK,
  EARLY_SHARE,
  earnedBy,
  HUNDRED,
  QUIET_FROM,
  type Totals,
} from '@/domain/achievements';
import type { RunResult } from '@/domain/score';
import { SEASONS } from '@/domain/season';

const result = (patch: Partial<RunResult> = {}): RunResult => ({
  level: 4,
  season: 'summer',
  total: 12,
  saved: 12,
  lost: 0,
  time: 100,
  limit: 160,
  par: 75,
  whistles: 2,
  rescued: 0,
  allIn: true,
  dawn: false,
  stars: 2,
  ...patch,
});

const none: Totals = { penned: 0, seasons: [], gold: 0, levels: 12 };

describe('ачивки', () => {
  it('id стабильны: это ключи сохранения', () => {
    expect(ACHIEVEMENT_IDS).toEqual([
      'first-flock',
      'whole-flock',
      'quiet',
      'early',
      'rescuer',
      'big-flock',
      'seasons',
      'hundred',
      'gold',
    ]);
  });

  it('«Первое стадо» — любая звезда; ноль звёзд — ничего', () => {
    expect(earnedBy(result({ stars: 1, allIn: false, saved: 8 }), none)).toContain('first-flock');
    expect(earnedBy(result({ stars: 0, allIn: false, saved: 2 }), none)).toEqual([]);
  });

  it('«Все дома» — всё стадо на уровне кампании, на тренировке — нет', () => {
    expect(earnedBy(result(), none)).toContain('whole-flock');
    expect(earnedBy(result({ level: 0 }), none)).not.toContain('whole-flock');
  });

  it('«Тихий пастух» — без свиста и только с третьего уровня', () => {
    expect(earnedBy(result({ whistles: 0 }), none)).toContain('quiet');
    expect(earnedBy(result({ whistles: 1 }), none)).not.toContain('quiet');
    expect(earnedBy(result({ whistles: 0, level: QUIET_FROM - 1 }), none)).not.toContain('quiet');
  });

  it('«Затемно» — всё стадо за половину ночи', () => {
    expect(earnedBy(result({ time: 160 * EARLY_SHARE }), none)).toContain('early');
    expect(earnedBy(result({ time: 160 * EARLY_SHARE + 1 }), none)).not.toContain('early');
  });

  it('«Из леса» — загнана овца, побывавшая в лесу', () => {
    expect(earnedBy(result({ rescued: 1 }), none)).toContain('rescuer');
  });

  it('«Большая отара» — целиком стадо от BIG_FLOCK овец', () => {
    expect(earnedBy(result({ total: BIG_FLOCK, saved: BIG_FLOCK }), none)).toContain('big-flock');
    expect(
      earnedBy(result({ total: BIG_FLOCK, saved: BIG_FLOCK - 1, allIn: false }), none),
    ).not.toContain('big-flock');
  });

  it('«Круглый год», «Сотня» и «Золотое руно» — по итогам всех игр', () => {
    const all: Totals = { penned: HUNDRED, seasons: [...SEASONS], gold: 12, levels: 12 };
    expect(earnedBy(result(), all)).toEqual(expect.arrayContaining(['seasons', 'hundred', 'gold']));
    const almost: Totals = { penned: HUNDRED - 1, seasons: SEASONS.slice(1), gold: 11, levels: 12 };
    const got = earnedBy(result(), almost);
    expect(got).not.toContain('seasons');
    expect(got).not.toContain('hundred');
    expect(got).not.toContain('gold');
  });
});
