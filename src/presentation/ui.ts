/**
 * DOM вокруг холста: экраны, HUD, ввод (мышь, палец, клавиатура), фокус и объявления для
 * скринридеров. Тексты экранов — в index.html, подписи на лету — в content/texts.ts.
 */

import { exportBackup, importBackup } from '@/application/backup';
import type { Ending, Frame, Game, GameView, Screen } from '@/application/game';
import type { Clock } from '@/application/ports/clock';
import type { PlaytestLog } from '@/application/ports/playtestLog';
import type { SaveStore } from '@/application/saveStore';
import {
  ACHIEVEMENTS,
  BACKUP_PROBLEMS,
  clock as mmss,
  dayMonth,
  levelName,
  plural,
  SEASON_NAMES,
  shareText,
  sheepCount,
  starsLabel,
  TIPS,
} from '@/content/texts';
import { ACHIEVEMENT_IDS, type AchievementId } from '@/domain/achievements';
import { dailyDate, dailyLevel, dailyQuery } from '@/domain/daily';
import { dawnOf } from '@/domain/fog';
import type { HerdEvent, Run } from '@/domain/herd';
import { type Level, LEVEL_COUNT, specOf } from '@/domain/level';
import { playtestReport } from '@/domain/playtest';
import type { Theme } from '@/domain/save';
import { PASS_SHARE } from '@/domain/score';
import { WHISTLE_COOLDOWN, WORLD_H, WORLD_W } from '@/domain/world';

import { copyText, downloadText } from './files';
import type { Minimap } from './minimap';
import { type Renderer, viewWidth } from './render';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`нет элемента #${id}`);
  return el as T;
};

const SCREENS: readonly Screen[] = ['menu', 'help', 'achievements', 'paused', 'result'];
const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = {
  system: 'Тема: как в системе',
  light: 'Тема: светлая',
  dark: 'Тема: тёмная',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

const starRow = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** Подписи кнопок звука в меню и на паузе. */
function showSound(on: boolean) {
  for (const id of ['btn-sound', 'btn-sound-pause']) {
    const button = $(id);
    button.textContent = on ? 'Звук: включён' : 'Звук: выключен';
    button.setAttribute('aria-pressed', String(on));
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Отступ мини-карты от луга и края экрана и её наименьшая высота под лугом. */
const MAP_GAP = 8;
const MAP_MIN_H = 56;
const MAP_SIDE = 16;
/** Высота HUD поверх луга: карта в углу луга — ниже него. */
const MAP_HUD = 56;

/**
 * Подгоняет холст под окно: высота мира всегда WORLD_H, ширина — по пропорциям окна. Если луг
 * не влез целиком, рядом появляется мини-карта: под лугом, а если места нет — в его углу.
 */
export function fitStage(renderer: Renderer) {
  const app = $('app');
  const tip = $('rotate-tip');
  const css = getComputedStyle(app);
  const w = app.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const h =
    app.clientHeight -
    parseFloat(css.paddingTop) -
    parseFloat(css.paddingBottom) -
    (tip.offsetParent ? tip.offsetHeight + 12 : 0);
  const viewW = viewWidth(w, h);
  if (viewW !== renderer.width) renderer.resize(viewW);
  const cssW = Math.min(w, (h * viewW) / WORLD_H);
  const cssH = (cssW * WORLD_H) / viewW;
  const stage = $('stage');
  stage.style.width = `${Math.floor(cssW)}px`;
  stage.style.height = `${Math.floor(cssH)}px`;
  stage.style.aspectRatio = 'auto';
  const map = $('minimap');
  map.hidden = viewW >= WORLD_W;
  if (map.hidden) {
    stage.style.marginBottom = '0';
    return;
  }
  const room = h - cssH - MAP_GAP * 2;
  const below = room >= MAP_MIN_H;
  const mapH = below
    ? Math.min(room, ((w - MAP_SIDE * 2) * WORLD_H) / WORLD_W)
    : (Math.min(200, cssW * 0.3) * WORLD_H) / WORLD_W;
  const mapW = (mapH * WORLD_W) / WORLD_H;
  map.style.width = `${Math.floor(mapW)}px`;
  map.style.height = `${Math.floor(mapH)}px`;
  stage.style.marginBottom = below ? `${Math.floor(mapH + MAP_GAP)}px` : '0';
  const box = stage.getBoundingClientRect();
  map.style.left = below
    ? `${Math.floor(box.left + (box.width - mapW) / 2)}px`
    : `${Math.floor(box.left + MAP_GAP)}px`;
  // В углу луга — слева сверху, под HUD: внизу подсказки и кнопка свиста.
  map.style.top = below
    ? `${Math.floor(box.bottom + MAP_GAP)}px`
    : `${Math.floor(box.top + MAP_HUD)}px`;
}

/** Чем закончился уровень — заголовок и одна фраза. */
function verdict(e: Ending): { title: string; text: string } {
  const r = e.result;
  const rest = r.total - r.saved - r.lost;
  if (r.allIn) {
    return {
      title: 'Все дома',
      text: `Все ${sheepCount(r.total)} в загоне за ${mmss(r.time)}.`,
    };
  }
  const parts = [`В загоне ${r.saved} из ${r.total}.`];
  if (r.lost > 0) parts.push(`${r.lost} ${plural(r.lost, 'ушла', 'ушли', 'ушли')} в лес.`);
  if (rest > 0) {
    parts.push(`${rest} ${plural(rest, 'осталась', 'остались', 'остались')} в тумане.`);
  }
  if (r.stars === 0) {
    parts.push(`Для звезды нужно хотя бы ${Math.ceil(r.total * PASS_SHARE - 1e-9)}.`);
  }
  return { title: r.dawn ? 'Рассвело' : 'Не все дома', text: parts.join(' ') };
}

/** Название раскладки в итоге и в ссылке: задание дня, свой сид или уровень. */
function layoutTitle(seed: string | null, level: number): string {
  const date = dailyDate(seed);
  if (date && seed && dailyLevel(seed) === level) return `задание дня ${dayMonth(date)}`;
  return seed ? `раскладка «${seed}», уровень ${level}` : levelName(level).toLowerCase();
}

/** Адрес этой раскладки для друга: с диска ссылка бесполезна, поэтому — адрес сайта. */
function shareUrl(seed: string | null, level: number): string {
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const base =
    location.protocol === 'file:' && canonical ? canonical : location.origin + location.pathname;
  const query = new URLSearchParams();
  if (seed) query.set('seed', seed);
  query.set('level', String(level));
  return `${base}?${query.toString()}`;
}

export function createView(deps: {
  renderer: Renderer;
  minimap: Minimap;
  store: SaveStore;
  game: () => Game;
  playtest: boolean;
  reducedMotion: () => boolean;
}): GameView {
  const { renderer, minimap, store, playtest, reducedMotion } = deps;
  const stage = $('stage');
  const hud = $('hud');
  const hint = $('hint');
  const tipBox = $('coach');
  const map = $('minimap');
  const whistle = $('btn-whistle');
  const timeBox = $('hud-time');
  const timeLeft = $('hud-time-left');
  const timeFill = $('hud-time-fill');
  const penned = $('hud-penned');
  const sheepBox = $('hud-sheep');
  const lostBox = $('hud-lost');
  const lostCount = $('hud-lost-count');
  const announcer = $('announcer');
  const toasts = $('toasts');
  let shown: Screen = 'menu';
  const last = { left: -1, fill: -1, penned: '', lost: -1, ready: false, cd: -1, dog: '' };
  let shownTip: Frame['tip'] = null;

  const announce = (text: string) => {
    announcer.textContent = '';
    requestAnimationFrame(() => (announcer.textContent = text));
  };

  const toast = (text: string) => {
    const node = el('div', 'toast', text);
    toasts.append(node);
    setTimeout(() => node.remove(), 2600);
  };

  const updateHud = (run: Run, level: Level) => {
    const left = Math.ceil(Math.max(0, level.spec.time - run.t));
    if (left !== last.left) {
      last.left = left;
      timeLeft.textContent = mmss(left);
      timeBox.classList.toggle('late', left <= 20);
      timeBox.setAttribute('aria-label', `До рассвета ${mmss(left)}`);
    }
    const fill = Math.round(dawnOf(level, run.t) * 200) / 2;
    if (fill !== last.fill) timeFill.style.width = `${(last.fill = fill)}%`;
    const p = `${run.penned} / ${run.sheep.length}`;
    if (p !== last.penned) {
      last.penned = p;
      penned.textContent = p;
      sheepBox.setAttribute('aria-label', `В загоне ${run.penned} из ${run.sheep.length}`);
    }
    if (run.lost !== last.lost) {
      last.lost = run.lost;
      lostCount.textContent = String(run.lost);
      lostBox.hidden = run.lost === 0;
    }
    const cd = Math.round((run.cooldown / WHISTLE_COOLDOWN) * 20) / 20;
    if (cd !== last.cd) {
      last.cd = cd;
      whistle.style.setProperty('--cd', String(cd));
      whistle.setAttribute('aria-disabled', String(cd > 0));
    }
    const ready = run.status === 'ready';
    if (ready !== last.ready) hint.hidden = !(last.ready = ready);
    // Где собака — в атрибуте сцены: по нему e2e проверяет, что она бежит куда надо.
    const dog = `${Math.round(run.dog.x)},${Math.round(run.dog.y)}`;
    if (dog !== last.dog) stage.dataset.dog = last.dog = dog;
  };

  const showTip = (tip: Frame['tip']) => {
    if (tip === shownTip) return;
    shownTip = tip;
    tipBox.hidden = tip === null;
    if (tip === null) return;
    tipBox.textContent = TIPS[tip];
    announce(TIPS[tip]);
  };

  const fillSeedNote = (seed: string | null, n: number) => {
    const date = dailyDate(seed);
    const daily = date !== null && seed !== null && dailyLevel(seed) === n;
    $('btn-daily').hidden = seed !== null;
    $('seed-note').hidden = seed === null;
    if (seed === null) return;
    $('seed-text').textContent = daily
      ? `Задание дня ${dayMonth(date)}: одна раскладка на всех. В рекорды не идёт — поделитесь итогом.`
      : `Своя раскладка «${seed}»: все уровни открыты, в рекорды не идёт.`;
  };

  const fillMenu = () => {
    const game = deps.game();
    const save = store.get();
    fillSeedNote(game.seed, game.selected);
    $('playtest-note').hidden = !playtest;
    $('copy-message').hidden = true;
    $('copy-box').hidden = true;
    const list = $('level-list');
    const items: HTMLElement[] = [];
    for (let n = 0; n <= LEVEL_COUNT; n++) {
      const spec = specOf(n);
      const open = game.isOpen(n);
      const stars = save.levels[String(n)]?.stars ?? 0;
      const label = el('label', `level${n === 0 ? ' training' : ''}${open ? '' : ' locked'}`);
      label.dataset.season = spec.season;
      const input = el('input', '');
      input.type = 'radio';
      input.name = 'level';
      input.value = String(n);
      input.checked = n === game.selected;
      input.disabled = !open;
      input.setAttribute(
        'aria-label',
        open
          ? `${levelName(n)}, ${SEASON_NAMES[spec.season].toLowerCase()}, ${starsLabel(stars)}`
          : `${levelName(n)} закрыт: нужна звезда на предыдущем`,
      );
      label.append(
        input,
        el('span', 'level-num', n === 0 ? 'Тренировка' : String(n)),
        open ? el('span', 'level-stars', starRow(stars)) : el('span', 'level-lock', 'закрыт'),
      );
      items.push(label);
    }
    list.replaceChildren(...items);
    const n = game.selected;
    const spec = specOf(n);
    const best = save.levels[String(n)];
    const about =
      n === 0
        ? 'Тренировка: три овцы у самых ворот, тумана нет.'
        : `${levelName(n)} · ${SEASON_NAMES[spec.season].toLowerCase()} · ${sheepCount(spec.sheep)}` +
          `${spec.stream ? ' · ручей' : ''} · до рассвета ${mmss(spec.time)}.`;
    const record = best
      ? ` Лучшее: ${starRow(best.stars)}, ${best.saved} из ${spec.sheep}` +
        `${best.time !== null ? `, всё стадо за ${mmss(best.time)}` : ''}.`
      : '';
    $('level-note').textContent = about + record;
    $('btn-start').textContent = n === 0 ? 'Играть: тренировка' : `Играть: уровень ${n}`;
    const open = ACHIEVEMENT_IDS.filter((id) => save.achievements[id]).length;
    $('ach-count').textContent = `${open} из ${ACHIEVEMENT_IDS.length}`;
    showSound(save.sound);
    $('btn-theme').textContent = THEME_LABEL[save.theme];
    const notice = $('save-notice');
    const problem =
      store.problem === 'corrupt'
        ? 'Прежнее сохранение не прочиталось, игра начата заново. Старые данные не стёрты: они отложены в браузере отдельно.'
        : store.problem === 'unavailable' || store.status() === 'error'
          ? 'Браузер не даёт сохранять: рекорды и ачивки проживут до закрытия вкладки. Копию можно скачать на экране ачивок.'
          : '';
    notice.textContent = problem;
    notice.classList.toggle('error', problem !== '');
    notice.hidden = problem === '';
  };

  const achievementItem = (id: AchievementId, open: boolean) => {
    const li = el('li', open ? 'ach open' : 'ach');
    li.append(
      el('span', 'ach-mark', open ? '✓' : '?'),
      el('span', 'ach-title', ACHIEVEMENTS[id].title),
      el(
        'span',
        'ach-desc',
        open ? ACHIEVEMENTS[id].desc : `${ACHIEVEMENTS[id].desc} — пока не открыта`,
      ),
    );
    return li;
  };

  const fillAchievements = () => {
    const save = store.get();
    $('ach-list').replaceChildren(
      ...ACHIEVEMENT_IDS.map((id) => achievementItem(id, !!save.achievements[id])),
    );
  };

  const fillResult = (e: Ending) => {
    const r = e.result;
    const seed = deps.game().seed;
    const daily = dailyDate(seed) !== null && seed !== null && dailyLevel(seed) === r.level;
    const who =
      e.unrecorded === 'autopilot'
        ? ' · вёл бот'
        : daily
          ? ' · задание дня, в рекорды не идёт'
          : e.unrecorded === 'seed'
            ? ' · своя раскладка, в рекорды не идёт'
            : '';
    $('result-level').textContent =
      `${levelName(r.level)} · ${SEASON_NAMES[r.season].toLowerCase()}${who}`;
    $('btn-share').hidden = e.unrecorded !== 'seed';
    $('btn-report').hidden = !playtest;
    $('share-message').hidden = true;
    $('share-box').hidden = true;
    const v = verdict(e);
    $('result-title').textContent = v.title;
    $('result-text').textContent = v.text;
    const stars = $('result-stars');
    stars.replaceChildren(
      ...[0, 1, 2].map((i) => el('span', i < r.stars ? 'on' : 'off', i < r.stars ? '★' : '☆')),
    );
    stars.setAttribute('aria-label', starsLabel(r.stars));
    $('result-record').hidden = !e.record;
    const rows: [string, string, boolean?][] = [
      ['В загоне', `${r.saved} из ${r.total}`, true],
      ['Ушли в лес', String(r.lost)],
      ['Время', `${mmss(r.time)} (норматив ${mmss(r.par)})`],
      ['Свистков', String(r.whistles)],
    ];
    if (e.best) {
      rows.push([
        'Лучшее на уровне',
        `${starRow(e.best.stars)}${e.best.time !== null ? `, ${mmss(e.best.time)}` : ''}`,
      ]);
    }
    $('result-stats').replaceChildren(
      ...rows.flatMap(([k, val, total]) => [
        el('dt', total ? 'total' : '', k),
        el('dd', total ? 'total' : '', val),
      ]),
    );
    $('result-unlocked').hidden = e.unlocked.length === 0;
    $('result-unlocked-list').replaceChildren(...e.unlocked.map((id) => achievementItem(id, true)));
    const next = $('btn-next');
    next.hidden = e.next === null;
    if (e.next !== null) next.textContent = `Дальше: уровень ${e.next}`;
    $('btn-again').classList.toggle('primary', e.next === null);
  };

  return {
    frame(frame: Frame) {
      renderer.draw(frame);
      const playing = !frame.demo && (shown === 'playing' || shown === 'paused');
      if (playing) updateHud(frame.run, frame.level);
      if (playing && !map.hidden) {
        minimap.draw(frame, renderer.camera, renderer.width, reducedMotion());
      }
      showTip(frame.demo ? null : frame.tip);
    },
    screen(screen, ending) {
      shown = screen;
      const playing = screen === 'playing' || screen === 'paused';
      hud.hidden = !playing;
      whistle.hidden = !playing;
      map.classList.toggle('waiting', !playing);
      if (!playing) {
        hint.hidden = true;
        showTip(null);
      }
      if (screen === 'playing') {
        last.left = last.fill = last.lost = last.cd = -1;
        last.penned = '';
        last.ready = false;
      }
      if (screen === 'menu') fillMenu();
      if (screen === 'paused') showSound(store.get().sound);
      if (screen === 'achievements') fillAchievements();
      if (ending && screen === 'result') fillResult(ending);
      for (const s of SCREENS) $(`screen-${s}`).hidden = s !== screen;
      const focus =
        screen === 'playing'
          ? stage
          : document.querySelector<HTMLElement>(`#screen-${screen} [tabindex="-1"]`);
      focus?.focus({ preventScroll: true });
      if (ending && screen === 'result') {
        announce(
          `${verdict(ending).title}. ${verdict(ending).text} ${starsLabel(ending.result.stars)}.`,
        );
      }
    },
    events(events: readonly HerdEvent[], run: Run) {
      renderer.events(events);
      minimap.events(events);
      for (const e of events) {
        if (e.type === 'stray') {
          toast('Овца уходит в лес!');
          announce('Овца уходит в лес — верните её.');
        } else if (e.type === 'lost') {
          toast('Овца потерялась в лесу');
          announce(`Овца потерялась в лесу. В лесу: ${e.count}.`);
        } else if (e.type === 'penned' && (e.count % 5 === 0 || e.count === run.sheep.length)) {
          announce(`В загоне ${e.count} из ${run.sheep.length}.`);
        }
      }
    },
  };
}

/** Кнопки, клавиши, мышь, палец и файлы. */
export function bindControls(deps: {
  game: Game;
  store: SaveStore;
  clock: Clock;
  renderer: Renderer;
  minimap: Minimap;
  playtest: PlaytestLog | null;
  appVersion: string;
}) {
  const { game, store, clock, renderer, minimap, playtest, appVersion } = deps;
  const stage = $('stage');
  const canvas = $<HTMLCanvasElement>('scene');
  const map = $<HTMLCanvasElement>('minimap');
  const backupMessage = $('backup-message');

  const say = (text: string, error = false) => {
    backupMessage.textContent = text;
    backupMessage.classList.toggle('error', error);
    backupMessage.hidden = false;
  };

  /** Скопировать текст; не вышло — показать его, чтобы можно было выделить вручную. */
  const copy = async (text: string, message: string, messageId: string, boxId: string) => {
    const done = await copyText(text);
    const note = $(messageId);
    const box = $<HTMLTextAreaElement>(boxId);
    note.hidden = false;
    note.textContent = done ? message : 'Скопировать не вышло — выделите текст ниже.';
    box.hidden = done;
    if (!done) {
      box.value = text;
      box.focus();
      box.select();
    }
  };
  /** Куда выводить итог копирования: на экране итога или в меню. */
  const copyTargets = (): [string, string] =>
    game.screen === 'result' ? ['share-message', 'share-box'] : ['copy-message', 'copy-box'];

  const actions: Record<string, () => void> = {
    start: () => game.start(),
    daily: () => location.assign(dailyQuery(clock.nowIso())),
    'copy-link': () => {
      void copy(shareUrl(game.seed, game.selected), 'Ссылка скопирована.', ...copyTargets());
    },
    share: () => {
      const r = game.ending?.result;
      if (!r) return;
      void copy(
        shareText(r, layoutTitle(game.seed, r.level), shareUrl(game.seed, r.level)),
        'Итог скопирован: вставьте его в сообщение другу.',
        ...copyTargets(),
      );
    },
    'copy-report': () => {
      if (!playtest) return;
      void copy(
        playtestReport(playtest.all(), clock.nowIso(), appVersion),
        `Отчёт скопирован, попыток: ${playtest.all().length}. Пришлите его автору.`,
        ...copyTargets(),
      );
    },
    restart: () => game.restart(),
    next: () => {
      const n = game.ending?.next;
      if (n != null) game.start(n);
    },
    help: () => game.open('help'),
    achievements: () => {
      backupMessage.hidden = true;
      game.open('achievements');
    },
    menu: () => game.open('menu'),
    pause: () => game.pause(),
    resume: () => game.resume(),
    whistle: () => game.whistle(),
    sound: () => {
      const on = game.toggleSound();
      // В меню перерисовываем экран; на паузе — только подписи, паузу не снимаем.
      if (game.screen === 'menu') game.open('menu');
      else showSound(on);
    },
    theme: () => {
      const next = THEME_NEXT[store.get().theme];
      game.setTheme(next);
      applyTheme(next);
      game.open('menu');
    },
    export: () => {
      const file = exportBackup(store, clock, appVersion);
      downloadText(file.fileName, file.text);
      say(`Копия сохранена в файл ${file.fileName}.`);
    },
  };

  document.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    const action = target?.dataset.action;
    if (action && actions[action]) actions[action]();
  });

  $('level-list').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== 'level' || !input.checked) return;
    game.select(Number(input.value));
    game.open('menu');
    document
      .querySelector<HTMLInputElement>(`input[name="level"][value="${input.value}"]`)
      ?.focus();
  });

  $<HTMLInputElement>('import-file').addEventListener('change', async (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const outcome = importBackup(store, await file.text());
    if (outcome.ok) {
      say(
        `Копия «${file.name}» загружена. Открыто ачивок: ${outcome.achievements}, уровней со звёздами: ${outcome.levels}.`,
      );
      game.open('achievements');
      backupMessage.hidden = false;
    } else {
      say(
        `Файл «${file.name}» не подошёл. ${BACKUP_PROBLEMS[outcome.problem]} Текущие данные не изменены.`,
        true,
      );
    }
  });

  // Мышь: собака бежит за курсором, пока он над лугом. Палец: туда, где касание, и дальше
  // за пальцем; отпустили — добегает до последней точки.
  const world = (e: PointerEvent) =>
    renderer.toWorld(e.clientX, e.clientY, canvas.getBoundingClientRect());
  const overControl = (e: PointerEvent) =>
    !!(e.target as HTMLElement).closest('button, a, input, label, .card');
  let touching: number | null = null;
  stage.addEventListener('pointerdown', (e) => {
    if (game.screen !== 'playing' || overControl(e)) return;
    e.preventDefault();
    touching = e.pointerId;
    stage.setPointerCapture?.(e.pointerId);
    game.aim(world(e));
  });
  stage.addEventListener('pointermove', (e) => {
    if (game.screen !== 'playing') return;
    if (
      touching === e.pointerId ||
      (e.pointerType === 'mouse' && touching === null && !overControl(e))
    )
      game.aim(world(e));
  });
  const lift = (e: PointerEvent) => {
    if (touching === e.pointerId) touching = null;
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && touching === null) game.aim(null);
  });

  // Мини-карта: нажатие посылает собаку в эту точку луга, палец можно вести дальше.
  let onMap: number | null = null;
  const mapPoint = (e: PointerEvent) =>
    minimap.toWorld(e.clientX, e.clientY, map.getBoundingClientRect());
  map.addEventListener('pointerdown', (e) => {
    if (game.screen !== 'playing') return;
    e.preventDefault();
    onMap = e.pointerId;
    map.setPointerCapture?.(e.pointerId);
    game.aim(mapPoint(e));
  });
  map.addEventListener('pointermove', (e) => {
    if (onMap === e.pointerId && game.screen === 'playing') game.aim(mapPoint(e));
  });
  const leaveMap = (e: PointerEvent) => {
    if (onMap === e.pointerId) onMap = null;
  };
  map.addEventListener('pointerup', leaveMap);
  map.addEventListener('pointercancel', leaveMap);

  const DIRS: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    KeyW: [0, -1],
    ArrowDown: [0, 1],
    KeyS: [0, 1],
    ArrowLeft: [-1, 0],
    KeyA: [-1, 0],
    ArrowRight: [1, 0],
    KeyD: [1, 0],
  };
  const held = new Set<string>();
  const steer = () => {
    let x = 0;
    let y = 0;
    for (const code of held) {
      const d = DIRS[code];
      if (d) {
        x += d[0];
        y += d[1];
      }
    }
    game.steer(x !== 0 || y !== 0 ? { x, y } : null);
  };
  const typing = (e: KeyboardEvent) =>
    e.target instanceof HTMLInputElement && e.target.type === 'file';

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (DIRS[e.code] && game.screen === 'playing') {
      e.preventDefault();
      if (!held.has(e.code)) {
        held.add(e.code);
        steer();
      }
    } else if (e.code === 'Space' && game.screen === 'playing') {
      e.preventDefault();
      if (!e.repeat) game.whistle();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.screen === 'playing' || game.screen === 'paused') {
        e.preventDefault();
        game.togglePause();
      } else if (
        e.code === 'Escape' &&
        (game.screen === 'help' || game.screen === 'achievements')
      ) {
        game.open('menu');
      }
    } else if (e.code === 'KeyM') {
      actions.sound?.();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (held.delete(e.code)) steer();
  });

  // Ушли со вкладки — пауза: стадо не должно разбежаться, пока никто не смотрит.
  const away = () => {
    held.clear();
    touching = null;
    onMap = null;
    game.pause();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) away();
  });
  window.addEventListener('blur', away);
}
