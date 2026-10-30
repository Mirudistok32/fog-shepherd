import { describe, expect, it } from 'vitest';

import { HUNDRED } from '@/domain/achievements';
import { LEVEL_COUNT } from '@/domain/level';
import {
  backupFileName,
  emptySave,
  isUnlocked,
  makeBackup,
  mergeSaves,
  parseSave,
  readBackup,
  recordRun,
  type Save,
} from '@/domain/save';
import type { RunResult } from '@/domain/score';
import { SEASONS } from '@/domain/season';

const NOW = '2026-10-30T12:00:00.000Z';

const result = (patch: Partial<RunResult> = {}): RunResult => ({
  level: 1,
  season: 'spring',
  total: 6,
  saved: 6,
  lost: 0,
  time: 50,
  limit: 130,
  par: 35,
  whistles: 1,
  rescued: 0,
  allIn: true,
  dawn: false,
  stars: 2,
  ...patch,
});

describe('разбор сохранения', () => {
  it('пустое сохранение проходит туда и обратно', () => {
    const save = emptySave();
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('мусор и чужие данные — null', () => {
    for (const raw of [null, 42, 'save', [], {}, { schemaVersion: 2 }, { schemaVersion: '1' }]) {
      expect(parseSave(raw)).toBeNull();
    }
  });

  it('повреждённые поля — null, а не тихая подмена', () => {
    expect(parseSave({ schemaVersion: 1, levels: [] })).toBeNull();
    expect(
      parseSave({ schemaVersion: 1, levels: { '3': { stars: 5, saved: 1, time: null } } }),
    ).toBeNull();
    expect(
      parseSave({ schemaVersion: 1, levels: { '3': { stars: 2, saved: -1, time: null } } }),
    ).toBeNull();
    expect(
      parseSave({ schemaVersion: 1, levels: { '3': { stars: 2, saved: 4, time: 'быстро' } } }),
    ).toBeNull();
    expect(
      parseSave({
        schemaVersion: 1,
        stats: { runs: 1.5, flocks: 0, penned: 0, lost: 0, whistles: 0, seasons: [] },
      }),
    ).toBeNull();
    expect(
      parseSave({
        schemaVersion: 1,
        stats: { runs: 1, flocks: 0, penned: 0, lost: 0, whistles: 0, seasons: ['лето'] },
      }),
    ).toBeNull();
  });

  it('незнакомые ачивки и уровни из версии новее пропускаются, остальное читается', () => {
    const save = parseSave({
      schemaVersion: 1,
      sound: false,
      level: 3,
      levels: { '2': { stars: 3, saved: 8, time: 30 }, '99': { stars: 1, saved: 1, time: null } },
      achievements: { 'first-flock': NOW, 'from-future': NOW },
    });
    expect(save?.sound).toBe(false);
    expect(save?.level).toBe(3);
    expect(save?.levels).toEqual({ '2': { stars: 3, saved: 8, time: 30 } });
    expect(save?.achievements).toEqual({ 'first-flock': NOW });
  });

  it('выбранный уровень вне кампании не ломает чтение — берётся тренировка', () => {
    expect(parseSave({ schemaVersion: 1, level: LEVEL_COUNT + 5 })?.level).toBe(0);
  });
});

describe('итог уровня в сохранении', () => {
  it('первая звезда открывает ачивку один раз и следующий уровень', () => {
    const once = recordRun(emptySave(), result(), NOW);
    expect(once.unlocked).toContain('first-flock');
    expect(once.save.achievements['first-flock']).toBe(NOW);
    expect(isUnlocked(once.save, 2)).toBe(true);
    expect(isUnlocked(once.save, 3)).toBe(false);
    const twice = recordRun(once.save, result(), '2026-11-01T00:00:00.000Z');
    expect(twice.unlocked).not.toContain('first-flock');
    expect(twice.save.achievements['first-flock']).toBe(NOW);
  });

  it('без звезды следующий уровень закрыт; тренировка и первый открыты всегда', () => {
    const r = recordRun(emptySave(), result({ saved: 2, allIn: false, stars: 0 }), NOW);
    expect(isUnlocked(r.save, 0)).toBe(true);
    expect(isUnlocked(r.save, 1)).toBe(true);
    expect(isUnlocked(r.save, 2)).toBe(false);
  });

  it('лучшее по уровню: звёзды и овцы — максимум, время — минимум среди «всё стадо»', () => {
    const a = recordRun(emptySave(), result({ time: 50, stars: 2 }), NOW);
    expect(a.record).toBe(true);
    const b = recordRun(a.save, result({ time: 40, stars: 2 }), NOW);
    expect(b.record).toBe(true);
    const c = recordRun(b.save, result({ time: 90, saved: 5, allIn: false, stars: 1 }), NOW);
    expect(c.record).toBe(false);
    expect(c.save.levels['1']).toEqual({ stars: 2, saved: 6, time: 40 });
    expect(c.best).toEqual({ stars: 2, saved: 6, time: 40 });
  });

  it('итоги копятся: игры, стада, овцы, потери, свистки, времена года', () => {
    let save: Save = emptySave();
    save = recordRun(save, result({ lost: 1, saved: 5, allIn: false, stars: 1 }), NOW).save;
    save = recordRun(save, result({ level: 4, season: 'summer' }), NOW).save;
    expect(save.stats).toEqual({
      runs: 2,
      flocks: 1,
      penned: 11,
      lost: 1,
      whistles: 2,
      seasons: ['spring', 'summer'],
    });
  });

  it('«Круглый год», «Сотня» и «Золотое руно» открываются по итогам', () => {
    let save: Save = emptySave();
    let unlocked: string[] = [];
    for (const [i, season] of SEASONS.entries()) {
      ({ save, unlocked } = recordRun(save, result({ level: i * 3 + 1, season }), NOW));
    }
    expect(unlocked).toContain('seasons');
    for (let n = 1; save.stats.penned < HUNDRED; n++) {
      ({ save, unlocked } = recordRun(save, result({ level: 1 + (n % 3) }), NOW));
    }
    expect(save.achievements.hundred).toBeDefined();
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      ({ save, unlocked } = recordRun(save, result({ level: n, stars: 3, time: 30 }), NOW));
    }
    expect(unlocked).toContain('gold');
  });
});

describe('резервная копия', () => {
  const played = recordRun(
    recordRun(emptySave(), result(), NOW).save,
    result({ level: 2, stars: 3, time: 33 }),
    NOW,
  ).save;

  it('имя файла с датой', () => {
    expect(backupFileName(NOW)).toBe('fog-shepherd-backup-2026-10-30.json');
  });

  it('экспорт → чистый браузер → импорт возвращает уровни, ачивки и итоги', () => {
    const read = readBackup(JSON.stringify(makeBackup(played, NOW, '0.1.0'), null, 2));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const restored = mergeSaves(emptySave(), read.save);
    expect(restored.levels).toEqual(played.levels);
    expect(restored.achievements).toEqual(played.achievements);
    expect(restored.stats).toEqual(played.stats);
  });

  it('повторный импорт ничего не меняет', () => {
    expect(mergeSaves(played, played)).toEqual(played);
  });

  it('объединение: лучшее из двух и самая ранняя дата ачивки', () => {
    const mine: Save = {
      ...emptySave(),
      levels: { '1': { stars: 3, saved: 6, time: 30 } },
      achievements: { quiet: '2026-11-02' },
    };
    const theirs: Save = {
      ...emptySave(),
      levels: { '1': { stars: 2, saved: 6, time: 25 }, '2': { stars: 1, saved: 6, time: null } },
      achievements: { quiet: '2026-11-01', early: '2026-11-03' },
    };
    const merged = mergeSaves(mine, theirs);
    expect(merged.levels).toEqual({
      '1': { stars: 3, saved: 6, time: 25 },
      '2': { stars: 1, saved: 6, time: null },
    });
    expect(merged.achievements).toEqual({ quiet: '2026-11-01', early: '2026-11-03' });
  });

  it.each([
    ['', 'empty'],
    ['{"format":"fog', 'not-json'],
    ['{"format":"pigeon-post-backup","schemaVersion":1}', 'foreign'],
    ['{"format":"fog-shepherd-backup","schemaVersion":9,"data":{}}', 'newer'],
    [
      '{"format":"fog-shepherd-backup","schemaVersion":1,"data":{"schemaVersion":1,"levels":[]}}',
      'broken',
    ],
    ['x'.repeat(300_000), 'too-big'],
  ])('понятная ошибка: %#', (text, problem) => {
    expect(readBackup(text)).toEqual({ ok: false, problem });
  });
});
