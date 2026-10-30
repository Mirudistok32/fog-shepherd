/** Сборка игры: адаптеры → стор → игра → вид. Единственное место, где всё знакомится. */

import './presentation/styles.css';

import { createGame, type Game } from '@/application/game';
import { createSaveStore } from '@/application/saveStore';
import { createLocalPlaytestLog } from '@/infrastructure/localPlaytestLog';
import { createLocalSaveRepository } from '@/infrastructure/localSaveRepository';
import { systemClock } from '@/infrastructure/systemClock';
import { createWebAudioSound } from '@/infrastructure/webAudioSound';
import { createMinimap } from '@/presentation/minimap';
import { createRenderer } from '@/presentation/render';
import { applyTheme, bindControls, createView, fitStage } from '@/presentation/ui';

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const reducedMotion = () => motion.matches;
const renderer = createRenderer(canvas, { reducedMotion });
const minimap = createMinimap(document.getElementById('minimap') as HTMLCanvasElement);
const store = createSaveStore(createLocalSaveRepository());
applyTheme(store.get().theme);

// ?autopilot — уровень ведёт бот; ?seed=… — своя раскладка; ?level=N — открыть уровень N;
// ?playtest — записывать попытки живого игрока и давать скопировать отчёт.
const params = new URLSearchParams(location.search);
const levelParam = params.get('level');
const playtest = params.has('playtest') ? createLocalPlaytestLog() : null;
let game: Game | null = null;
const view = createView({
  renderer,
  minimap,
  store,
  game: () => game as Game,
  playtest: playtest !== null,
  reducedMotion,
});
game = createGame({
  store,
  sound: createWebAudioSound(),
  clock: systemClock,
  view,
  autopilot: params.has('autopilot'),
  seed: params.get('seed'),
  level: levelParam !== null && /^\d+$/.test(levelParam) ? Number(levelParam) : null,
  playtest,
});
bindControls({
  game,
  store,
  clock: systemClock,
  renderer,
  minimap,
  playtest,
  appVersion: __APP_VERSION__,
});

fitStage(renderer);
new ResizeObserver(() => fitStage(renderer)).observe(document.getElementById('app') as HTMLElement);

game.open('menu');
const loop = (ms: number) => {
  game?.tick(ms);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
