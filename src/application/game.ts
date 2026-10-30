/**
 * Игра целиком без DOM: экраны, фиксированный шаг симуляции, ввод, демо в меню, звук по
 * событиям и запись итога. Вид получает кадры и смены экранов колбэками.
 */

import type { AchievementId } from '@/domain/achievements';
import { BOT_START, type BotMemory, shepherd } from '@/domain/bot';
import { coach, COACH_START, coachFor, type TipId } from '@/domain/coach';
import { dawnOf } from '@/domain/fog';
import { type HerdEvent, type Input, type Run, startRun, step } from '@/domain/herd';
import { campaignLevel, type Level, LEVEL_COUNT, type Point } from '@/domain/level';
import { attemptOf, type Controls } from '@/domain/playtest';
import { isUnlocked, type LevelBest, recordRun, type Theme } from '@/domain/save';
import { resultOf, type RunResult } from '@/domain/score';

import type { Clock } from './ports/clock';
import type { PlaytestLog } from './ports/playtestLog';
import type { Cue, Place, Sound } from './ports/sound';
import type { SaveStore } from './saveStore';

/** Шаг симуляции: 120 раз в секунду при любой частоте кадров экрана. */
export const STEP = 1 / 120;
/** Сколько длится финальная сцена, прежде чем откроется итог, с. */
export const ENDING_DELAY = 1.6;
/** Дольше кадр не считается: после зависания игра не «догоняет» пропущенное. */
const MAX_FRAME = 0.1;

export type Screen = 'menu' | 'help' | 'achievements' | 'playing' | 'paused' | 'result';

export interface Ending {
  result: RunResult;
  unlocked: AchievementId[];
  record: boolean;
  best: LevelBest | undefined;
  /** Почему итог не записан: уровень вёл бот или раскладка со своим сидом. */
  unrecorded: 'autopilot' | 'seed' | null;
  /** Следующий уровень, если он есть и уже открыт. */
  next: number | null;
}

export interface Frame {
  level: Level;
  run: Run;
  /** Секунды с запуска страницы — для анимаций. */
  time: number;
  demo: boolean;
  /** Подсказка на первых уровнях. */
  tip: TipId | null;
}

export interface GameView {
  frame(frame: Frame): void;
  screen(screen: Screen, ending: Ending | null): void;
  events(events: readonly HerdEvent[], run: Run): void;
}

const DEMO_SCREENS: readonly Screen[] = ['menu', 'help', 'achievements'];

const CUES: Partial<Record<HerdEvent['type'], Cue>> = {
  start: 'start',
  whistle: 'whistle',
  bleat: 'bleat',
  penned: 'penned',
  stray: 'stray',
  lost: 'lost',
  done: 'flock',
  dawn: 'dawn',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface GameOptions {
  store: SaveStore;
  sound: Sound;
  clock: Clock;
  view: GameView;
  /** Уровень ведёт бот (?autopilot): показать прохождение; итог не записывается. */
  autopilot?: boolean;
  /** Своя раскладка (?seed=…): для проверки и показа; итог не записывается. */
  seed?: string | null;
  /** Открыть этот уровень, даже если он ещё закрыт (?level=…). */
  level?: number | null;
  /** Журнал попыток живого игрока (?playtest). */
  playtest?: PlaytestLog | null;
}

export function createGame(deps: GameOptions) {
  const { store, sound, clock, view } = deps;
  const piloted = deps.autopilot ?? false;
  const seed = deps.seed ?? null;
  const forced = deps.level ?? null;
  const playtest = deps.playtest ?? null;
  const cache = new Map<number, Level>();
  const levelOf = (n: number): Level => {
    let l = cache.get(n);
    if (!l) cache.set(n, (l = campaignLevel(n, seed !== null && n > 0 ? seed : undefined)));
    return l;
  };
  /** Бот и своя раскладка — режимы проверки и показа: они ничего не пишут в сохранение. */
  const recording = !piloted && seed === null;
  const remember = (n: number) => {
    if (recording && store.get().level !== n) store.apply((s) => ({ ...s, level: n }));
  };
  const isOpen = (n: number): boolean =>
    Number.isInteger(n) &&
    n >= 0 &&
    n <= LEVEL_COUNT &&
    (piloted || seed !== null || n === forced || isUnlocked(store.get(), n));

  const remembered = forced ?? store.get().level;
  let selected = isOpen(remembered) ? remembered : 0;
  let level = levelOf(selected);
  let run = startRun(level);
  let demo = true;
  let memory: BotMemory = BOT_START;
  let screen: Screen = 'menu';
  let ending: Ending | null = null;
  let endTimer = 0;
  let acc = 0;
  let last: number | null = null;
  let time = 0;
  let steps = 0;
  let target: Point | null = null;
  let move: Point | null = null;
  let whistleQueued = false;
  let tips = COACH_START;
  let coaching = false;
  let controls: Controls = 'none';
  sound.setEnabled(store.get().sound);

  const show = (next: Screen) => {
    screen = next;
    view.screen(next, ending);
  };

  const restartDemo = () => {
    demo = true;
    level = levelOf(selected);
    run = startRun(level);
    memory = BOT_START;
  };

  const nextOf = (r: RunResult): number | null => {
    const n = r.level + 1;
    return n <= LEVEL_COUNT && r.stars >= 1 && isOpen(n) ? n : null;
  };

  /** Начатый и брошенный уровень — тоже данные плейтеста: может, он слишком труден. */
  const logQuit = () => {
    if (!playtest || demo || ending || run.status === 'ready') return;
    playtest.add(attemptOf(resultOf(run, level), seed, controls, true));
  };

  const finish = () => {
    const result = resultOf(run, level);
    playtest?.add(attemptOf(result, seed, controls));
    const unrecorded = piloted ? 'autopilot' : seed !== null ? 'seed' : null;
    if (unrecorded) {
      ending = {
        result,
        unlocked: [],
        record: false,
        best: store.get().levels[String(result.level)],
        unrecorded,
        next: nextOf(result),
      };
    } else {
      const recorded = recordRun(store.get(), result, clock.nowIso());
      store.apply(() => recorded.save);
      ending = {
        result,
        unlocked: recorded.unlocked,
        record: recorded.record,
        best: recorded.best,
        unrecorded: null,
        next: nextOf(result),
      };
    }
    endTimer = ENDING_DELAY;
  };

  /** Звук там, где событие: левее собаки — в левом ухе, дальше — тише. */
  const place = (x: number, y: number): Place => {
    const dx = x - run.dog.x;
    const dy = y - run.dog.y;
    return {
      pan: clamp(dx / 140, -1, 1),
      gain: clamp(1 - Math.hypot(dx, dy) / 260, 0.15, 1),
    };
  };

  const simulate = () => {
    if (demo) {
      const b = shepherd(run, level, memory);
      memory = b.memory;
      run = step(run, level, b.input, STEP).run;
      if (run.status === 'done' || run.status === 'dawn') restartDemo();
      return;
    }
    if (run.status === 'done' || run.status === 'dawn') return;
    let input: Input;
    if (piloted) {
      const b = shepherd(run, level, memory);
      memory = b.memory;
      input = b.input;
    } else {
      input = { target, move, whistle: whistleQueued };
      whistleQueued = false;
    }
    const r = step(run, level, input, STEP);
    run = r.run;
    steps += 1;
    if (r.events.length === 0) return;
    for (const e of r.events) {
      const cue = CUES[e.type];
      if (cue) sound.play(cue, 'x' in e ? place(e.x, e.y) : undefined);
    }
    view.events(r.events, run);
    if (run.status === 'done' || run.status === 'dawn') finish();
  };

  return {
    get screen() {
      return screen;
    },
    get level() {
      return level;
    },
    get run() {
      return run;
    },
    /** Выбранный уровень (0 — тренировка). */
    get selected() {
      return selected;
    },
    get ending() {
      return ending;
    },
    /** Сколько шагов симуляции сделано в этом уровне — для проверки фиксированного шага. */
    get steps() {
      return steps;
    },
    get autopilot() {
      return piloted;
    },
    get seed() {
      return seed;
    },
    isOpen,

    /** Кадр анимации: ms — время из requestAnimationFrame. */
    tick(ms: number) {
      const dt = last === null ? 0 : Math.min(MAX_FRAME, Math.max(0, (ms - last) / 1000));
      last = ms;
      time += dt;
      if (coaching && screen === 'playing') tips = coach(tips, run, level, dt);
      const live = screen === 'playing' || (demo && DEMO_SCREENS.includes(screen));
      if (live) {
        acc += dt;
        // Запас в миллиардную долю: 1/60 с — это ровно два шага, а не один из-за округления.
        while (acc >= STEP - 1e-9) {
          acc -= STEP;
          simulate();
        }
      }
      if (screen === 'playing' && ending && endTimer > 0) {
        endTimer -= dt;
        if (endTimer <= 0) show('result');
      }
      const over = run.status === 'done' || run.status === 'dawn';
      sound.ambience(
        screen === 'playing' && !demo && !over
          ? { season: level.spec.season, dawn: dawnOf(level, run.t) }
          : null,
      );
      view.frame({ level, run, time, demo, tip: coaching && !over ? tips.tip : null });
    },

    start(n: number = selected) {
      if (!isOpen(n)) return;
      logQuit();
      selected = n;
      remember(n);
      demo = false;
      ending = null;
      endTimer = 0;
      acc = 0;
      steps = 0;
      target = null;
      move = null;
      whistleQueued = false;
      memory = BOT_START;
      tips = COACH_START;
      coaching = !piloted && coachFor(n, store.get().levels[String(n)]?.stars ?? 0);
      controls = 'none';
      level = levelOf(n);
      run = startRun(level);
      show('playing');
    },
    restart() {
      this.start(selected);
    },
    /** Курсор или палец над лугом: собака бежит туда; null — остановиться. */
    aim(p: Point | null) {
      if (screen !== 'playing' || demo) return;
      target = p;
      if (p) {
        move = null;
        controls = 'pointer';
      }
    },
    /** Направление с клавиатуры; null — клавиши отпущены, собака останавливается. */
    steer(dir: Point | null) {
      if (screen !== 'playing' || demo) return;
      move = dir && (dir.x !== 0 || dir.y !== 0) ? dir : null;
      target = null;
      if (move) controls = 'keys';
    },
    whistle() {
      if (screen === 'playing' && !demo && !ending) whistleQueued = true;
    },
    pause() {
      if (screen !== 'playing' || ending) return;
      target = null;
      move = null;
      show('paused');
    },
    resume() {
      if (screen !== 'paused') return;
      last = null;
      show('playing');
    },
    togglePause() {
      if (screen === 'paused') this.resume();
      else this.pause();
    },
    open(next: 'menu' | 'help' | 'achievements') {
      if (next === 'menu' && !DEMO_SCREENS.includes(screen)) {
        logQuit();
        restartDemo();
      }
      ending = null;
      show(next);
    },
    select(n: number) {
      if (!isOpen(n)) return;
      selected = n;
      remember(n);
      if (demo) restartDemo();
    },
    toggleSound(): boolean {
      const on = !store.get().sound;
      store.apply((s) => ({ ...s, sound: on }));
      sound.setEnabled(on);
      return on;
    },
    setTheme(theme: Theme) {
      store.apply((s) => ({ ...s, theme }));
    },
  };
}

export type Game = ReturnType<typeof createGame>;
