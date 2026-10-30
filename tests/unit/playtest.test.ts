import { describe, expect, it } from 'vitest';

import {
  type Attempt,
  attemptOf,
  parseAttempts,
  PLAYTEST_MAX,
  playtestReport,
} from '@/domain/playtest';
import type { RunResult } from '@/domain/score';
import { createLocalPlaytestLog, PLAYTEST_KEY } from '@/infrastructure/localPlaytestLog';

const result = (over: Partial<RunResult> = {}): RunResult => ({
  level: 2,
  season: 'spring',
  total: 8,
  saved: 8,
  lost: 0,
  time: 70,
  limit: 140,
  par: 40,
  whistles: 1,
  rescued: 0,
  allIn: true,
  dawn: false,
  stars: 2,
  ...over,
});

const attempt = (over: Partial<RunResult> = {}, quit = false): Attempt =>
  attemptOf(result(over), null, 'pointer', quit);

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  } as unknown as Storage;
}

describe('журнал плейтеста', () => {
  it('брошенный уровень — без звёзд и без рассвета', () => {
    const a = attempt({ stars: 2, dawn: true }, true);
    expect(a.quit).toBe(true);
    expect(a.stars).toBe(0);
    expect(a.dawn).toBe(false);
  });

  it('отчёт: по уровням — попытки, брошенные, медиана и доля ночи', () => {
    const text = playtestReport(
      [
        attempt({ time: 60 }),
        attempt({ time: 80, stars: 3 }),
        attempt({ time: 100 }),
        attempt({ time: 5 }, true),
        attempt({ level: 0, total: 3, saved: 3, time: 9, limit: 90, stars: 3 }),
      ],
      '2026-10-30T12:00:00.000Z',
      '0.1.0',
    );
    expect(text).toContain('2026-10-30');
    expect(text).toContain('версия 0.1.0');
    expect(text).toContain('| тренировка | 1 | 0 | 3 | 0:09 | 10 % |');
    expect(text).toContain('| 2 | 4 | 1 | 3 | 1:20 | 57 % | 0 | 0 |');
    expect(text).toContain('бросил');
    expect(text.indexOf('| тренировка')).toBeLessThan(text.indexOf('| 2 |'));
  });

  it('уровень, который только бросали, не ломает таблицу', () => {
    const text = playtestReport([attempt({}, true)], '2026-10-30T12:00:00.000Z', '0.1.0');
    expect(text).toContain('| 2 | 1 | 1 | 0 | — | — | 0 | — |');
  });

  it('чтение пропускает чужое и не падает на не-массиве', () => {
    expect(parseAttempts({ a: 1 })).toEqual([]);
    expect(parseAttempts([{ level: 1 }, 'x', attempt()])).toHaveLength(1);
  });

  it('хранилище: журнал переживает перезапуск, повреждённый — начинается заново', () => {
    const storage = memoryStorage();
    createLocalPlaytestLog(() => storage).add(attempt());
    expect(createLocalPlaytestLog(() => storage).all()).toHaveLength(1);
    const broken = memoryStorage({ [PLAYTEST_KEY]: '{oops' });
    expect(createLocalPlaytestLog(() => broken).all()).toEqual([]);
  });

  it('хранит не больше предела; без хранилища работает в памяти', () => {
    const storage = memoryStorage();
    const log = createLocalPlaytestLog(() => storage);
    for (let i = 0; i < PLAYTEST_MAX + 5; i++) log.add(attempt({ time: i + 1 }));
    expect(log.all()).toHaveLength(PLAYTEST_MAX);
    expect(log.all()[0]?.time).toBe(6);

    const none = createLocalPlaytestLog(() => {
      throw new Error('нет хранилища');
    });
    none.add(attempt());
    expect(none.all()).toHaveLength(1);
  });
});
