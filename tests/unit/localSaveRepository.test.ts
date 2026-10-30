import { beforeEach, describe, expect, it } from 'vitest';

import { createSaveStore } from '@/application/saveStore';
import { emptySave } from '@/domain/save';
import {
  CORRUPT_KEY,
  createLocalSaveRepository,
  SAVE_KEY,
} from '@/infrastructure/localSaveRepository';

describe('localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('пусто — чистое сохранение без проблем', () => {
    expect(createLocalSaveRepository().load()).toEqual({ save: emptySave(), problem: null });
  });

  it('запись и чтение', () => {
    const repo = createLocalSaveRepository();
    const save = {
      ...emptySave(),
      sound: false,
      level: 2,
      levels: { '1': { stars: 3 as const, saved: 6, time: 31.5 } },
    };
    expect(repo.write(save)).toBe(true);
    expect(repo.load()).toEqual({ save, problem: null });
  });

  it.each([
    ['обрывок JSON', '{"schemaVersion":1,"levels":'],
    ['не JSON вовсе', 'овцы'],
    ['JSON не той формы', '{"schemaVersion":1,"levels":{"1":{"stars":"три"}}}'],
    ['чужая версия', '{"schemaVersion":7}'],
  ])('мусор (%s) не стирается молча: откладывается под отдельный ключ', (_, raw) => {
    localStorage.setItem(SAVE_KEY, raw);
    const loaded = createLocalSaveRepository().load();
    expect(loaded).toEqual({ save: emptySave(), problem: 'corrupt' });
    expect(localStorage.getItem(CORRUPT_KEY)).toBe(raw);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
  });

  it('хранилище недоступно — игра работает, запись сообщает об ошибке', () => {
    const broken = () => {
      throw new Error('SecurityError');
    };
    const repo = createLocalSaveRepository(broken);
    expect(repo.load()).toEqual({ save: emptySave(), problem: 'unavailable' });
    expect(repo.write(emptySave())).toBe(false);
  });

  it('переполнено — запись не удалась, но данные в памяти живы', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const store = createSaveStore(createLocalSaveRepository(() => full));
    store.apply((s) => ({ ...s, sound: false }));
    expect(store.status()).toBe('error');
    expect(store.get().sound).toBe(false);
  });
});
