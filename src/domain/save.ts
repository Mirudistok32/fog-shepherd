/**
 * Сохранение: настройки, лучшие итоги по уровням, ачивки и общий счёт. Формат описан в
 * docs/save-format.md; поля не переименовываются без миграции.
 */

import { type AchievementId, earnedBy, isAchievementId } from './achievements';
import { LEVEL_COUNT } from './level';
import type { RunResult, Stars } from './score';
import { isSeason, type Season, SEASONS } from './season';

export const SAVE_VERSION = 1;
export const BACKUP_FORMAT = 'fog-shepherd-backup';
/** Больше этого файл копии точно не наш. */
export const BACKUP_MAX_BYTES = 200_000;

export type Theme = 'system' | 'light' | 'dark';
const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

export interface LevelBest {
  stars: Stars;
  /** Больше всего овец в загоне за одну игру. */
  saved: number;
  /** Лучшее время, когда в загоне всё стадо; null — такого ещё не было. */
  time: number | null;
}

export interface Save {
  schemaVersion: typeof SAVE_VERSION;
  sound: boolean;
  theme: Theme;
  /** Последний выбранный уровень (0 — тренировка). */
  level: number;
  /** Номер уровня строкой → лучшее. */
  levels: Partial<Record<string, LevelBest>>;
  /** id → когда открыта (ISO). */
  achievements: Partial<Record<AchievementId, string>>;
  stats: {
    runs: number;
    /** Сколько раз всё стадо оказалось в загоне. */
    flocks: number;
    penned: number;
    lost: number;
    whistles: number;
    /** Времена года, в которые пройден уровень кампании. */
    seasons: Season[];
  };
}

export const emptySave = (): Save => ({
  schemaVersion: SAVE_VERSION,
  sound: true,
  theme: 'system',
  level: 0,
  levels: {},
  achievements: {},
  stats: { runs: 0, flocks: 0, penned: 0, lost: 0, whistles: 0, seasons: [] },
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
const isLevel = (n: number) => Number.isInteger(n) && n >= 0 && n <= LEVEL_COUNT;

/** Открыт ли уровень: тренировка и первый — всегда, дальше — после звезды на предыдущем. */
export const isUnlocked = (save: Save, n: number): boolean =>
  n <= 1 || (save.levels[String(n - 1)]?.stars ?? 0) >= 1;

function parseBest(v: unknown): LevelBest | null {
  if (!isRecord(v)) return null;
  const stars = count(v.stars);
  const saved = count(v.saved);
  const time = v.time;
  if (stars === null || stars > 3 || saved === null) return null;
  if (time !== null && !(typeof time === 'number' && Number.isFinite(time) && time > 0))
    return null;
  return { stars: stars as Stars, saved, time };
}

/** Проверяет форму данных. null — данные чужие или повреждены. */
export function parseSave(raw: unknown): Save | null {
  if (!isRecord(raw) || raw.schemaVersion !== SAVE_VERSION) return null;
  const save = emptySave();
  if (typeof raw.sound === 'boolean') save.sound = raw.sound;
  if (THEMES.includes(raw.theme as Theme)) save.theme = raw.theme as Theme;
  if (typeof raw.level === 'number' && isLevel(raw.level)) save.level = raw.level;

  if (raw.levels !== undefined) {
    if (!isRecord(raw.levels)) return null;
    for (const [key, value] of Object.entries(raw.levels)) {
      const n = Number(key);
      // Уровни из версии новее пропускаем, а не теряем весь файл.
      if (!/^\d+$/.test(key) || !isLevel(n)) continue;
      const best = parseBest(value);
      if (!best) return null;
      save.levels[key] = best;
    }
  }
  if (raw.achievements !== undefined) {
    if (!isRecord(raw.achievements)) return null;
    for (const [id, at] of Object.entries(raw.achievements)) {
      if (isAchievementId(id) && typeof at === 'string') save.achievements[id] = at;
    }
  }
  if (raw.stats !== undefined) {
    const s = raw.stats;
    if (!isRecord(s)) return null;
    const nums = [s.runs, s.flocks, s.penned, s.lost, s.whistles].map(count);
    if (nums.some((v) => v === null)) return null;
    const [runs, flocks, penned, lost, whistles] = nums as number[];
    const seasons: unknown = s.seasons;
    if (!Array.isArray(seasons) || !seasons.every(isSeason)) return null;
    save.stats = {
      runs: runs ?? 0,
      flocks: flocks ?? 0,
      penned: penned ?? 0,
      lost: lost ?? 0,
      whistles: whistles ?? 0,
      seasons: SEASONS.filter((x) => seasons.includes(x)),
    };
  }
  return save;
}

const goldLevels = (levels: Save['levels']): number => {
  let n = 0;
  for (let k = 1; k <= LEVEL_COUNT; k++) if (levels[String(k)]?.stars === 3) n++;
  return n;
};

export interface RecordedRun {
  save: Save;
  unlocked: AchievementId[];
  /** Лучше прежнего: больше звёзд или быстрее со всем стадом. */
  record: boolean;
  best: LevelBest;
}

/** Записывает итог уровня. Повтор того же итога не открывает ачивку дважды. */
export function recordRun(save: Save, r: RunResult, nowIso: string): RecordedRun {
  const key = String(r.level);
  const prev = save.levels[key];
  const best: LevelBest = {
    stars: Math.max(prev?.stars ?? 0, r.stars) as Stars,
    saved: Math.max(prev?.saved ?? 0, r.saved),
    time: r.allIn && (prev?.time == null || r.time < prev.time) ? r.time : (prev?.time ?? null),
  };
  const record =
    prev === undefined
      ? r.stars > 0
      : r.stars > prev.stars || (r.allIn && (prev.time === null || r.time < prev.time));
  const levels = { ...save.levels, [key]: best };
  const passed = r.level >= 1 && r.stars >= 1;
  const stats = {
    runs: save.stats.runs + 1,
    flocks: save.stats.flocks + (r.allIn ? 1 : 0),
    penned: save.stats.penned + r.saved,
    lost: save.stats.lost + r.lost,
    whistles: save.stats.whistles + r.whistles,
    seasons:
      passed && !save.stats.seasons.includes(r.season)
        ? SEASONS.filter((s) => s === r.season || save.stats.seasons.includes(s))
        : save.stats.seasons,
  };
  const unlocked = earnedBy(r, {
    penned: stats.penned,
    seasons: stats.seasons,
    gold: goldLevels(levels),
    levels: LEVEL_COUNT,
  }).filter((id) => save.achievements[id] === undefined);
  const achievements = { ...save.achievements };
  for (const id of unlocked) achievements[id] = nowIso;
  return {
    save: { ...save, level: r.level, levels, achievements, stats },
    unlocked,
    record,
    best,
  };
}

/* ---------- резервная копия ---------- */

export interface Backup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof SAVE_VERSION;
  exportedAt: string;
  appVersion: string;
  data: Save;
}

export const makeBackup = (save: Save, nowIso: string, appVersion: string): Backup => ({
  format: BACKUP_FORMAT,
  schemaVersion: SAVE_VERSION,
  exportedAt: nowIso,
  appVersion,
  data: save,
});

/** `fog-shepherd-backup-2026-10-30.json` */
export const backupFileName = (nowIso: string) => `fog-shepherd-backup-${nowIso.slice(0, 10)}.json`;

export type BackupProblem = 'empty' | 'too-big' | 'not-json' | 'foreign' | 'newer' | 'broken';

export type BackupRead = { ok: true; save: Save } | { ok: false; problem: BackupProblem };

export function readBackup(text: string): BackupRead {
  if (text.trim() === '') return { ok: false, problem: 'empty' };
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, problem: 'too-big' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'not-json' };
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) return { ok: false, problem: 'foreign' };
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SAVE_VERSION) {
    return { ok: false, problem: 'newer' };
  }
  const save = parseSave(raw.data);
  return save ? { ok: true, save } : { ok: false, problem: 'broken' };
}

/**
 * Объединение копии с текущим: по каждому уровню — лучшее из двух, ачивки — все (с самой
 * ранней датой), итоги — большие. Настройки остаются текущими. Повторный импорт ничего не меняет.
 */
export function mergeSaves(current: Save, incoming: Save): Save {
  const levels: Save['levels'] = { ...current.levels };
  for (const [key, b] of Object.entries(incoming.levels)) {
    if (!b) continue;
    const a = levels[key];
    if (!a) {
      levels[key] = b;
      continue;
    }
    const times = [a.time, b.time].filter((t): t is number => t !== null);
    levels[key] = {
      stars: Math.max(a.stars, b.stars) as Stars,
      saved: Math.max(a.saved, b.saved),
      time: times.length > 0 ? Math.min(...times) : null,
    };
  }
  const achievements: Save['achievements'] = { ...current.achievements };
  for (const [id, at] of Object.entries(incoming.achievements) as [AchievementId, string][]) {
    const mine = achievements[id];
    achievements[id] = mine === undefined || at < mine ? at : mine;
  }
  const s = current.stats;
  const t = incoming.stats;
  return {
    ...current,
    levels,
    achievements,
    stats: {
      runs: Math.max(s.runs, t.runs),
      flocks: Math.max(s.flocks, t.flocks),
      penned: Math.max(s.penned, t.penned),
      lost: Math.max(s.lost, t.lost),
      whistles: Math.max(s.whistles, t.whistles),
      seasons: SEASONS.filter((x) => s.seasons.includes(x) || t.seasons.includes(x)),
    },
  };
}
