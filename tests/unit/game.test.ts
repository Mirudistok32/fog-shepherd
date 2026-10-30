import { describe, expect, it } from 'vitest';

import { createGame, ENDING_DELAY, type GameView, type Screen, STEP } from '@/application/game';
import type { PlaytestLog } from '@/application/ports/playtestLog';
import type { Cue, Mood, Place } from '@/application/ports/sound';
import { createSaveStore } from '@/application/saveStore';
import type { TipId } from '@/domain/coach';
import type { Attempt } from '@/domain/playtest';
import { emptySave, type Save } from '@/domain/save';

const memoryRepo = (initial: Save = emptySave()) => {
  let stored = initial;
  return {
    load: () => ({ save: stored, problem: null }),
    write: (s: Save) => ((stored = s), true),
  };
};

function setup(
  opts: {
    autopilot?: boolean;
    seed?: string | null;
    level?: number | null;
    save?: Save;
    playtest?: PlaytestLog;
  } = {},
) {
  const screens: Screen[] = [];
  const cues: [Cue, Place | undefined][] = [];
  const moods: (Mood | null)[] = [];
  const tips: (TipId | null)[] = [];
  const view: GameView = {
    frame: (f) => tips.push(f.tip),
    screen: (s) => screens.push(s),
    events: () => {},
  };
  const store = createSaveStore(memoryRepo(opts.save));
  const game = createGame({
    store,
    view,
    sound: {
      play: (c, p) => cues.push([c, p]),
      ambience: (m) => moods.push(m),
      setEnabled: () => {},
    },
    clock: { nowIso: () => '2026-10-30T12:00:00.000Z' },
    autopilot: opts.autopilot,
    seed: opts.seed,
    level: opts.level,
    playtest: opts.playtest,
  });
  let ms = 0;
  /** Прокрутить seconds секунд кадрами частотой hz. */
  const run = (seconds: number, hz = 60, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds * hz); i++) {
      each?.();
      game.tick((ms += 1000 / hz));
    }
  };
  game.tick(ms);
  game.open('menu');
  return {
    game,
    store,
    screens,
    cues,
    moods,
    tips,
    run,
    tickAt: (t: number) => game.tick((ms = t)),
  };
}

describe('игра', () => {
  it('в меню бот гоняет стадо как демо и ничего не записывает', () => {
    const { game, store, run } = setup();
    const x = game.run.dog.x;
    run(4);
    expect(game.run.dog.x).not.toBe(x);
    expect(store.get().stats.runs).toBe(0);
  });

  it('старт: собака ждёт; первое движение запускает время', () => {
    const { game, run } = setup();
    game.start(0);
    run(1);
    expect(game.screen).toBe('playing');
    expect(game.run.status).toBe('ready');
    expect(game.run.t).toBe(0);
    game.aim({ x: 200, y: 100 });
    run(1);
    expect(game.run.status).toBe('running');
    expect(game.run.t).toBeGreaterThan(0.9);
  });

  it('шаг симуляции фиксированный: 60, 120, 144 Гц и рваные кадры дают один и тот же забег', () => {
    const play = (frames: number[]) => {
      const { game, tickAt } = setup();
      game.start(1);
      game.aim({ x: 250, y: 150 });
      let t = 0;
      tickAt(t);
      for (const dt of frames) {
        t += dt;
        tickAt(t);
        // Ввод — в общие для всех частот моменты: ровно 1, 2 и 3 с.
        const at = Math.round(t * 1000) / 1000;
        if (at === 1000) game.aim({ x: 120, y: 160 });
        if (at === 2000) game.whistle();
        if (at === 3000) game.steer({ x: 1, y: -1 });
      }
      return game;
    };
    const even = (hz: number) => Array.from({ length: 5 * hz }, () => 1000 / hz);
    // Рваные кадры по 7, 25, 11 и 16,7 мс, но со стыками ровно на каждой секунде.
    const ragged: number[] = [];
    for (let sec = 0; sec < 5; sec++) {
      const parts = [7, 25, 11, 1000 / 60];
      let used = 0;
      for (let i = 0; used < 1000 - 40; i++) {
        const d = parts[i % parts.length] ?? 10;
        ragged.push(d);
        used += d;
      }
      ragged.push(1000 - used);
    }
    const a = play(even(60));
    expect(a.steps).toBe(Math.round(5 / STEP));
    expect(a.run.whistles).toBe(1);
    for (const g of [play(even(120)), play(even(144)), play(ragged)]) {
      expect(g.steps).toBe(a.steps);
      expect(g.run).toEqual(a.run);
    }
  });

  it('долгий кадр (вкладка подвисла) — симуляция не догоняет больше 0,1 с', () => {
    const { game, run, tickAt } = setup();
    game.start(1);
    game.aim({ x: 100, y: 100 });
    run(0.5);
    const steps = game.steps;
    tickAt(60_000);
    expect(game.steps - steps).toBeLessThanOrEqual(Math.ceil(0.1 / STEP));
  });

  it('пауза останавливает время и собаку; продолжение — возобновляет', () => {
    const { game, run } = setup();
    game.start(1);
    game.aim({ x: 300, y: 180 });
    run(0.5);
    game.pause();
    const t = game.run.t;
    run(2);
    expect(game.screen).toBe('paused');
    expect(game.run.t).toBe(t);
    game.resume();
    run(0.5);
    expect(game.run.t).toBeGreaterThan(t);
    // После паузы собака стоит, пока игрок снова её не поведёт.
    expect(Math.hypot(game.run.dog.vx, game.run.dog.vy)).toBeLessThan(1);
  });

  it('тренировка: стадо в загоне → итог через паузу, запись один раз, открыт уровень 1', () => {
    const { game, store, screens, cues, run } = setup();
    game.start(0);
    let doneAt = -1;
    let t = 0;
    // Как играет человек с клавиатуры: подбежать — остановиться — снова подтолкнуть.
    run(20, 60, () => {
      t += 1 / 60;
      game.steer(t % 1.2 < 0.5 ? { x: 1, y: 0 } : null);
      if (doneAt < 0 && game.run.status === 'done') doneAt = t;
      if (doneAt > 0 && t - doneAt < ENDING_DELAY - 0.1) expect(game.screen).toBe('playing');
    });
    expect(doneAt).toBeGreaterThan(0);
    expect(screens.at(-1)).toBe('result');
    expect(game.ending?.result.allIn).toBe(true);
    expect(game.ending?.next).toBe(1);
    expect(cues.map(([c]) => c)).toEqual(expect.arrayContaining(['start', 'penned', 'flock']));
    expect(store.get().stats.runs).toBe(1);
    expect(store.get().levels['0']?.stars).toBeGreaterThanOrEqual(2);
    expect(game.isOpen(1)).toBe(true);
    expect(game.isOpen(2)).toBe(false);
  });

  it('рассвет: итог с тем, что успели, без следующего уровня', () => {
    const { game, store, screens, run } = setup();
    game.start(1);
    game.aim({ x: 30, y: 200 });
    run(135);
    expect(screens.at(-1)).toBe('result');
    expect(game.ending?.result.dawn).toBe(true);
    expect(game.ending?.next).toBeNull();
    expect(store.get().stats.runs).toBe(1);
  });

  it('?autopilot: бот проходит уровень, но итог не записывается', () => {
    const { game, store, screens, run } = setup({ autopilot: true });
    game.start(2);
    run(60);
    expect(screens.at(-1)).toBe('result');
    expect(game.ending?.unrecorded).toBe('autopilot');
    expect(game.ending?.result.allIn).toBe(true);
    expect(store.get().stats.runs).toBe(0);
  });

  it('?seed: своя раскладка, все уровни открыты, итог не записывается', () => {
    const { game, store, screens, run } = setup({ seed: 'e2e', autopilot: true });
    expect(game.isOpen(12)).toBe(true);
    game.start(1);
    expect(game.level.seedText).toBe('e2e');
    run(60);
    expect(screens.at(-1)).toBe('result');
    expect(store.get().stats.runs).toBe(0);
  });

  it('закрытый уровень не запускается, а ?level=N открывает его', () => {
    const closed = setup();
    closed.game.start(5);
    expect(closed.game.screen).toBe('menu');
    const forced = setup({ level: 5 });
    expect(forced.game.selected).toBe(5);
    forced.game.start(5);
    expect(forced.game.screen).toBe('playing');
    expect(forced.game.level.spec.number).toBe(5);
  });

  it('рестарт начинает уровень заново', () => {
    const { game, run } = setup();
    game.start(1);
    game.aim({ x: 200, y: 200 });
    run(3);
    game.restart();
    expect(game.run.t).toBe(0);
    expect(game.run.status).toBe('ready');
    expect(game.steps).toBe(0);
  });

  it('выбор уровня и звук запоминаются', () => {
    const save = recordFirst();
    const { game, store } = setup({ save });
    game.select(2);
    expect(store.get().level).toBe(2);
    expect(game.toggleSound()).toBe(false);
    expect(store.get().sound).toBe(false);
  });

  it('блеяние звучит с той стороны, где овца, и тише вдали', () => {
    const { game, cues, run } = setup({ level: 3 });
    game.start(3);
    game.aim({ x: 200, y: 120 });
    run(25);
    const bleats = cues.filter(([c]) => c === 'bleat').map(([, p]) => p);
    expect(bleats.length).toBeGreaterThan(0);
    for (const p of bleats) {
      expect(p?.pan).toBeGreaterThanOrEqual(-1);
      expect(p?.pan).toBeLessThanOrEqual(1);
      expect(p?.gain).toBeGreaterThan(0);
      expect(p?.gain).toBeLessThanOrEqual(1);
    }
    expect(new Set(bleats.map((p) => Math.sign(p?.pan ?? 0))).size).toBeGreaterThan(1);
  });

  it('фон звучит только в самой игре: ни в меню, ни на паузе, ни после конца', () => {
    const { game, moods, run } = setup();
    run(0.2);
    expect(moods.at(-1)).toBeNull();
    game.start(1);
    run(0.1);
    expect(moods.at(-1)).toEqual({ season: 'spring', dawn: 0 });
    game.aim({ x: 200, y: 120 });
    run(1);
    expect(moods.at(-1)?.dawn).toBeGreaterThan(0);
    game.pause();
    run(0.1);
    expect(moods.at(-1)).toBeNull();
    game.resume();
    run(0.1);
    expect(moods.at(-1)?.season).toBe('spring');
    game.open('menu');
    run(0.1);
    expect(moods.at(-1)).toBeNull();
  });

  it('подсказка показывается на первом уровне новичку и молчит для пройденного и для бота', () => {
    const fresh = setup();
    fresh.game.start(1);
    fresh.game.aim({ x: fresh.game.run.dog.x + 1, y: fresh.game.run.dog.y });
    fresh.run(12);
    expect(fresh.tips.some((t) => t !== null)).toBe(true);

    const passed = setup({ save: recordFirst() });
    passed.game.start(1);
    passed.game.aim({ x: passed.game.run.dog.x + 1, y: passed.game.run.dog.y });
    passed.run(12);
    expect(passed.tips.every((t) => t === null)).toBe(true);

    const bot = setup({ autopilot: true });
    bot.game.start(1);
    bot.run(12);
    expect(bot.tips.every((t) => t === null)).toBe(true);
  });

  it('далёкий уровень — без подсказок', () => {
    const { game, tips, run } = setup({ level: 6 });
    game.start(6);
    game.aim({ x: game.run.dog.x + 1, y: game.run.dog.y });
    run(12);
    expect(tips.every((t) => t === null)).toBe(true);
  });

  it('плейтест: пишет законченную попытку и брошенную; не начатая не считается', () => {
    const attempts: Attempt[] = [];
    const log: PlaytestLog = { add: (a) => attempts.push(a), all: () => attempts };
    const { game, run } = setup({ playtest: log });
    game.start(0);
    game.restart();
    expect(attempts).toEqual([]);
    game.steer({ x: 1, y: 0 });
    run(1);
    game.restart();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.quit).toBe(true);
    expect(attempts[0]?.controls).toBe('keys');

    game.start(1);
    game.aim({ x: 30, y: 200 });
    run(135);
    expect(game.screen).toBe('result');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.quit).toBe(false);
    expect(attempts[1]?.dawn).toBe(true);
    expect(attempts[1]?.controls).toBe('pointer');
    // Из итога в меню — не бросил: попытка уже записана.
    game.open('menu');
    expect(attempts).toHaveLength(2);
  });
});

/** Сохранение, где пройден первый уровень. */
function recordFirst(): Save {
  return {
    ...emptySave(),
    levels: { '1': { stars: 1, saved: 5, time: null } },
  };
}
