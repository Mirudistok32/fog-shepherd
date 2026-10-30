import { afterAll, describe, expect, it } from 'vitest';

import { clock } from '@/content/texts';
import { campaignLevel, LEVEL_COUNT } from '@/domain/level';
import { resultOf } from '@/domain/score';

import { withBot } from './helpers';

// Бот-пастух играет по тем же правилам, что и человек, только видит сквозь туман. Если он
// загоняет стадо, уровень проходим; его время и потери — мера баланса. `npm run balance`
// печатает таблицу для README («Баланс»).
const table: string[] = [];

describe.each(Array.from({ length: LEVEL_COUNT + 1 }, (_, n) => n))('бот: уровень %i', (n) => {
  const level = campaignLevel(n);
  const { run } = withBot(level);
  const r = resultOf(run, level);
  table[n] =
    `| ${n === 0 ? 'тренировка' : n} | ${level.spec.sheep} | ${clock(level.spec.time)} | ` +
    `${clock(level.spec.par)} | ${clock(r.time)} | ${Math.round((r.time / level.spec.time) * 100)} % | ` +
    `${r.lost} | ${r.whistles} |`;

  it('загоняет всё стадо до рассвета, никого не теряя', () => {
    expect(run.status).toBe('done');
    expect(r.saved).toBe(level.spec.sheep);
    expect(r.lost).toBe(0);
  });

  it('укладывается в норматив: три звезды достижимы', () => {
    expect(r.stars).toBe(3);
  });

  it('с запасом: тратит не больше 70 % ночи', () => {
    expect(r.time).toBeLessThanOrEqual(level.spec.time * 0.7);
  });
});

describe('бот на случайных раскладках', () => {
  const summary: string[] = [];

  it('24 раскладки всех уровней: стадо в загоне до рассвета, потеряна не больше одной овцы', () => {
    for (let k = 0; k < 24; k++) {
      const n = 1 + (k % LEVEL_COUNT);
      const level = campaignLevel(n, `bot-${k}`);
      const { run } = withBot(level);
      const tag = `сид bot-${k}, уровень ${n}`;
      expect(run.status, tag).toBe('done');
      expect(run.lost, tag).toBeLessThanOrEqual(1);
      summary.push(`${tag}: ${clock(run.t)} из ${clock(level.spec.time)}, потеряно ${run.lost}`);
    }
  }, 180_000);

  afterAll(() => {
    console.log(
      [
        '| Уровень | Овец | До рассвета | Норматив ★★★ | Бот | Доля ночи | Потеряно | Свистков |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...table,
        '',
        ...summary,
      ].join('\n'),
    );
  });
});
