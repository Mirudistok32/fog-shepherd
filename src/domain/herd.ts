/**
 * Стадо и собака: один шаг симуляции — чистая функция (забег, уровень, ввод, dt) →
 * (забег, события). Случайность берётся из состояния забега, поэтому шаг воспроизводим;
 * игра всегда шагает по 1/120 с, и поведение не зависит от частоты кадров экрана.
 */

import { moveCircle, penetration, wallNormal } from './collision';
import { alignment, cohesion, flee, separation, type Vec } from './flock';
import { waterAt } from './grid';
import { forestDistance, inForest, type Level, type Point, type Rect } from './level';
import { flowDir } from './navigation';
import { nextRandom } from './random';
import {
  ALARM_FALL,
  ALARM_RISE,
  ARRIVE_R,
  BRIDGE_PULL_R,
  CALM,
  CONTAGION,
  DOG_ACCEL,
  DOG_R,
  DOG_SPEED,
  DOG_SWIM,
  DOG_TOP,
  FLEE_R,
  GATE_PULL_R,
  HEAR_R,
  LONELY_R,
  MEADOW,
  NEIGHBOR_R,
  SEPARATION_CALM,
  SEPARATION_R,
  SHEEP_ACCEL_ALARM,
  SHEEP_ACCEL_CALM,
  SHEEP_R,
  SHEEP_RUN,
  SHEEP_TROT,
  SHEEP_WALK,
  STRAY_LOST,
  WARY_R,
  WHISTLE_COOLDOWN,
  WHISTLE_GATHER,
  WHISTLE_R,
  WORLD_H,
  WORLD_W,
} from './world';

export type SheepStatus = 'free' | 'penned' | 'lost';

export interface Sheep {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Тревога 0–1: растёт рядом с собакой, передаётся соседям и медленно спадает. */
  alarm: number;
  /** Спокойная овца то щиплет траву, то переходит на шаг. */
  mode: 'graze' | 'walk';
  timer: number;
  /** Куда идёт спокойная овца (единичный вектор). */
  hx: number;
  hy: number;
  /** Сколько ещё секунд овца сбивается к точке свиста. */
  gather: number;
  gx: number;
  gy: number;
  /** Куда смотрит рисунок: -1 влево, 1 вправо. Меняется с запасом, чтобы не мигать. */
  face: number;
  status: SheepStatus;
  /** Сколько секунд овца в лесу сейчас и была ли там вообще. */
  stray: number;
  strayed: boolean;
  /** Отбилась от стада в начале: одна бредёт к лесу. */
  wanderer: boolean;
  /** Секунд до следующего блеяния. */
  bleat: number;
  /** Сглаженная скорость за последние доли секунды: по ней видно, что овца топчется. */
  mx: number;
  my: number;
  /** Сколько секунд овца топчется на месте, хотя хочет бежать. */
  stuck: number;
  /** Принятое решение: скользить вдоль стены (slide) или рвануть из тупика (dash), секунд. */
  slide: number;
  dash: number;
  /** Куда и с какой скоростью (ед/с) по этому решению. */
  bx: number;
  by: number;
  bs: number;
}

export interface Dog {
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  swim: boolean;
}

/** ready — ждёт первого движения игрока; done — все овцы в загоне или в лесу; dawn — рассвело. */
export type RunStatus = 'ready' | 'running' | 'done' | 'dawn';

export interface Run {
  status: RunStatus;
  t: number;
  rng: number;
  dog: Dog;
  sheep: readonly Sheep[];
  /** Секунд до следующего свиста. */
  cooldown: number;
  whistles: number;
  penned: number;
  lost: number;
  /** Загнано овец, которые побывали в лесу. */
  rescued: number;
}

export interface Input {
  /** Куда бежать: курсор, палец или бот; null — стоять. */
  target: Point | null;
  /** Направление с клавиатуры; если есть, цель не учитывается. */
  move: Point | null;
  whistle: boolean;
  /** Доля скорости 0–1: бот подходит к стаду шагом. */
  pace?: number;
}

export const IDLE: Input = { target: null, move: null, whistle: false };

export type HerdEvent =
  | { type: 'start' }
  | { type: 'whistle'; x: number; y: number; count: number }
  | { type: 'bleat'; id: number; x: number; y: number; lonely: boolean }
  | { type: 'penned'; id: number; x: number; y: number; count: number }
  | { type: 'stray'; id: number; x: number; y: number }
  | { type: 'back'; id: number }
  | { type: 'lost'; id: number; x: number; y: number; count: number }
  | { type: 'done' }
  | { type: 'dawn' };

const hypot = Math.hypot;

/** Интервал до следующего блеяния: в лесу и в одиночку овца зовёт чаще. */
function bleatGap(r: number, s: Pick<Sheep, 'status' | 'stray'>, lonely: boolean): number {
  if (s.status === 'penned') return 25 + r * 25;
  if (s.stray > 0) return 1.4 + r;
  if (lonely) return 3 + r * 2;
  return 18 + r * 18;
}

export function startRun(level: Level): Run {
  let rng = (level.seed ^ 0x5bd1e995) >>> 0;
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  const wanderers = new Set(level.wanderers);
  const sheep: Sheep[] = level.sheep.map((p, id) => {
    const a = rand() * Math.PI * 2;
    return {
      id,
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      alarm: 0,
      mode: 'graze',
      timer: 0.5 + rand() * 4,
      hx: Math.cos(a),
      hy: Math.sin(a),
      gather: 0,
      gx: p.x,
      gy: p.y,
      face: rand() < 0.5 ? -1 : 1,
      status: 'free',
      stray: 0,
      strayed: false,
      wanderer: wanderers.has(id),
      bleat: 1 + rand() * (wanderers.has(id) ? 3 : 14),
      mx: 0,
      my: 0,
      stuck: 0,
      slide: 0,
      dash: 0,
      bx: 0,
      by: 0,
      bs: 0,
    };
  });
  return {
    status: 'ready',
    t: 0,
    rng,
    dog: { x: level.dog.x, y: level.dog.y, vx: 0, vy: 0, face: 1, swim: false },
    sheep,
    cooldown: 0,
    whistles: 0,
    penned: 0,
    lost: 0,
    rescued: 0,
  };
}

/* ---------- собака ---------- */

/** Собака перепрыгивает заборы и кусты, переплывает ручей и бегает вдоль плетня, но не уходит с луга. */
export function moveDog(d: Dog, level: Level, input: Input, dt: number): Dog {
  const swim = waterAt(level.grid, d.x, d.y);
  const max = DOG_SPEED * Math.min(1, Math.max(0, input.pace ?? 1)) * (swim ? DOG_SWIM : 1);
  let wx = 0;
  let wy = 0;
  if (input.move) {
    const l = hypot(input.move.x, input.move.y);
    if (l > 1e-9) {
      wx = (input.move.x / l) * max;
      wy = (input.move.y / l) * max;
    }
  } else if (input.target) {
    const dx = input.target.x - d.x;
    const dy = input.target.y - d.y;
    const l = hypot(dx, dy);
    if (l > 0.75) {
      const speed = max * Math.min(1, l / ARRIVE_R);
      wx = (dx / l) * speed;
      wy = (dy / l) * speed;
    }
  }
  let ax = wx - d.vx;
  let ay = wy - d.vy;
  const al = hypot(ax, ay);
  const limit = DOG_ACCEL * dt;
  if (al > limit) {
    ax *= limit / al;
    ay *= limit / al;
  }
  let vx = d.vx + ax;
  let vy = d.vy + ay;
  let x = d.x + vx * dt;
  let y = d.y + vy * dt;
  const x0 = DOG_R;
  const x1 = WORLD_W - DOG_R;
  const y0 = DOG_TOP;
  const y1 = WORLD_H - DOG_R;
  if (x < x0 || x > x1) {
    x = Math.min(x1, Math.max(x0, x));
    vx = 0;
  }
  if (y < y0 || y > y1) {
    y = Math.min(y1, Math.max(y0, y));
    vy = 0;
  }
  const face = vx > 3 ? 1 : vx < -3 ? -1 : d.face;
  return { x, y, vx, vy, face, swim: waterAt(level.grid, x, y) };
}

/* ---------- овцы ---------- */

/** Внутри прямоугольника с отступом m от стенок. */
export const within = (p: Point, r: Rect, m: number): boolean =>
  p.x >= r.x + m && p.x <= r.x + r.w - m && p.y >= r.y + m && p.y <= r.y + r.h - m;

/** Единичный вектор от ближайшей кромки леса вглубь луга. */
function inward(p: Point): Vec {
  const left = p.x - MEADOW.x0;
  const right = MEADOW.x1 - p.x;
  const bottom = MEADOW.y1 - p.y;
  const m = Math.min(left, right, bottom);
  return m === left ? { x: 1, y: 0 } : m === right ? { x: -1, y: 0 } : { x: 0, y: -1 };
}

interface Want {
  x: number;
  y: number;
  /** Предел скорости и насколько резко можно её менять (0 — спокойно, 1 — в испуге). */
  max: number;
  urgency: number;
  /** Как сильно испуганная овца хочет бежать (до стен). */
  push: number;
  /** Упёрлась почти в лоб или в угол: нормаль стены; null — скользит свободно. */
  pressed: Vec | null;
}

interface Senses {
  others: Sheep[];
  /** Ближайшая овца, которую слышно (для свободной — и загнанные). */
  nearest: number;
  nx: number;
  ny: number;
  contagion: number;
}

function sense(all: readonly Sheep[], i: number): Senses {
  const me = all[i] as Sheep;
  const others: Sheep[] = [];
  let nearest = Infinity;
  let nx = me.x;
  let ny = me.y;
  let contagion = 0;
  for (let j = 0; j < all.length; j++) {
    if (j === i) continue;
    const o = all[j] as Sheep;
    if (o.status === 'lost') continue;
    if (me.status === 'penned' && o.status !== 'penned') continue;
    const d = hypot(o.x - me.x, o.y - me.y);
    if (d < nearest) {
      nearest = d;
      nx = o.x;
      ny = o.y;
    }
    if (o.status !== me.status || d >= NEIGHBOR_R) continue;
    others.push(o);
    contagion = Math.max(contagion, o.alarm);
  }
  return { others, nearest, nx, ny, contagion };
}

/**
 * Куда пойти спокойной овце: у самых ворот — в загон, в стаде — к своим, отбившаяся — к
 * стаду или к лесу.
 */
function calmHeading(me: Sheep, s: Senses, level: Level, rand: () => number): Vec {
  const a = rand() * Math.PI * 2;
  let hx = Math.cos(a);
  let hy = Math.sin(a);
  if (me.status === 'penned') return { x: hx, y: hy };
  const mouth = level.pen.mouth;
  if (hypot(me.x - mouth.x, me.y - mouth.y) < GATE_PULL_R) {
    const f = towardPen(level, me);
    const l = hypot(f.x + hx * 0.2, f.y + hy * 0.2) || 1;
    return { x: (f.x + hx * 0.2) / l, y: (f.y + hy * 0.2) / l };
  }
  const lonely = s.nearest > LONELY_R;
  const lost = lonely && me.wanderer;
  if (lost) {
    // Отбившаяся бредёт к опушке: там трава выше, а стада не слышно.
    const f = inward(me);
    hx = hx * 0.5 - f.x;
    hy = hy * 0.5 - f.y;
  } else if (lonely && s.nearest <= HEAR_R) {
    const dx = s.nx - me.x;
    const dy = s.ny - me.y;
    const d = hypot(dx, dy);
    hx = hx * 0.3 + dx / d;
    hy = hy * 0.3 + dy / d;
  } else if (s.others.length > 0) {
    const c = cohesion(me, s.others, 12);
    hx += c.x * 0.9;
    hy += c.y * 0.9;
  }
  if (!lost && forestDistance(me) < 26) {
    const f = inward(me);
    hx += f.x * 1.4;
    hy += f.y * 1.4;
  }
  const l = hypot(hx, hy);
  return l > 1e-9 ? { x: hx / l, y: hy / l } : { x: 1, y: 0 };
}

function desire(
  all: readonly Sheep[],
  i: number,
  me: Sheep,
  dog: Dog,
  level: Level,
  rand: () => number,
  dt: number,
): Want {
  const s = sense(all, i);
  const dx = me.x - dog.x;
  const dy = me.y - dog.y;
  const pace = Math.min(1, hypot(dog.vx, dog.vy) / DOG_SPEED);
  const scare = flee(me, dog, FLEE_R);
  // Бегущая собака пугает сильнее сидящей; в загоне овцы почти спокойны.
  let threat = hypot(scare.x, scare.y) * (0.6 + 0.4 * pace);
  if (me.status === 'penned') threat *= 0.5;
  let alarmTo = Math.min(1, Math.max(threat * 2, s.contagion * CONTAGION));
  if (me.gather > 0) alarmTo = Math.min(alarmTo, 0.35);
  me.alarm =
    alarmTo > me.alarm
      ? Math.min(alarmTo, me.alarm + ALARM_RISE * dt)
      : Math.max(alarmTo, me.alarm - ALARM_FALL * dt);
  me.gather = Math.max(0, me.gather - dt);
  const a = me.alarm;
  if (me.slide > 0 || me.dash > 0) {
    // Решение принято: овца держит направление, пока оно не истечёт, и только расталкивает
    // соседей. Так она не мечется между стеной и собакой.
    me.slide = Math.max(0, me.slide - dt);
    me.dash = Math.max(0, me.dash - dt);
    const sep = separation(me, s.others, SEPARATION_R);
    return {
      x: me.bx * me.bs + sep.x * SHEEP_TROT,
      y: me.by * me.bs + sep.y * SHEEP_TROT,
      max: me.bs,
      urgency: 1,
      push: 0,
      pressed: null,
    };
  }
  const calm = a < CALM && me.gather <= 0 && threat === 0;

  let wx = 0;
  let wy = 0;
  if (calm) {
    me.timer -= dt;
    if (me.timer <= 0) {
      if (me.mode === 'graze') {
        me.mode = 'walk';
        me.timer = 0.8 + rand() * 1.4;
        const h = calmHeading(me, s, level, rand);
        me.hx = h.x;
        me.hy = h.y;
      } else {
        me.mode = 'graze';
        // Отбившаяся одиночка подолгу щиплет траву: до леса она дойдёт не сразу.
        me.timer = me.wanderer && s.nearest > LONELY_R ? 3.5 + rand() * 5 : 2 + rand() * 4;
      }
    }
    if (me.mode === 'walk') {
      wx += me.hx * SHEEP_WALK;
      wy += me.hy * SHEEP_WALK;
    }
  } else if (me.mode === 'walk') {
    // Испуг сбивает с шага: успокоившись, овца сначала постоит.
    me.mode = 'graze';
    me.timer = 0.6 + rand() * 1.2;
  }

  const fear = Math.min(1, threat * 1.4);
  const dd = hypot(dx, dy);
  if (threat > 0) {
    wx += (dx / dd) * SHEEP_RUN * fear;
    wy += (dy / dd) * SHEEP_RUN * fear;
  } else if (a > CALM && dd < WARY_R && me.status === 'free') {
    // Встревоженная овца видит собаку и издалека: всё стадо отходит от неё, а не только задние.
    const k = (1 - dd / WARY_R) * a;
    wx += (dx / dd) * SHEEP_TROT * k;
    wy += (dy / dd) * SHEEP_TROT * k;
  }
  if (s.others.length > 0 && a > 0) {
    // Испуганные держатся вместе и бегут туда же, куда соседи.
    const c = cohesion(me, s.others, 14);
    const al = alignment(me, s.others);
    wx += c.x * SHEEP_TROT * 0.9 * a + (me.vx + al.x) * 0.9 * a;
    wy += c.y * SHEEP_TROT * 0.9 * a + (me.vy + al.y) * 0.9 * a;
  }
  const sep = separation(me, s.others, calm ? SEPARATION_CALM : SEPARATION_R);
  const apart = calm ? SHEEP_WALK * 2 : SHEEP_TROT * 1.6;
  wx += sep.x * apart;
  wy += sep.y * apart;

  if (me.gather > 0) {
    const gx = me.gx - me.x;
    const gy = me.gy - me.y;
    const gd = hypot(gx, gy);
    if (gd > 1) {
      const k = Math.min(1, gd / 16);
      wx += (gx / gd) * SHEEP_TROT * k;
      wy += (gy / gd) * SHEEP_TROT * k;
    }
  }

  if (me.status === 'free' && (a > CALM || threat > 0)) {
    // Гонимое стадо помнит дорогу домой, а у ворот и мостика само находит проход.
    const f = towardPen(level, me);
    const k = nearPassage(level, me) ? 0.9 : HOMING * a;
    wx += f.x * SHEEP_TROT * k;
    wy += f.y * SHEEP_TROT * k;
  }
  if (me.status === 'free') {
    const lost = me.wanderer && s.nearest > LONELY_R;
    const edge = forestDistance(me);
    if (!lost && !calm && edge < 20) {
      const f = inward(me);
      const k = ((20 - Math.max(0, edge)) / 20) * SHEEP_WALK * 0.6;
      wx += f.x * k;
      wy += f.y * k;
    }
  }

  // Упёрлась в забор — скользит вдоль него. Если почти в лоб или в угол, скользить некуда:
  // тогда овца «прижата» и через мгновение рванёт вбок (см. step).
  const push = hypot(wx, wy);
  const wall = wallNormal(level.grid, me.x, me.y, SHEEP_R + 2.5);
  const wl = hypot(wall.x, wall.y);
  if (wl > 1e-6) {
    const ux = wall.x / wl;
    const uy = wall.y / wl;
    const into = wx * ux + wy * uy;
    if (into < 0) {
      wx -= into * ux;
      wy -= into * uy;
    }
  }
  const alarmed = !calm && (a > CALM || threat > 0);
  const pressed =
    alarmed && wl > 1e-6 && push > 4 && hypot(wx, wy) < push * 0.35
      ? { x: wall.x / wl, y: wall.y / wl }
      : null;

  const urgency = Math.max(a, fear);
  const max =
    me.gather > 0 && threat === 0 ? SHEEP_TROT : SHEEP_WALK + (SHEEP_RUN - SHEEP_WALK) * urgency;
  const wlen = hypot(wx, wy);
  if (wlen > max) {
    wx *= max / wlen;
    wy *= max / wlen;
  }
  return {
    x: wx,
    y: wy,
    max,
    urgency: Math.max(urgency, me.gather > 0 ? 0.5 : 0),
    push: alarmed ? Math.min(push, max) : 0,
    pressed,
  };
}

/** Насколько гонимую овцу тянет по дороге к загону (доля рыси на полной тревоге). */
const HOMING = 0.25;

/** Овца у ворот загона или у мостика: здесь испуганное стадо само ищет проход. */
function nearPassage(level: Level, p: Point): boolean {
  const pen = level.pen;
  if (hypot(p.x - pen.mouth.x, p.y - pen.mouth.y) < GATE_PULL_R) return true;
  for (const b of level.stream?.bridges ?? []) {
    const cx = Math.min(b.x + b.w, Math.max(b.x, p.x));
    const cy = Math.min(b.y + b.h, Math.max(b.y, p.y));
    if (hypot(p.x - cx, p.y - cy) < BRIDGE_PULL_R) return true;
  }
  return false;
}

/** Куда идти к загону: по полю расстояний, а уже в проёме ворот — к середине загона. */
export function towardPen(level: Level, p: Point): Vec {
  const f = flowDir(level.nav, level.grid, p.x, p.y);
  if (f) return f;
  const r = level.pen.inner;
  const dx = r.x + r.w / 2 - p.x;
  const dy = r.y + r.h / 2 - p.y;
  const d = hypot(dx, dy);
  return d > 1e-6 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 };
}

/**
 * Куда рвануть из тупика: из двенадцати направлений — где дальше всего до стены и леса и
 * меньше соседей на пути (соседей можно растолкать, стену — нет); при равенстве — ближе к
 * тому, куда овца хотела.
 */
function escapeDir(
  me: Sheep,
  sheep: readonly Sheep[],
  level: Level,
  want: Vec,
  rand: () => number,
): Vec {
  const wl = hypot(want.x, want.y) || 1;
  let best: Vec = { x: -want.x / wl, y: -want.y / wl };
  let bestScore = -Infinity;
  const turn = rand() * 0.5;
  for (let k = 0; k < 12; k++) {
    const ang = (k / 12) * Math.PI * 2 + turn;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let free = 0;
    let crowd = 0;
    for (let r = 3; r <= 18; r += 3) {
      const px = me.x + dx * r;
      const py = me.y + dy * r;
      if (penetration(level.grid, px, py, SHEEP_R) > 0.5) break;
      if (me.status === 'free' && inForest({ x: px, y: py })) break;
      free = r;
      for (const o of sheep) {
        if (o !== me && o.status !== 'lost' && hypot(o.x - px, o.y - py) < SHEEP_R * 2) crowd++;
      }
    }
    const score =
      (free / 18) * 2 - Math.min(1, crowd / 4) * 0.8 + ((dx * want.x + dy * want.y) / wl) * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = { x: dx, y: dy };
    }
  }
  return best;
}

/** Загнанная овца остаётся в загоне: ворота за ней словно закрываются. */
function confine(s: Sheep, r: Rect) {
  const x0 = r.x + SHEEP_R;
  const x1 = r.x + r.w - SHEEP_R;
  const y0 = r.y + SHEEP_R;
  const y1 = r.y + r.h - SHEEP_R;
  if (s.x < x0 || s.x > x1) {
    s.x = Math.min(x1, Math.max(x0, s.x));
    s.vx = 0;
  }
  if (s.y < y0 || s.y > y1) {
    s.y = Math.min(y1, Math.max(y0, s.y));
    s.vy = 0;
  }
}

/** Сдвиг овцы с учётом стен (и стенок загона для загнанной). */
function shove(s: Sheep, level: Level, dx: number, dy: number) {
  const c = moveCircle(level.grid, s.x, s.y, dx, dy, SHEEP_R);
  s.x = c.x;
  s.y = c.y;
  if (s.status === 'penned') confine(s, level.pen.inner);
}

/** Овцы не проходят друг сквозь друга: перекрытия раздвигаются, сближение гасится. */
function separateBodies(sheep: Sheep[], level: Level) {
  const min = SHEEP_R * 2;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < sheep.length; i++) {
      const a = sheep[i] as Sheep;
      if (a.status === 'lost') continue;
      for (let j = i + 1; j < sheep.length; j++) {
        const b = sheep[j] as Sheep;
        if (b.status === 'lost') continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = hypot(dx, dy);
        if (d >= min) continue;
        // Совпали точь-в-точь — расходятся в сторону, которая зависит только от номеров.
        const ang = (a.id * 2.399 + b.id * 0.7) % (Math.PI * 2);
        const ux = d > 1e-6 ? dx / d : Math.cos(ang);
        const uy = d > 1e-6 ? dy / d : Math.sin(ang);
        const half = (min - d) / 2;
        shove(a, level, -ux * half, -uy * half);
        shove(b, level, ux * half, uy * half);
        const rel = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
        if (rel < 0) {
          a.vx += rel * ux * 0.5;
          a.vy += rel * uy * 0.5;
          b.vx -= rel * ux * 0.5;
          b.vy -= rel * uy * 0.5;
        }
      }
    }
  }
}

/** Собака не проходит сквозь овец: овцу отодвигает, а прижатая к стене овца останавливает собаку. */
function pushByDog(dog: Dog, sheep: Sheep[], level: Level): Dog {
  let { x, y } = dog;
  const min = DOG_R + SHEEP_R;
  for (const s of sheep) {
    if (s.status === 'lost') continue;
    const dx = s.x - x;
    const dy = s.y - y;
    const d = hypot(dx, dy);
    if (d >= min) continue;
    const ux = d > 1e-6 ? dx / d : 0;
    const uy = d > 1e-6 ? dy / d : -1;
    const need = min - d;
    const bx = s.x;
    const by = s.y;
    shove(s, level, ux * need, uy * need);
    const moved = (s.x - bx) * ux + (s.y - by) * uy;
    if (moved < need - 1e-6) {
      x -= ux * (need - moved);
      y -= uy * (need - moved);
    }
  }
  x = Math.min(WORLD_W - DOG_R, Math.max(DOG_R, x));
  y = Math.min(WORLD_H - DOG_R, Math.max(DOG_TOP, y));
  return x === dog.x && y === dog.y ? dog : { ...dog, x, y };
}

export function step(
  prev: Run,
  level: Level,
  input: Input,
  dt: number,
): { run: Run; events: HerdEvent[] } {
  if (prev.status === 'done' || prev.status === 'dawn') return { run: prev, events: [] };
  const acting = input.target !== null || input.move !== null || input.whistle;
  if (prev.status === 'ready' && !acting) return { run: prev, events: [] };
  const events: HerdEvent[] = [];
  if (prev.status === 'ready') events.push({ type: 'start' });
  let rng = prev.rng;
  const rand = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };

  let dog = moveDog(prev.dog, level, input, dt);
  const sheep = prev.sheep.map((s) => ({ ...s }));
  let cooldown = Math.max(0, prev.cooldown - dt);
  let whistles = prev.whistles;

  // Свист: овцы рядом с собакой сбиваются к общему центру и чуть успокаиваются.
  if (input.whistle && cooldown === 0) {
    const near = sheep.filter(
      (s) => s.status === 'free' && hypot(s.x - dog.x, s.y - dog.y) <= WHISTLE_R,
    );
    cooldown = WHISTLE_COOLDOWN;
    whistles += 1;
    if (near.length > 0) {
      const gx = near.reduce((sum, s) => sum + s.x, 0) / near.length;
      const gy = near.reduce((sum, s) => sum + s.y, 0) / near.length;
      for (const s of near) {
        s.gather = WHISTLE_GATHER;
        s.gx = gx;
        s.gy = gy;
      }
    }
    events.push({ type: 'whistle', x: dog.x, y: dog.y, count: near.length });
  }

  // Желания считаются по положениям прошлого шага: порядок овец ни на что не влияет.
  const wants = sheep.map((me, i) =>
    me.status === 'lost' ? null : desire(prev.sheep, i, me, dog, level, rand, dt),
  );
  const before = sheep.map((s) => ({ x: s.x, y: s.y }));
  for (let i = 0; i < sheep.length; i++) {
    const s = sheep[i] as Sheep;
    const w = wants[i];
    if (!w) continue;
    const accel = SHEEP_ACCEL_CALM + (SHEEP_ACCEL_ALARM - SHEEP_ACCEL_CALM) * w.urgency;
    let ax = w.x - s.vx;
    let ay = w.y - s.vy;
    const al = hypot(ax, ay);
    const limit = accel * dt;
    if (al > limit) {
      ax *= limit / al;
      ay *= limit / al;
    }
    s.vx += ax;
    s.vy += ay;
    const sp = hypot(s.vx, s.vy);
    const cap = Math.max(w.max, SHEEP_WALK);
    if (sp > cap) {
      s.vx *= cap / sp;
      s.vy *= cap / sp;
    }
    const c = moveCircle(level.grid, s.x, s.y, s.vx * dt, s.vy * dt, SHEEP_R);
    s.x = c.x;
    s.y = c.y;
    if (c.hit) {
      const l = hypot(c.nx, c.ny);
      if (l > 1e-9) {
        const into = (s.vx * c.nx + s.vy * c.ny) / l;
        if (into < 0) {
          s.vx -= (into * c.nx) / l;
          s.vy -= (into * c.ny) / l;
        }
      }
    }
    if (s.status === 'penned') confine(s, level.pen.inner);
  }
  separateBodies(sheep, level);
  dog = pushByDog(dog, sheep, level);

  // Упёрлась в стену почти в лоб — сразу решает, в какую сторону скользить вдоль неё, и
  // держит решение полсекунды. Упёрлась в угол или топчется дольше секунды (тупик, давка) —
  // рвётся в самую свободную сторону. Так овца не мечется между стеной и собакой.
  for (let i = 0; i < sheep.length; i++) {
    const s = sheep[i] as Sheep;
    const w = wants[i];
    const b = before[i];
    if (!w || !b || s.status === 'lost') continue;
    const k = Math.min(1, dt / 0.35);
    s.mx += ((s.x - b.x) / dt - s.mx) * k;
    s.my += ((s.y - b.y) / dt - s.my) * k;
    if (s.dash > 0) continue;
    const want = s.slide > 0 ? s.bs : w.push;
    if (want > 4 && hypot(s.mx, s.my) < want * 0.2) s.stuck += dt;
    else s.stuck = Math.max(0, s.stuck - dt);
    let cornered = false;
    let tx = 0;
    let ty = 0;
    if (w.pressed && s.slide <= 0) {
      tx = -w.pressed.y;
      ty = w.pressed.x;
      const ahead = penetration(level.grid, s.x + tx * 4, s.y + ty * 4, SHEEP_R) > 0.5;
      const behind = penetration(level.grid, s.x - tx * 4, s.y - ty * 4, SHEEP_R) > 0.5;
      cornered = ahead && behind;
      if (ahead !== behind) {
        // Вдоль стены можно только в одну сторону — туда и скользит.
        tx = ahead ? -tx : tx;
        ty = ahead ? -ty : ty;
      } else {
        // Вдоль стены: куда уже движется, иначе — прочь от собаки, иначе — по номеру овцы.
        const along = s.mx * tx + s.my * ty;
        const side = (s.x - dog.x) * tx + (s.y - dog.y) * ty;
        const sign =
          Math.abs(along) > 1.5
            ? Math.sign(along)
            : Math.abs(side) > 1e-6
              ? Math.sign(side)
              : s.id % 2 === 1
                ? -1
                : 1;
        tx *= sign;
        ty *= sign;
      }
    }
    if (cornered || s.stuck > 1) {
      const e = escapeDir(
        s,
        sheep,
        level,
        w.pressed ? { x: -w.pressed.x, y: -w.pressed.y } : w,
        rand,
      );
      s.bx = e.x;
      s.by = e.y;
      s.bs = SHEEP_RUN * 0.7;
      s.dash = 0.6 + rand() * 0.3;
      s.slide = 0;
      s.stuck = 0;
    } else if (w.pressed && s.slide <= 0) {
      s.bx = tx;
      s.by = ty;
      s.bs = Math.min(SHEEP_RUN * 0.8, Math.max(SHEEP_WALK, w.push * 0.8));
      s.slide = 0.5;
    }
  }

  let { penned, lost, rescued } = prev;
  for (const s of sheep) {
    if (s.status === 'lost') continue;
    if (s.vx > 2) s.face = 1;
    else if (s.vx < -2) s.face = -1;
    if (s.status === 'free') {
      if (within(s, level.pen.inner, SHEEP_R)) {
        s.status = 'penned';
        s.alarm = Math.min(s.alarm, 0.5);
        penned += 1;
        if (s.strayed) rescued += 1;
        s.stray = 0;
        events.push({ type: 'penned', id: s.id, x: s.x, y: s.y, count: penned });
      } else if (inForest(s)) {
        if (s.stray === 0) events.push({ type: 'stray', id: s.id, x: s.x, y: s.y });
        s.stray += dt;
        s.strayed = true;
        if (s.stray >= STRAY_LOST) {
          s.status = 'lost';
          s.vx = 0;
          s.vy = 0;
          lost += 1;
          events.push({ type: 'lost', id: s.id, x: s.x, y: s.y, count: lost });
          continue;
        }
      } else if (s.stray > 0) {
        s.stray = 0;
        events.push({ type: 'back', id: s.id });
      }
    }
    s.bleat -= dt;
    if (s.bleat <= 0) {
      let nearest = Infinity;
      for (const o of sheep)
        if (o !== s && o.status !== 'lost')
          nearest = Math.min(nearest, hypot(o.x - s.x, o.y - s.y));
      const lonely = s.status === 'free' && nearest > LONELY_R;
      s.bleat = bleatGap(rand(), s, lonely);
      events.push({ type: 'bleat', id: s.id, x: s.x, y: s.y, lonely });
    }
  }

  const t = prev.t + dt;
  let status: Run['status'] = 'running';
  if (penned + lost >= sheep.length) {
    status = 'done';
    events.push({ type: 'done' });
  } else if (t >= level.spec.time) {
    status = 'dawn';
    events.push({ type: 'dawn' });
  }
  return {
    run: { status, t, rng, dog, sheep, cooldown, whistles, penned, lost, rescued },
    events,
  };
}

/** Сколько свободных овец осталось на лугу (не в загоне и не в лесу). */
export const freeSheep = (run: Pick<Run, 'sheep'>): Sheep[] =>
  run.sheep.filter((s) => s.status === 'free');
