/** Тексты, которые подставляются в интерфейс на лету. Статичные — в index.html. */

import {
  type AchievementId,
  BIG_FLOCK,
  EARLY_FROM,
  HUNDRED,
  QUIET_FROM,
} from '@/domain/achievements';
import type { TipId } from '@/domain/coach';
import type { BackupProblem } from '@/domain/save';
import type { Season } from '@/domain/season';

export const LINKS = {
  portfolio: 'https://mirudistok32.github.io/portfolio/',
  telegram: 'https://t.me/postnikov_st',
};

export const SEASON_NAMES: Record<Season, string> = {
  spring: 'Весна',
  summer: 'Лето',
  autumn: 'Осень',
  winter: 'Зима',
};

export const levelName = (n: number): string => (n === 0 ? 'Тренировка' : `Уровень ${n}`);

export const ACHIEVEMENTS: Record<AchievementId, { title: string; desc: string }> = {
  'first-flock': { title: 'Первое стадо', desc: 'Пройти любой уровень хотя бы на одну звезду' },
  'whole-flock': { title: 'Все дома', desc: 'Загнать в загон всё стадо на уровне кампании' },
  quiet: {
    title: 'Тихий пастух',
    desc: `Загнать всё стадо без единого свиста — с ${QUIET_FROM}-го уровня`,
  },
  early: {
    title: 'Затемно',
    desc: `Загнать всё стадо, пока не прошла половина ночи, — с ${EARLY_FROM}-го уровня`,
  },
  rescuer: { title: 'Из леса', desc: 'Вернуть овцу, которая уже ушла в лес, и загнать её' },
  'big-flock': {
    title: 'Большая отара',
    desc: `Загнать целиком стадо из ${BIG_FLOCK} овец и больше`,
  },
  seasons: { title: 'Круглый год', desc: 'Пройти уровень весной, летом, осенью и зимой' },
  hundred: { title: 'Сотня', desc: `Загнать ${HUNDRED} овец за все игры` },
  gold: { title: 'Золотое руно', desc: 'Получить три звезды на всех уровнях' },
};

export const BACKUP_PROBLEMS: Record<BackupProblem, string> = {
  empty: 'Файл пустой.',
  'too-big': 'Файл слишком большой для копии этой игры.',
  'not-json': 'Это не JSON: файл повреждён или не тот.',
  foreign: 'Это копия не от «Пастуха в тумане».',
  newer: 'Копия сделана в более новой версии игры — обновите страницу.',
  broken: 'Копия повреждена: часть полей не читается.',
};

/** Подсказки на первых уровнях: что сделать прямо сейчас. */
export const TIPS: Record<TipId, string> = {
  idle: 'Подбегите к овцам с дальней от загона стороны — они пойдут от собаки к воротам.',
  behind: 'Вы между стадом и загоном. Обойдите овец: ворота должны быть за ними.',
  slow: 'Тише! Бегущая собака пугает сильнее, и стадо разбегается. Подходите не спеша.',
  whistle: 'Стадо разбрелось. Свистните — пробел или кнопка «Свист» — овцы сбегутся в кучу.',
  stray: 'Овца ушла в лес! Бегите за ней и гоните на луг, пока она не потерялась.',
  listen: 'Никого не видно? Ищите круги блеяния: они показывают, где овцы.',
  bridge: 'Овцы не переходят ручей. Гоните их к мостику.',
};

/** 30.10 из 2026-10-30. */
export const dayMonth = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** 1 овца, 2 овцы, 5 овец. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const sheepCount = (n: number) => `${n} ${plural(n, 'овца', 'овцы', 'овец')}`;

export const starsLabel = (n: number) => `${n} ${plural(n, 'звезда', 'звезды', 'звёзд')} из 3`;

/** 95 → «1:35». */
export function clock(s: number): string {
  const total = Math.max(0, Math.ceil(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Что отправить другу: как прошёл уровень и ссылка на ту же раскладку. */
export function shareText(
  r: { stars: number; saved: number; total: number; time: number; allIn: boolean },
  title: string,
  url: string,
): string {
  const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  const time = r.allIn ? `, все за ${clock(r.time)}` : '';
  return `Пастух в тумане — ${title}: ${stars}, ${r.saved} из ${r.total}${time}. Сможете лучше?\n${url}`;
}
