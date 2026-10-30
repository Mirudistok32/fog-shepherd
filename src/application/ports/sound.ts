import type { Season } from '@/domain/season';

export type Cue = 'start' | 'whistle' | 'bleat' | 'penned' | 'stray' | 'lost' | 'flock' | 'dawn';

/** Где звучит: панорама -1…1 (лево — право) и громкость 0–1. */
export interface Place {
  pan: number;
  gain: number;
}

/** Тихий фон: чем ближе рассвет и какое время года. */
export interface Mood {
  season: Season;
  /** Доля ночи 0–1. */
  dawn: number;
}

export interface Sound {
  play(cue: Cue, place?: Place): void;
  /** Фон на этот кадр; null — тишина. Вызывается каждый кадр, должен быть дешёвым. */
  ambience(mood: Mood | null): void;
  setEnabled(on: boolean): void;
}
