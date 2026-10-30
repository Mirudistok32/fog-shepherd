/**
 * Подсказки на первых уровнях: смотрит на забег и говорит, что делать, когда игрок делает
 * типичную ошибку или застрял. Каждая подсказка — не больше раза за игру и только пока
 * условие держится: кто играет правильно, тот их не видит.
 */

import { sheepVisible } from './fog';
import type { Run, Sheep } from './herd';
import { towardPen } from './herd';
import { type Level, streamSide } from './level';
import { DOG_SPEED, WHISTLE_R } from './world';

export type TipId = 'idle' | 'behind' | 'slow' | 'whistle' | 'stray' | 'listen' | 'bridge';

/** Подсказки — на тренировке и первых уровнях, пока на уровне нет звезды. */
export const COACH_LEVELS = 3;
/** Сколько подсказка видна и сколько тишины после неё, с. */
export const TIP_TIME = 5;
export const TIP_GAP = 2;
/** Раньше этого снятая подсказка не убирается, даже если всё уже исправлено, с. */
const TIP_MIN = 2;
/** Сколько секунд условие должно держаться, прежде чем подсказка появится. */
const NEED: Record<TipId, number> = {
  stray: 0,
  slow: 0.5,
  behind: 1.5,
  bridge: 1,
  whistle: 2,
  idle: 4,
  listen: 5,
};
/** Порядок важности: потерять овцу хуже, чем пройтись лишний круг. */
const ORDER: readonly TipId[] = ['stray', 'slow', 'behind', 'bridge', 'whistle', 'listen', 'idle'];
/** Дальше этого от собаки игрок стадом не занимается. */
const FLOCK_R = 70;
/** Разбрелись шире этого — самое время свистнуть. */
const SCATTERED_R = 28;

export interface Coach {
  tip: TipId | null;
  /** Сколько секунд текущая подсказка на экране и сколько ждать следующую. */
  shown: number;
  gap: number;
  used: readonly TipId[];
  /** Сколько секунд держится условие каждой подсказки. */
  held: Readonly<Partial<Record<TipId, number>>>;
}

export const COACH_START: Coach = { tip: null, shown: 0, gap: 0, used: [], held: {} };

export const coachFor = (level: number, stars: number): boolean =>
  level <= COACH_LEVELS && stars === 0;

/** Какие подсказки сейчас уместны. */
function conditions(run: Run, level: Level): Set<TipId> {
  const out = new Set<TipId>();
  if (run.status !== 'running') return out;
  const { dog, t } = run;
  const free = run.sheep.filter((s) => s.status === 'free');
  if (free.some((s) => s.stray > 0)) out.add('stray');
  const speed = Math.hypot(dog.vx, dog.vy);
  if (speed < 4) out.add('idle');
  const visible = free.filter((s) => sheepVisible(level, dog, t, s.x, s.y));
  if (free.length > 0 && visible.length === 0) out.add('listen');
  const near = visible.filter((s: Sheep) => Math.hypot(s.x - dog.x, s.y - dog.y) < FLOCK_R);
  if (near.length === 0) return out;
  const n = near.length;
  const x = near.reduce((sum, s) => sum + s.x, 0) / n;
  const y = near.reduce((sum, s) => sum + s.y, 0) / n;
  const closest = Math.min(...near.map((s) => Math.hypot(s.x - dog.x, s.y - dog.y)));
  const alarm = near.reduce((sum, s) => sum + s.alarm, 0) / n;
  if (speed > DOG_SPEED * 0.75 && closest < 34 && alarm > 0.5) out.add('slow');
  const home = towardPen(level, { x, y });
  if ((dog.x - x) * home.x + (dog.y - y) * home.y > 6) out.add('behind');
  const stream = level.stream;
  if (stream && streamSide(stream, { x, y }) !== streamSide(stream, level.pen.mouth))
    out.add('bridge');
  const radius = Math.max(...near.map((s) => Math.hypot(s.x - x, s.y - y)));
  const inReach = near.filter((s) => Math.hypot(s.x - dog.x, s.y - dog.y) <= WHISTLE_R).length;
  if (run.whistles === 0 && run.cooldown === 0 && inReach >= 3 && radius > SCATTERED_R)
    out.add('whistle');
  return out;
}

/** Один кадр подсказок; dt — время кадра, с. */
export function coach(state: Coach, run: Run, level: Level, dt: number): Coach {
  const now = conditions(run, level);
  const held: Partial<Record<TipId, number>> = {};
  for (const id of now) held[id] = (state.held[id] ?? 0) + dt;
  const gap = Math.max(0, state.gap - dt);
  if (state.tip !== null) {
    const shown = state.shown + dt;
    const fixed = !now.has(state.tip) && shown >= TIP_MIN;
    if (shown >= TIP_TIME || fixed || run.status !== 'running') {
      return { ...state, tip: null, shown: 0, gap: TIP_GAP, held };
    }
    return { ...state, shown, gap, held };
  }
  if (gap === 0 || now.has('stray')) {
    for (const id of ORDER) {
      if (state.used.includes(id) || !now.has(id)) continue;
      if ((held[id] ?? 0) < NEED[id]) continue;
      return { tip: id, shown: 0, gap: 0, used: [...state.used, id], held };
    }
  }
  return { ...state, gap, held };
}
