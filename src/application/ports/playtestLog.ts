import type { Attempt } from '@/domain/playtest';

/** Журнал попыток живого игрока (?playtest). Запись не должна ронять игру. */
export interface PlaytestLog {
  add(attempt: Attempt): void;
  all(): Attempt[];
}
