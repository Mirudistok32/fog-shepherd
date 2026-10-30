/**
 * Бот-новичок: приближение к живому игроку для проверки баланса. Тактика та же, что у бота
 * (bot.ts), но знает он только то, что видно на экране: овцы — в пределах видимости или там,
 * где в последний раз мелькнули или заблеяли; если никого не знает — обходит луг. Решает раз
 * в REACTION секунд, исполняет с такой же задержкой, целится с ошибкой AIM_ERROR и подбегает
 * к стаду быстрее, чем стоило бы, отвлекается и иногда срывается прямо на стадо. Это модель,
 * а не человек: она показывает, хватает ли ночи тому, кто не видит сквозь туман и ошибается.
 */

import { BOT_START, type BotMemory, shepherd } from './bot';
import { sheepVisible } from './fog';
import type { HerdEvent, Input, Run, Sheep } from './herd';
import type { Level, Point } from './level';
import { nextRandom } from './random';
import { DOG_R, DOG_TOP, FOREST, HORIZON, WORLD_H, WORLD_W } from './world';

/** Секунд между решениями; исполнение отстаёт ещё на одно решение. */
const REACTION = 0.35;
/** Ошибка прицела, единицы луга. */
const AIM_ERROR = 9;
/** Шаг у стада: бот идёт на 0,62, человеку с мышью так точно не сбавить. */
const NEAR_PACE = 0.85;
/** Клетка обхода луга: посмотрел вокруг себя — клетка осмотрена. */
const PATROL_CELL = 40;
const PATROL_COLS = Math.ceil(WORLD_W / PATROL_CELL);
const PATROL_ROWS = Math.ceil(WORLD_H / PATROL_CELL);
/** Осмотреть получается ближе, чем различим силуэт: взгляд не на всём экране сразу. */
const LOOK_R = 70;
/** Доля решений, когда игрок отвлёкся (делает то же, что и раньше) или сорвался прямо на стадо. */
const LAPSE = 0.12;
const SLIP = 0.05;
/** Срыв длится столько решений подряд: собака пробегает сквозь стадо и разгоняет его. */
const SLIP_LEN = 3;

export interface NoviceMemory {
  bot: BotMemory;
  /** Номер овцы → где её видели или слышали в последний раз. */
  known: ReadonlyMap<number, Point>;
  /** Какие клетки луга уже осмотрены. */
  looked: ReadonlySet<number>;
  /** Секунд до следующего решения. */
  wait: number;
  /** Сколько решений ещё длится срыв. */
  slip: number;
  rng: number;
  /** Что игрок делает сейчас и что решил только что (исполнит следующим). */
  input: Input;
  plan: Input;
}

export const noviceStart = (attempt = 0): NoviceMemory => ({
  bot: BOT_START,
  known: new Map(),
  looked: new Set(),
  wait: 0,
  slip: 0,
  rng: (0x2f6e2b1 + attempt * 7919) >>> 0,
  input: { target: null, move: null, whistle: false },
  plan: { target: null, move: null, whistle: false },
});

/** Ближайшая неосмотренная клетка; если осмотрено всё — обход начинается заново. */
function patrol(dog: Point, looked: ReadonlySet<number>): { target: Point; looked: Set<number> } {
  const seen = new Set(looked);
  for (let attempt = 0; attempt < 2; attempt++) {
    let best: Point | null = null;
    let bestD = Infinity;
    for (let row = 0; row < PATROL_ROWS; row++) {
      for (let col = 0; col < PATROL_COLS; col++) {
        if (seen.has(row * PATROL_COLS + col)) continue;
        const x = Math.min(WORLD_W - FOREST - 8, Math.max(FOREST + 8, (col + 0.5) * PATROL_CELL));
        const y = Math.min(WORLD_H - FOREST - 8, Math.max(HORIZON + 8, (row + 0.5) * PATROL_CELL));
        const d = Math.hypot(x - dog.x, y - dog.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return { target: best, looked: seen };
    seen.clear();
  }
  return { target: { x: WORLD_W / 2, y: WORLD_H / 2 }, looked: seen };
}

function look(dog: Point, looked: ReadonlySet<number>): Set<number> {
  const seen = new Set(looked);
  for (let row = 0; row < PATROL_ROWS; row++) {
    for (let col = 0; col < PATROL_COLS; col++) {
      const x = (col + 0.5) * PATROL_CELL;
      const y = (row + 0.5) * PATROL_CELL;
      if (Math.hypot(x - dog.x, y - dog.y) < LOOK_R) seen.add(row * PATROL_COLS + col);
    }
  }
  return seen;
}

function decide(run: Run, level: Level, memory: NoviceMemory): NoviceMemory {
  const known = new Map(memory.known);
  const { dog, t } = run;
  for (const s of run.sheep) {
    if (s.status !== 'free') known.delete(s.id);
    else if (sheepVisible(level, dog, t, s.x, s.y)) known.set(s.id, { x: s.x, y: s.y });
    else {
      // Пришёл туда, где овца была, а её нет: память устарела.
      const was = known.get(s.id);
      if (was && sheepVisible(level, dog, t, was.x, was.y)) known.delete(s.id);
    }
  }
  const ghosts: Sheep[] = [];
  for (const s of run.sheep) {
    const at = known.get(s.id);
    if (!at) continue;
    const seen = sheepVisible(level, dog, t, s.x, s.y);
    ghosts.push(seen ? s : { ...s, x: at.x, y: at.y, vx: 0, vy: 0 });
  }
  let rng = memory.rng;
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  let looked = look(dog, memory.looked);
  let plan: Input;
  let bot = memory.bot;
  let slip = Math.max(0, memory.slip - 1);
  if (ghosts.length > 0 && slip === 0 && rand() < SLIP) slip = SLIP_LEN;
  if (rand() < LAPSE) {
    plan = memory.plan;
  } else if (ghosts.length > 0 && slip > 0) {
    const n = ghosts.length;
    const x = ghosts.reduce((sum, g) => sum + g.x, 0) / n;
    const y = ghosts.reduce((sum, g) => sum + g.y, 0) / n;
    plan = { target: { x, y }, move: null, whistle: false };
  } else if (ghosts.length > 0) {
    const b = shepherd({ ...run, sheep: ghosts }, level, memory.bot);
    bot = b.memory;
    plan = { ...b.input, pace: (b.input.pace ?? 1) < 1 ? NEAR_PACE : 1 };
  } else {
    const p = patrol(dog, looked);
    looked = p.looked;
    plan = { target: p.target, move: null, whistle: false };
  }
  if (plan !== memory.plan && plan.target) {
    const a = rand() * Math.PI * 2;
    const r = rand() * AIM_ERROR;
    plan = {
      ...plan,
      target: {
        x: Math.min(WORLD_W - DOG_R, Math.max(DOG_R, plan.target.x + Math.cos(a) * r)),
        y: Math.min(WORLD_H - DOG_R, Math.max(DOG_TOP, plan.target.y + Math.sin(a) * r)),
      },
    };
  }
  return { ...memory, bot, known, looked, slip, rng, input: memory.plan, plan, wait: REACTION };
}

/** Шаг новичка: events — события прошлого шага (блеяние выдаёт, где овца). */
export function novice(
  run: Run,
  level: Level,
  memory: NoviceMemory,
  events: readonly HerdEvent[],
  dt: number,
): { input: Input; memory: NoviceMemory } {
  let next = memory;
  const bleats = events.filter((e) => e.type === 'bleat');
  if (bleats.length > 0) {
    const known = new Map(memory.known);
    for (const e of bleats) known.set(e.id, { x: e.x, y: e.y });
    next = { ...next, known };
  }
  next = next.wait <= 0 ? decide(run, level, next) : { ...next, wait: next.wait - dt };
  const input = next.input;
  // Свист — одно нажатие, а не удержание на всё время решения.
  return { input, memory: input.whistle ? { ...next, input: { ...input, whistle: false } } : next };
}
