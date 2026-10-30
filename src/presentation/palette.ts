/** Цвета луга по временам года, небо и туман от ночи к рассвету. */

import type { Season } from '@/domain/season';

export interface ScenePalette {
  grass: string;
  grassDark: string;
  grassLight: string;
  tuft: string;
  /** Земля под лесом и вытоптанный пол загона. */
  forestFloor: string;
  penFloor: string;
  flowers: readonly string[];
  fir: string;
  firDark: string;
  crown: string;
  crownDark: string;
  bush: string;
  bushDark: string;
  bushLight: string;
  berry: string;
  water: string;
  waterDark: string;
  waterLight: string;
  roof: string;
  /** Пыль из-под лап (зимой — снежная) и следы. */
  dust: string;
  print: string;
  /** Что летит в воздухе: лепестки, пыльца, листья, снег. */
  air: readonly string[];
  snow: boolean;
}

export const PALETTES: Readonly<Record<Season, ScenePalette>> = {
  spring: {
    grass: '#6FA34A',
    grassDark: '#5C8C3C',
    grassLight: '#86B957',
    tuft: '#4E8034',
    forestFloor: '#466B38',
    penFloor: '#9C8A5A',
    flowers: ['#F6E9F0', '#F6C9D6', '#F2D16B', '#FFFFFF'],
    fir: '#2F5D46',
    firDark: '#234536',
    crown: '#7DB05A',
    crownDark: '#5E9145',
    bush: '#4F8A3C',
    bushDark: '#3A6B2D',
    bushLight: '#6CA650',
    berry: '#F6D2DE',
    water: '#3E77A8',
    waterDark: '#2E5D88',
    waterLight: '#8FB8DC',
    roof: '#5B4636',
    dust: '#C8B78A',
    print: '#5C8C3C',
    air: ['#F6C9D6', '#F6E9F0', '#FFFFFF'],
    snow: false,
  },
  summer: {
    grass: '#5E9440',
    grassDark: '#4D7C34',
    grassLight: '#77AC4F',
    tuft: '#3F6D2B',
    forestFloor: '#3E6131',
    penFloor: '#A08A55',
    flowers: ['#F2D16B', '#8FB8E8', '#FFFFFF', '#E86A5A'],
    fir: '#2A5A40',
    firDark: '#1E4430',
    crown: '#4F8A3A',
    crownDark: '#3B6E2C',
    bush: '#467F35',
    bushDark: '#335F27',
    bushLight: '#5E9A47',
    berry: '#C8443A',
    water: '#3A6F9E',
    waterDark: '#2B5680',
    waterLight: '#86B2D8',
    roof: '#5B4636',
    dust: '#CDB98A',
    print: '#4D7C34',
    air: ['#F2E8A0', '#E9F0B0'],
    snow: false,
  },
  autumn: {
    grass: '#94904A',
    grassDark: '#7E7A3C',
    grassLight: '#AAA458',
    tuft: '#6E6A30',
    forestFloor: '#6B5A32',
    penFloor: '#8E7A4E',
    flowers: ['#D9962B', '#C8643A', '#E8B04B', '#B8642F'],
    fir: '#2F5446',
    firDark: '#223F34',
    crown: '#D9962B',
    crownDark: '#B8642F',
    bush: '#8A7A34',
    bushDark: '#6E5E28',
    bushLight: '#A89448',
    berry: '#C8443A',
    water: '#3F6E8E',
    waterDark: '#2F5670',
    waterLight: '#8DB0C8',
    roof: '#5B4636',
    dust: '#B09A66',
    print: '#7E7A3C',
    air: ['#D9962B', '#C8643A', '#E8B04B', '#B8642F'],
    snow: false,
  },
  winter: {
    grass: '#E2E9F0',
    grassDark: '#C9D4DF',
    grassLight: '#F5F8FB',
    tuft: '#8E8676',
    forestFloor: '#C2CDD9',
    penFloor: '#B8AE9A',
    flowers: ['#B9C6D3', '#9FB0C2'],
    fir: '#2E5446',
    firDark: '#1F3D33',
    crown: '#DCE6EE',
    crownDark: '#A9B8C8',
    bush: '#6F8A72',
    bushDark: '#55705A',
    bushLight: '#EEF3F8',
    berry: '#C8443A',
    water: '#7FA6C6',
    waterDark: '#5E86A8',
    waterLight: '#E3EEF6',
    roof: '#EEF3F8',
    dust: '#FFFFFF',
    print: '#AEBBC9',
    air: ['#FFFFFF', '#E8F0F8'],
    snow: true,
  },
};

const hex = (c: string): [number, number, number] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

export function mix(a: string, b: string, k: number): string {
  const [r0, g0, b0] = hex(a);
  const [r1, g1, b1] = hex(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r0, r1)}${ch(g0, g1)}${ch(b0, b1)}`;
}

/** Цвет из тройки «ночь — перед рассветом — рассвет» по доле ночи 0–1. */
export function byDawn(stops: readonly [string, string, string], p: number): string {
  return p < 0.6 ? mix(stops[0], stops[1], p / 0.6) : mix(stops[1], stops[2], (p - 0.6) / 0.4);
}

export const SKY_TOP = ['#141B33', '#2B3A63', '#6E8FC0'] as const;
export const SKY_LOW = ['#2C3A5E', '#B5778A', '#F4C287'] as const;

/** Цвет тумана: голубоватый ночью, тёплый на рассвете. */
export function fogColor(p: number): [number, number, number] {
  return hex(byDawn(['#A9B6CA', '#C4C2CE', '#ECE1D4'], p));
}
