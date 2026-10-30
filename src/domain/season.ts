/** Время года меняет только вид луга: траву, листву, снег. Правила стада одни на весь год. */

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const isSeason = (value: unknown): value is Season =>
  typeof value === 'string' && (SEASONS as readonly string[]).includes(value);
