/**
 * Константы мира. Единица — пиксель холста игры; ось y направлена вниз, время — в секундах.
 * Мир один на все уровни: 384×216, сверху деревня за плетнём, слева, справа и снизу — лес.
 */

export const WORLD_W = 384;
export const WORLD_H = 216;
/** Клетка сетки столкновений и пути до загона. */
export const TILE = 4;
export const COLS = WORLD_W / TILE;
export const ROWS = WORLD_H / TILE;
/** Выше — небо и деревня; луг начинается под плетнём. */
export const HORIZON = 32;
/** Ширина леса по краям: овца, ушедшая туда, теряется. */
export const FOREST = 16;
export const MEADOW = {
  x0: FOREST,
  y0: HORIZON,
  x1: WORLD_W - FOREST,
  y1: WORLD_H - FOREST,
} as const;

/* ---------- овцы ---------- */

export const SHEEP_R = 3.5;
/** Шаг пасущейся овцы, рысь стада и бег от собаки, ед/с. */
export const SHEEP_WALK = 6;
export const SHEEP_TROT = 18;
export const SHEEP_RUN = 34;
/** Как быстро овца меняет скорость: спокойная — плавно, испуганная — резко, ед/с². */
export const SHEEP_ACCEL_CALM = 24;
export const SHEEP_ACCEL_ALARM = 150;
/** Личное пространство (центр — центр): ближе соседи расталкиваются. */
export const SEPARATION_R = 10;
export const SEPARATION_CALM = 8.5;
/** Кого овца считает соседями: с ними выравнивается и держится вместе. */
export const NEIGHBOR_R = 28;
/** Ближайшая овца дальше — овца отбилась и идёт к своим. */
export const LONELY_R = 36;
/** Дальше этого овца не слышит стадо, бродит наугад и забредает в лес. */
export const HEAR_R = 96;
/** Ближе этого овца боится собаки. */
export const FLEE_R = 46;
/** Встревоженное стадо отходит от собаки и дальше — до этого расстояния. */
export const WARY_R = 110;
/** Тревога растёт и спадает, ед/с; соседям передаётся её доля. */
export const ALARM_RISE = 5;
export const ALARM_FALL = 0.45;
export const CONTAGION = 0.85;
/** Ниже этой тревоги овца спокойна: пасётся или бредёт шагом. */
export const CALM = 0.2;
/** У ворот загона и у мостика испуганная овца сама находит проход. */
export const GATE_PULL_R = 30;
export const BRIDGE_PULL_R = 20;
/** Сколько секунд овца может пробыть в лесу, прежде чем потеряется. */
export const STRAY_LOST = 6;

/* ---------- собака ---------- */

export const DOG_R = 4;
/** Выше собака не забегает: может пробежать вдоль плетня, чтобы зайти за прижатых к нему овец. */
export const DOG_TOP = HORIZON - 3;
export const DOG_SPEED = 64;
export const DOG_ACCEL = 520;
/** В ручье собака плывёт медленнее. */
export const DOG_SWIM = 0.5;
/** Ближе к цели собака сбавляет шаг, чтобы не проскочить её. */
export const ARRIVE_R = 14;

/* ---------- свист ---------- */

export const WHISTLE_R = 84;
/** Сколько секунд овцы сбиваются в кучу после свиста и сколько ждать следующего. */
export const WHISTLE_GATHER = 2.5;
export const WHISTLE_COOLDOWN = 4;
