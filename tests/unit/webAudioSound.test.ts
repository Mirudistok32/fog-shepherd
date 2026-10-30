import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Mood } from '@/application/ports/sound';
import { createWebAudioSound } from '@/infrastructure/webAudioSound';

// Настоящего звука в jsdom нет: подменяем AudioContext и смотрим, какие голоса заводятся.
function fakeAudio() {
  const stats = { contexts: 0, oscillators: [] as OscillatorType[], loops: 0, windGain: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
    setTargetAtTime: (_v: number) => {},
  });
  const node = () => {
    const n = {
      gain: param(),
      frequency: param(),
      Q: param(),
      pan: param(),
      type: 'sine' as OscillatorType,
      connect: (next: unknown) => next,
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    };
    return n;
  };
  class FakeContext {
    currentTime = 0;
    state = 'running';
    sampleRate = 100;
    destination = node();
    constructor() {
      stats.contexts += 1;
    }
    createGain = () => {
      const g = node();
      g.gain.setTargetAtTime = (v: number) => {
        stats.windGain = v;
      };
      return g;
    };
    createOscillator = () => {
      const o = node();
      const start = o.start;
      o.start = () => {
        stats.oscillators.push(o.type);
        start();
      };
      return o;
    };
    createBiquadFilter = () => node();
    createStereoPanner = () => node();
    createBuffer = (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) });
    createBufferSource = () => {
      stats.loops += 1;
      return { ...node(), buffer: null, loop: false };
    };
    resume = async () => {};
  }
  vi.stubGlobal('AudioContext', FakeContext);
  return stats;
}

/** Много кадров фона подряд. */
function runAmbience(mood: Mood | null, seconds: number, sound = createWebAudioSound()) {
  for (let i = 0; i < seconds * 10; i++) {
    sound.ambience(mood);
  }
  return sound;
}

afterEach(() => vi.unstubAllGlobals());

describe('тихий фон', () => {
  it('в меню контекст не создаётся: звук только после действия игрока', () => {
    const stats = fakeAudio();
    runAmbience(null, 1);
    expect(stats.contexts).toBe(0);
    expect(stats.loops).toBe(0);
  });

  it('в игре дует ветер — один на всю игру, а не новый на каждый кадр', () => {
    const stats = fakeAudio();
    runAmbience({ season: 'winter', dawn: 0.1 }, 2);
    expect(stats.contexts).toBe(1);
    expect(stats.loops).toBe(1);
    expect(stats.windGain).toBeGreaterThan(0);
  });

  it('пауза и выключенный звук глушат ветер', () => {
    const stats = fakeAudio();
    const sound = runAmbience({ season: 'winter', dawn: 0.1 }, 1);
    sound.ambience(null);
    expect(stats.windGain).toBe(0);
    sound.ambience({ season: 'winter', dawn: 0.1 });
    expect(stats.windGain).toBeGreaterThan(0);
    sound.setEnabled(false);
    expect(stats.windGain).toBe(0);
    const before = stats.loops;
    sound.ambience({ season: 'winter', dawn: 0.1 });
    expect(stats.windGain).toBe(0);
    expect(stats.loops).toBe(before);
  });

  it('весенней ночью птицы молчат, на рассвете поют', () => {
    const night = fakeAudio();
    runAmbience({ season: 'spring', dawn: 0.2 }, 1);
    expect(night.oscillators).toEqual([]);
    vi.unstubAllGlobals();
    const dawn = fakeAudio();
    runAmbience({ season: 'spring', dawn: 0.9 }, 1);
    expect(dawn.oscillators.length).toBeGreaterThan(0);
    expect(dawn.oscillators.every((w) => w === 'sine')).toBe(true);
  });

  it('летней ночью — сверчок, зимним утром — ворона вместо песен', () => {
    const summer = fakeAudio();
    runAmbience({ season: 'summer', dawn: 0.2 }, 1);
    expect(summer.oscillators.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
    const winter = fakeAudio();
    runAmbience({ season: 'winter', dawn: 0.9 }, 1);
    expect(winter.oscillators.length).toBeGreaterThan(0);
    expect(winter.oscillators.every((w) => w === 'sawtooth')).toBe(true);
  });
});
