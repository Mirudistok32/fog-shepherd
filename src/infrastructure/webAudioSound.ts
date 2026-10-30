import type { Cue, Mood, Place, Sound } from '@/application/ports/sound';

/** Один голос синтезатора: тон от f0 к f1, с вибрато и полосовым фильтром «под голос». */
interface Voice {
  f0: number;
  f1: number;
  /** Задержка от начала звука и длительность, с. */
  at: number;
  len: number;
  wave: OscillatorType;
  gain: number;
  /** Вибрато: частота и глубина, Гц. */
  vib?: [number, number];
  /** Полосовой фильтр: середина, Гц, и добротность. */
  band?: [number, number];
}

const v = (
  f0: number,
  f1: number,
  at: number,
  len: number,
  wave: OscillatorType,
  gain: number,
  extra: Partial<Pick<Voice, 'vib' | 'band'>> = {},
): Voice => ({ f0, f1, at, len, wave, gain, ...extra });

/** «Бе-е»: пила с дрожанием через фильтр; высота чуть разная у каждого блеяния. */
const bleat = (pitch: number, len: number, gain: number): Voice[] => [
  v(pitch, pitch * 0.82, 0, len, 'sawtooth', gain, { vib: [7, pitch * 0.06], band: [1100, 2.2] }),
  v(pitch * 2, pitch * 1.6, 0, len * 0.8, 'triangle', gain * 0.35, { vib: [7, pitch * 0.1] }),
];

/** Звуки синтезируются на лету: ни одного файла, работает и с диска. */
const CUES: Record<Cue, () => Voice[]> = {
  start: () => [
    v(240, 150, 0, 0.09, 'square', 0.05, { band: [700, 1.5] }),
    v(260, 160, 0.13, 0.1, 'square', 0.05, { band: [700, 1.5] }),
  ],
  whistle: () => [v(1900, 2600, 0, 0.16, 'sine', 0.07), v(2600, 2100, 0.17, 0.22, 'sine', 0.07)],
  bleat: () => bleat(300 + Math.random() * 120, 0.42 + Math.random() * 0.15, 0.09),
  stray: () => bleat(430 + Math.random() * 60, 0.5, 0.1),
  penned: () => [v(880, 880, 0, 0.25, 'sine', 0.06), v(1320, 1320, 0.02, 0.2, 'sine', 0.03)],
  lost: () => bleat(250, 0.9, 0.08),
  flock: () => [
    v(523, 523, 0, 0.12, 'triangle', 0.08),
    v(659, 659, 0.12, 0.12, 'triangle', 0.08),
    v(784, 784, 0.24, 0.12, 'triangle', 0.08),
    v(1047, 1047, 0.36, 0.35, 'triangle', 0.08),
  ],
  // Петух: «ку-ка-ре-ку» — четыре слога, последний длинный.
  dawn: () => [
    v(520, 600, 0, 0.12, 'sawtooth', 0.05, { band: [1400, 3] }),
    v(700, 760, 0.16, 0.12, 'sawtooth', 0.05, { band: [1500, 3] }),
    v(680, 720, 0.32, 0.12, 'sawtooth', 0.05, { band: [1500, 3] }),
    v(820, 640, 0.48, 0.45, 'sawtooth', 0.05, { vib: [9, 25], band: [1600, 3] }),
  ],
};

/** Трель мелкой птицы: два-четыре коротких свиста вниз-вверх. */
const birdSong = (): Voice[] => {
  const base = 2600 + Math.random() * 1400;
  const notes = 2 + Math.floor(Math.random() * 3);
  return Array.from({ length: notes }, (_, i) => {
    const f = base * (1 + (Math.random() - 0.5) * 0.25);
    return v(f, f * (i % 2 ? 1.2 : 0.8), i * 0.13, 0.09, 'sine', 0.012);
  });
};

/** Ворона вдалеке: зимой и осенью вместо песен. */
const crow = (): Voice[] => [
  v(420, 340, 0, 0.18, 'sawtooth', 0.012, { band: [900, 2] }),
  v(400, 320, 0.3, 0.2, 'sawtooth', 0.012, { band: [900, 2] }),
];

/** Сверчок летней ночью: короткие высокие щелчки. */
const cricket = (): Voice[] => [0, 0.05, 0.1].map((at) => v(4300, 4300, at, 0.03, 'sine', 0.006));

/** Как часто и кто поёт: среднее число секунд между голосами. Днём не нужно: рассвет — конец. */
function nextCall(mood: Mood): { after: number; voices: () => Voice[] } | null {
  const { season, dawn } = mood;
  if (season === 'summer' && dawn < 0.55) return { after: 2 + Math.random() * 4, voices: cricket };
  if (dawn < 0.6) return null;
  const k = (dawn - 0.6) / 0.4;
  if (season === 'winter') return { after: 9 + Math.random() * 12, voices: crow };
  if (season === 'autumn') {
    return { after: 6 + Math.random() * 8, voices: Math.random() < 0.5 ? crow : birdSong };
  }
  return { after: (season === 'spring' ? 1.2 : 2) + Math.random() * (6 - 4 * k), voices: birdSong };
}

/** Сила ветра по времени года: зимой метёт, летом почти тихо. */
const WIND: Record<Mood['season'], number> = {
  spring: 0.012,
  summer: 0.007,
  autumn: 0.016,
  winter: 0.024,
};

const NOISE_SECONDS = 3;

export function createWebAudioSound(): Sound {
  let ctx: AudioContext | null = null;
  let enabled = true;
  /** Ветер: зацикленный шум через фильтр. Создаётся один раз, громкость — по настроению. */
  let wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  let windOn = false;
  let gustAt = 0;
  let callAt = 0;

  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
    }
    return ctx;
  };

  const startWind = (ac: AudioContext) => {
    const buffer = ac.createBuffer(1, ac.sampleRate * NOISE_SECONDS, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = ac.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(ac.destination);
    source.start();
    return { gain, filter };
  };

  const silence = () => {
    if (!wind || !ctx || !windOn) return;
    windOn = false;
    wind.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  };

  const voices = (ac: AudioContext, list: Voice[], place?: Place) => {
    const t0 = ac.currentTime;
    const out = ac.createGain();
    out.gain.value = place?.gain ?? 1;
    let tail: AudioNode = out;
    if (place && typeof ac.createStereoPanner === 'function') {
      const pan = ac.createStereoPanner();
      pan.pan.value = place.pan;
      out.connect(pan);
      tail = pan;
    }
    tail.connect(ac.destination);
    let last = 0;
    for (const voice of list) {
      last = Math.max(last, voice.at + voice.len);
      const start = t0 + voice.at;
      const end = start + voice.len;
      const osc = ac.createOscillator();
      const amp = ac.createGain();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(voice.f0, start);
      osc.frequency.exponentialRampToValueAtTime(voice.f1, end);
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(voice.gain, start + Math.min(0.03, voice.len / 3));
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      let node: AudioNode = osc;
      if (voice.band) {
        const filter = ac.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = voice.band[0];
        filter.Q.value = voice.band[1];
        node.connect(filter);
        node = filter;
      }
      node.connect(amp).connect(out);
      if (voice.vib) {
        const lfo = ac.createOscillator();
        const depth = ac.createGain();
        lfo.frequency.value = voice.vib[0];
        depth.gain.value = voice.vib[1];
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(start);
        lfo.stop(end + 0.02);
      }
      osc.start(start);
      osc.stop(end + 0.02);
    }
    // Узлы цепочки снимаем вслед за голосами: фон звучит долго, они не должны копиться.
    setTimeout(() => tail.disconnect(), (last + 0.2) * 1000);
  };

  return {
    setEnabled(on) {
      enabled = on;
      if (!on) silence();
    },
    play(cue, place?: Place) {
      if (!enabled) return;
      const ac = context();
      if (!ac) return;
      if (ac.state === 'suspended') void ac.resume();
      voices(ac, CUES[cue](), place);
    },
    ambience(mood) {
      if (!mood || !enabled) {
        silence();
        return;
      }
      const ac = context();
      if (!ac) return;
      if (ac.state === 'suspended') void ac.resume();
      wind ??= startWind(ac);
      const now = ac.currentTime;
      if (!windOn || now >= gustAt) {
        // Порывы: каждые несколько секунд новая сила и окраска ветра.
        windOn = true;
        gustAt = now + 2 + Math.random() * 4;
        const level = WIND[mood.season] * (0.5 + Math.random());
        wind.gain.gain.setTargetAtTime(level, now, 1.2);
        wind.filter.frequency.setTargetAtTime(260 + Math.random() * 420, now, 1.5);
      }
      if (now >= callAt) {
        const call = nextCall(mood);
        callAt = now + (call ? call.after : 2);
        if (call) {
          const pan = (Math.random() - 0.5) * 1.6;
          voices(ac, call.voices(), { pan, gain: 0.6 + Math.random() * 0.4 });
        }
      }
    },
  };
}
