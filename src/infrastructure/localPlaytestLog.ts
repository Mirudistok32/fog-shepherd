import type { PlaytestLog } from '@/application/ports/playtestLog';
import { type Attempt, parseAttempts, PLAYTEST_MAX } from '@/domain/playtest';

/** Отдельный ключ: журнал плейтеста не смешивается с сохранением и не попадает в копию. */
export const PLAYTEST_KEY = 'fog-shepherd:playtest';

export function createLocalPlaytestLog(storage: () => Storage = () => localStorage): PlaytestLog {
  let memory: Attempt[] = [];
  try {
    const raw = storage().getItem(PLAYTEST_KEY);
    memory = raw === null ? [] : parseAttempts(JSON.parse(raw));
  } catch {
    memory = [];
  }
  return {
    add(attempt) {
      memory = [...memory, attempt].slice(-PLAYTEST_MAX);
      try {
        storage().setItem(PLAYTEST_KEY, JSON.stringify(memory));
      } catch {
        // не записалось — отчёт всё равно соберётся из памяти, пока вкладка открыта
      }
    },
    all: () => memory,
  };
}
