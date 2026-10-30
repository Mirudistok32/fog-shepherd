/**
 * Бот-пастух ведёт собаку сам, без DOM. Эвристика Стрёмбома и соавторов (2014): если
 * кучка разбрелась — собрать, зайдя за самую дальнюю овцу; если собрана — гнать, встав
 * позади неё на пути к загону. Путь берётся из поля расстояний (navigation.ts), поэтому
 * стадо идёт в обход заборов и через мостик. Бот играет в демо меню и в режиме ?autopilot,
 * а в тесте доказывает, что каждый уровень проходим, и меряет баланс.
 */

import { blockedAt } from './grid';
import { type Input, type Run, type Sheep, towardPen } from './herd';
import { forestDistance, type Level, type Point } from './level';
import { navAt } from './navigation';
import { DOG_R, DOG_TOP, FLEE_R, WHISTLE_R, WORLD_H, WORLD_W } from './world';

export interface BotMemory {
  /** Овца, на которой держится внимание: по ней находится «своя» кучка между шагами. */
  focus: number | null;
}

export const BOT_START: BotMemory = { focus: null };

/** Овцы ближе этого — одна кучка. */
const LINK = 24;
/** Кучка ближе этого к лесу — срочно: овцу вот-вот потеряем. */
const URGENT_EDGE = 18;

export interface Cluster {
  members: Sheep[];
  x: number;
  y: number;
  /** Самая дальняя овца от центра. */
  radius: number;
  /** Путь от центра до загона. */
  nav: number;
  /** Ближайшая к лесу овца: расстояние до опушки (меньше нуля — уже в лесу). */
  edge: number;
}

const hypot = Math.hypot;

/** Между точками нет забора, куста или воды: овцы по разные стороны забора — разные кучки. */
function clearLine(level: Level, a: Point, b: Point): boolean {
  const n = Math.ceil(hypot(b.x - a.x, b.y - a.y) / 2);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    if (blockedAt(level.grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

export function clustersOf(free: readonly Sheep[], level: Level): Cluster[] {
  const seen = new Array<boolean>(free.length).fill(false);
  const out: Cluster[] = [];
  for (let i = 0; i < free.length; i++) {
    if (seen[i]) continue;
    seen[i] = true;
    const members: Sheep[] = [];
    const queue = [i];
    while (queue.length > 0) {
      const k = queue.pop() as number;
      const s = free[k] as Sheep;
      members.push(s);
      for (let j = 0; j < free.length; j++) {
        if (seen[j]) continue;
        const o = free[j] as Sheep;
        if (hypot(o.x - s.x, o.y - s.y) <= LINK && clearLine(level, s, o)) {
          seen[j] = true;
          queue.push(j);
        }
      }
    }
    const x = members.reduce((sum, s) => sum + s.x, 0) / members.length;
    const y = members.reduce((sum, s) => sum + s.y, 0) / members.length;
    let radius = 0;
    let nav = Infinity;
    let edge = Infinity;
    for (const s of members) {
      radius = Math.max(radius, hypot(s.x - x, s.y - y));
      nav = Math.min(nav, navAt(level.nav, level.grid, s.x, s.y));
      edge = Math.min(edge, forestDistance(s));
    }
    out.push({ members, x, y, radius, nav, edge });
  }
  return out;
}

function choose(groups: Cluster[], run: Run, memory: BotMemory): Cluster {
  const dog = run.dog;
  const urgent = groups.filter((g) => g.edge < URGENT_EDGE);
  let chosen =
    memory.focus === null
      ? undefined
      : groups.find((g) => g.members.some((s) => s.id === memory.focus));
  // Кто-то уходит в лес — бросаем текущую кучку, если она не у самых ворот.
  if (chosen && urgent.length > 0 && !urgent.includes(chosen) && chosen.nav > 36)
    chosen = undefined;
  if (chosen) return chosen;
  const pool = urgent.length > 0 ? urgent : groups;
  let best = pool[0] as Cluster;
  let bestCost = Infinity;
  for (const g of pool) {
    const away = hypot(g.x - dog.x, g.y - dog.y);
    const cost = urgent.length > 0 ? g.edge * 3 + away * 0.5 : g.nav + away * 0.6;
    if (cost < bestCost) {
      bestCost = cost;
      best = g;
    }
  }
  return best;
}

/** Обход стада по кругу радиуса rho, чтобы не пробежать сквозь него и не разогнать. */
export function around(dog: Point, target: Point, c: Point, rho: number): Point {
  const dx = target.x - dog.x;
  const dy = target.y - dog.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return target;
  const k = Math.min(1, Math.max(0, ((c.x - dog.x) * dx + (c.y - dog.y) * dy) / l2));
  const near = hypot(c.x - (dog.x + dx * k), c.y - (dog.y + dy * k));
  if (near >= rho) return target;
  const dDog = hypot(dog.x - c.x, dog.y - c.y);
  if (dDog < rho * 0.9) {
    // Собака уже слишком близко — сначала отойти наружу.
    const ux = dDog > 1e-6 ? (dog.x - c.x) / dDog : 0;
    const uy = dDog > 1e-6 ? (dog.y - c.y) / dDog : 1;
    return { x: c.x + ux * (rho + 6), y: c.y + uy * (rho + 6) };
  }
  const from = Math.atan2(dog.y - c.y, dog.x - c.x);
  let delta = Math.atan2(target.y - c.y, target.x - c.x) - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const a = from + Math.sign(delta) * Math.min(Math.abs(delta), 0.7);
  return { x: c.x + Math.cos(a) * rho, y: c.y + Math.sin(a) * rho };
}

const clampToField = (p: Point): Point => ({
  x: Math.min(WORLD_W - DOG_R - 1, Math.max(DOG_R + 1, p.x)),
  y: Math.min(WORLD_H - DOG_R - 1, Math.max(DOG_TOP + 1, p.y)),
});

/** Куда гнать кучку: среднее направлений к загону по каждой овце. */
function driveDir(g: Cluster, level: Level): Point {
  let x = 0;
  let y = 0;
  for (const s of g.members) {
    const f = towardPen(level, s);
    x += f.x;
    y += f.y;
  }
  const l = hypot(x, y);
  return l > 1e-6 ? { x: x / l, y: y / l } : { x: -level.pen.out.x, y: -level.pen.out.y };
}

export function shepherd(
  run: Run,
  level: Level,
  memory: BotMemory,
): { input: Input; memory: BotMemory } {
  const free = run.sheep.filter((s) => s.status === 'free');
  if (free.length === 0) {
    return {
      input: { target: { x: run.dog.x, y: run.dog.y }, move: null, whistle: false },
      memory: BOT_START,
    };
  }
  const groups = clustersOf(free, level);
  const g = choose(groups, run, memory);
  const c = { x: g.x, y: g.y };
  const n = g.members.length;
  const compact = 6 + 5 * Math.sqrt(n);
  let target: Point;
  if (g.radius > compact) {
    // Собрать: зайти за самую дальнюю овцу и подтолкнуть её к центру.
    let far = g.members[0] as Sheep;
    let farD = -1;
    for (const s of g.members) {
      const d = hypot(s.x - c.x, s.y - c.y);
      if (d > farD) {
        farD = d;
        far = s;
      }
    }
    const ux = (far.x - c.x) / (farD || 1);
    const uy = (far.y - c.y) / (farD || 1);
    target = { x: far.x + ux * 10, y: far.y + uy * 10 };
  } else {
    // Гнать: встать позади кучки на продолжении пути к загону.
    const dir = driveDir(g, level);
    const back = g.radius + 13;
    target = { x: c.x - dir.x * back, y: c.y - dir.y * back };
  }
  const dog = run.dog;
  const step = around(dog, target, c, g.radius + 20);
  const distToFlock = hypot(dog.x - c.x, dog.y - c.y);
  const pace = distToFlock < g.radius + FLEE_R + 10 ? 0.62 : 1;
  const whistle =
    run.cooldown === 0 && n >= 3 && g.radius > compact * 1.5 && distToFlock < WHISTLE_R * 0.8;
  const anchor = g.members.reduce((best, s) =>
    hypot(s.x - c.x, s.y - c.y) < hypot(best.x - c.x, best.y - c.y) ? s : best,
  );
  return {
    input: { target: clampToField(step), move: null, whistle, pace },
    memory: { focus: anchor.id },
  };
}
