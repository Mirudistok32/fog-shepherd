import type { Clock } from '@/application/ports/clock';

export const systemClock: Clock = {
  nowIso: () => new Date().toISOString(),
};
