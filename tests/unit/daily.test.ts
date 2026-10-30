import { describe, expect, it } from 'vitest';

import { dailyDate, dailyLevel, dailyQuery, dailySeed } from '@/domain/daily';
import { campaignLevel } from '@/domain/level';

import { withBot } from './helpers';

const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString());

describe('задание дня', () => {
  it('сид — из даты: сутки один, назавтра другой', () => {
    expect(dailySeed('2026-10-30T23:59:00.000Z')).toBe('day-2026-10-30');
    expect(dailySeed('2026-10-30T00:00:00.000Z')).toBe('day-2026-10-30');
    expect(dailySeed('2026-10-31T00:00:00.000Z')).toBe('day-2026-10-31');
  });

  it('уровень зависит только от сида, в пределах 3–10, и не один и тот же', () => {
    const levels = days.map((d) => dailyLevel(dailySeed(d)));
    for (const n of levels) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(10);
    }
    expect(new Set(levels).size).toBeGreaterThan(3);
    expect(dailyLevel('day-2026-10-30')).toBe(dailyLevel('day-2026-10-30'));
  });

  it('ссылка — обычный ?seed= и ?level=', () => {
    const q = new URLSearchParams(dailyQuery('2026-10-30T12:00:00.000Z'));
    expect(q.get('seed')).toBe('day-2026-10-30');
    expect(q.get('level')).toBe(String(dailyLevel('day-2026-10-30')));
  });

  it('дата узнаётся только у сида задания дня', () => {
    expect(dailyDate('day-2026-10-30')).toBe('2026-10-30');
    expect(dailyDate('day-завтра')).toBeNull();
    expect(dailyDate('e2e')).toBeNull();
    expect(dailyDate(null)).toBeNull();
  });

  it('бот проходит неделю заданий дня: раскладки играбельны', () => {
    for (const d of days.slice(0, 7)) {
      const seed = dailySeed(d);
      const n = dailyLevel(seed);
      const level = campaignLevel(n, seed);
      const { run } = withBot(level);
      expect(run.status, `${seed}, уровень ${n}`).toBe('done');
      expect(run.lost, `${seed}, уровень ${n}`).toBeLessThanOrEqual(1);
    }
  }, 120_000);
});
