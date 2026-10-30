import { BOT_START, type BotMemory, shepherd } from '@/domain/bot';
import { type HerdEvent, IDLE, type Input, type Run, startRun, step } from '@/domain/herd';
import { assembleLevel, type Level, type LevelParts, type PenPlan } from '@/domain/level';

export const DT = 1 / 120;

/** Загон у плетня справа, ворота вниз. */
export const PEN_RIGHT: PenPlan = {
  col0: 80,
  row0: 8,
  iw: 8,
  ih: 6,
  side: 'bottom',
  from: 82,
  gw: 5,
};

/** Пустой луг с загоном справа; препятствия и овец задаёт тест. */
export function field(parts: Partial<LevelParts> & Pick<LevelParts, 'sheep'>): Level {
  return assembleLevel({ pen: PEN_RIGHT, dog: { x: 40, y: 190 }, ...parts });
}

/** Забег уже начался: собака стоит на месте, время идёт. */
export const started = (level: Level): Run =>
  step(startRun(level), level, { ...IDLE, target: { ...level.dog } }, DT).run;

export const stay = (run: Run): Input => ({ ...IDLE, target: { x: run.dog.x, y: run.dog.y } });

/** Шагает seconds секунд с вводом input(run); each — проверка после каждого шага. */
export function simulate(
  level: Level,
  seconds: number,
  input: (run: Run) => Input = stay,
  from: Run = started(level),
  each?: (run: Run, events: HerdEvent[]) => void,
) {
  let run = from;
  const events: HerdEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const r = step(run, level, input(run), DT);
    run = r.run;
    events.push(...r.events);
    each?.(run, r.events);
    if (run.status === 'done' || run.status === 'dawn') break;
  }
  return { run, events };
}

/** Уровень целиком ведёт бот; limit — сколько секунд ждать (по умолчанию — до рассвета). */
export function withBot(
  level: Level,
  opts: { limit?: number; whistleAlways?: boolean; each?: (run: Run) => void } = {},
) {
  let memory: BotMemory = BOT_START;
  const timed = opts.limit ? { ...level, spec: { ...level.spec, time: opts.limit } } : level;
  return simulate(
    timed,
    (opts.limit ?? level.spec.time) + 1,
    (run) => {
      const b = shepherd(run, timed, memory);
      memory = b.memory;
      return opts.whistleAlways ? { ...b.input, whistle: true } : b.input;
    },
    startRun(timed),
    opts.each ? (run) => opts.each?.(run) : undefined,
  );
}

export const spread = (pts: readonly { x: number; y: number }[]): number => {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
};

export const centroid = (pts: readonly { x: number; y: number }[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** Кучка овец вокруг точки на расстоянии ~9 друг от друга. */
export function flockAt(x: number, y: number, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; out.length < n; i++) {
    const a = i * 2.399;
    const r = 9 * Math.sqrt(i) * 0.55 + (i === 0 ? 0 : 3);
    out.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  return out;
}
