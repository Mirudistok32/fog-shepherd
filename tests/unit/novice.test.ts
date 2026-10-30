import { afterAll, describe, expect, it } from 'vitest';

import { clock } from '@/content/texts';
import { sheepVisible } from '@/domain/fog';
import { type HerdEvent, type Run, startRun, step } from '@/domain/herd';
import { campaignLevel, LEVEL_COUNT } from '@/domain/level';
import { novice, type NoviceMemory, noviceStart } from '@/domain/novice';
import { resultOf, type RunResult } from '@/domain/score';

import { DT, withBot } from './helpers';

// Бот-новичок не видит сквозь туман, реагирует с задержкой, целится с ошибкой и срывается на
// стадо. Это модель, а не человек, но она проверяет то, чего не может обычный бот: хватает ли
// ночи тому, кто знает только то, что видно на экране (`npm run balance`, README → «Баланс»).
const ATTEMPTS = 3;

function play(n: number, attempt: number, each?: (run: Run, memory: NoviceMemory) => void) {
  const level = campaignLevel(n);
  let run = startRun(level);
  let memory = noviceStart(attempt);
  let events: HerdEvent[] = [];
  while (run.status !== 'done' && run.status !== 'dawn') {
    const b = novice(run, level, memory, events, DT);
    memory = b.memory;
    const r = step(run, level, b.input, DT);
    run = r.run;
    events = r.events;
    each?.(run, memory);
  }
  return resultOf(run, level);
}

const median = (v: readonly number[]) =>
  [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;

const table: string[] = [];

describe.each(Array.from({ length: LEVEL_COUNT + 1 }, (_, n) => n))('новичок: уровень %i', (n) => {
  const level = campaignLevel(n);
  const results: RunResult[] = Array.from({ length: ATTEMPTS }, (_, a) => play(n, a));
  const bot = resultOf(withBot(level).run, level);
  const times = results.map((r) => r.time);
  table[n] =
    `| ${n === 0 ? 'тренировка' : n} | ${clock(level.spec.time)} | ${clock(bot.time)} | ` +
    `${clock(median(times))} | ${clock(Math.max(...times))} | ` +
    `${Math.round((median(times) / level.spec.time) * 100)} % | ` +
    `${Math.max(...results.map((r) => r.lost))} | ` +
    `${results.map((r) => '★'.repeat(r.stars)).join(' ')} |`;

  it('во всех попытках — хотя бы одна звезда: уровень проходим без зрения сквозь туман', () => {
    for (const r of results) expect(r.stars).toBeGreaterThanOrEqual(1);
  });

  it('в среднем успевает с запасом: медиана — не больше 90 % ночи', () => {
    expect(median(times)).toBeLessThanOrEqual(level.spec.time * 0.9);
  });
});

describe('модель новичка', () => {
  it('не знает об овцах в тумане: узнаёт только увиденных и заблеявших', () => {
    const level = campaignLevel(12);
    const start = startRun(level);
    const known = novice(start, level, noviceStart(), [], DT).memory.known;
    for (const s of start.sheep) {
      expect(known.has(s.id), `овца ${s.id}`).toBe(sheepVisible(level, start.dog, 0, s.x, s.y));
    }
    expect(known.size).toBeLessThan(start.sheep.length);
    const far = start.sheep.find((s) => !known.has(s.id));
    if (!far) throw new Error('все овцы видны с первого шага');
    const heard = novice(
      start,
      level,
      noviceStart(),
      [{ type: 'bleat', id: far.id, x: far.x, y: far.y, lonely: true }],
      DT,
    );
    expect(heard.memory.known.get(far.id)).toEqual({ x: far.x, y: far.y });
  });

  it('воспроизводима: одна попытка — один и тот же итог, разные попытки — разные', () => {
    expect(play(2, 1)).toEqual(play(2, 1));
    expect(play(2, 1).time).not.toBe(play(2, 2).time);
  });

  it('медленнее бота, который видит всё: на туманных уровнях модель не «читерит»', () => {
    for (const n of [5, 9]) {
      const level = campaignLevel(n);
      const bot = resultOf(withBot(level).run, level);
      const times = [0, 1, 2].map((a) => play(n, a).time);
      expect(median(times), `уровень ${n}`).toBeGreaterThan(bot.time);
    }
  }, 60_000);
});

afterAll(() => {
  console.log(
    [
      '| Уровень | До рассвета | Бот | Новичок, медиана | Новичок, худшее | Доля ночи | Потеряно, макс. | Звёзды по попыткам |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...table,
    ].join('\n'),
  );
});
