/**
 * Спрайты — строки пикселей: символ → цвет палитры, «.» — прозрачно. При первом
 * использовании спрайт запекается в маленький холст (с контуром, если нужен), дальше
 * рисуется одним drawImage. Все смотрят вправо; влево — зеркальная копия.
 */

export type Rows = readonly string[];
export type Pal = Readonly<Record<string, string>>;

export interface Baked {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const cache = new Map<string, Baked>();

export const mirror = (rows: Rows): Rows => rows.map((r) => [...r].reverse().join(''));

export function bake(rows: Rows, pal: Pal, outline: string | null = null): Baked {
  const key = `${rows.join('/')}|${JSON.stringify(pal)}|${outline}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = outline ? 1 : 0;
  const w = Math.max(...rows.map((r) => r.length)) + pad * 2;
  const h = rows.length + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d недоступен');
  const solid = (x: number, y: number) => {
    const ch = rows[y - pad]?.[x - pad];
    return ch !== undefined && ch !== '.' && pal[ch] !== undefined;
  };
  if (outline) {
    ctx.fillStyle = outline;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (solid(x, y)) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = pal[row[x] ?? '.'];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + pad, y + pad, 1, 1);
    }
  });
  const baked = { canvas, w, h };
  cache.set(key, baked);
  return baked;
}

/** Та же форма одним цветом — силуэт в тумане. */
export function silhouette(rows: Rows, color: string): Baked {
  const pal: Record<string, string> = {};
  for (const r of rows) for (const ch of r) if (ch !== '.') pal[ch] = color;
  return bake(rows, pal);
}

/* ---------- овца ---------- */

export const SHEEP_PAL: Pal = {
  w: '#F4F0E6',
  v: '#D6CDBD',
  h: '#3B3433',
  e: '#5C504B',
  i: '#E9E2D4',
  l: '#2E2725',
};
export const SHEEP_OUTLINE = '#2A2422';

const SHEEP_BODY = ['..vwwwv...', '.vwwwwwwe.', 'vwwwwwwwhh', 'vwwwwwwwhi', '.vwwwwwvhh'];

export const SHEEP_STAND: Rows = [...SHEEP_BODY, '..l.l.l.l.'];
export const SHEEP_WALK: readonly Rows[] = [
  [...SHEEP_BODY, '.l..l..l.l'],
  [...SHEEP_BODY, '..l..l.l..'],
];
/** Галоп: ноги то врозь, то вместе; вместе с рисунком овца подпрыгивает (RUN_BOB). */
export const SHEEP_RUN: readonly Rows[] = [
  [...SHEEP_BODY, 'l.......l.'],
  [...SHEEP_BODY, '.l.....l.l'],
  [...SHEEP_BODY, '...l.l.l..'],
  [...SHEEP_BODY, '..l.l...l.'],
];
export const RUN_BOB: readonly number[] = [1, 1, 0, 0];
/** Щиплет траву: голова опущена. */
export const SHEEP_GRAZE: Rows = [
  '..vwwwv...',
  '.vwwwwwww.',
  'vwwwwwwwwe',
  'vwwwwwwwwh',
  '.vwwwwwvhh',
  '..l.l.l.hi',
];
/** Подняла голову: заблеяла или настороже. */
export const SHEEP_ALERT: Rows = [
  '........he',
  '..vwwwv.hh',
  '.vwwwwwwhi',
  'vwwwwwwwhh',
  'vwwwwwww..',
  '.vwwwwwv..',
  '..l.l.l.l.',
];
/** Идёт от нас: сзади видны ушки и хвостик. */
export const SHEEP_UP: readonly Rows[] = [
  ['.e....e.', '..vwwv..', '.vwwwwv.', 'vwwwwwwv', 'vwwiiwwv', '.vwwwwv.', '.l....l.'],
  ['.e....e.', '..vwwv..', '.vwwwwv.', 'vwwwwwwv', 'vwwiiwwv', '.vwwwwv.', '...ll...'],
];
/** Идёт на нас; первый кадр заодно и поворот: овца на миг смотрит прямо. */
export const SHEEP_DOWN: readonly Rows[] = [
  ['..vwwv..', '.vwwwwv.', 'vwhhhhwv', 'ewhihiwe', 'vwhhhhwv', '.vwhhwv.', '.l....l.'],
  ['..vwwv..', '.vwwwwv.', 'vwhhhhwv', 'ewhihiwe', 'vwhhhhwv', '.vwhhwv.', '...ll...'],
];

/* ---------- собака: бордер-колли ---------- */

export const DOG_PAL: Pal = {
  k: '#1E1D24',
  g: '#4A4752',
  w: '#F4F1EA',
  n: '#0B0A0E',
  e: '#F2C14E',
  p: '#E8788A',
};
export const DOG_OUTLINE = '#141318';

const DOG_TOP = [
  '.........k.k.',
  'k........kkkk',
  'gk.......kekn',
  '.kkkkkkkkkww.',
  '..kkkkkkkww..',
];
/** Хвост внизу: второй кадр виляния. */
const DOG_TOP_LOW = [
  '.........k.k.',
  '.........kkkk',
  '.........kekn',
  'kkkkkkkkkkww.',
  'g.kkkkkkkww..',
];
/** На бегу уши прижаты, хвост вытянут. */
const DOG_TOP_RUN = [
  '........kk...',
  '.........kkkk',
  'kk.......kekn',
  '.gkkkkkkkkww.',
  '..kkkkkkkww..',
];

export const DOG_STAND: readonly Rows[] = [
  [...DOG_TOP, '..wk....kw...', '..w.w...w.w..'],
  [...DOG_TOP_LOW, '..wk....kw...', '..w.w...w.w..'],
];
/** Галоп в четыре кадра: вытянулась, поджалась, снова вытянулась, приземлилась. */
export const DOG_RUN: readonly Rows[] = [
  [...DOG_TOP_RUN, '.wk......kw..', 'w..........w.'],
  [...DOG_TOP_RUN, '..wk....kw...', '.w........w..'],
  [...DOG_TOP_RUN, '...kw..wk....', '....w..w.....'],
  [...DOG_TOP_RUN, '...wk.kw.....', '...w...w.....'],
];
/** Сидит и дышит: стоит дольше секунды. */
export const DOG_SIT: readonly Rows[] = [
  [
    '......k.k..',
    '......kkkk.',
    '......kekn.',
    '.....kkwwp.',
    'k...kkkww..',
    'gkkkkkkw...',
    '.kkkwwkw...',
  ],
  [
    '......k.k..',
    '......kkkk.',
    '......kekn.',
    '.....kkww..',
    '....kkkww..',
    'kkkkkkkw...',
    'g.kkwwkw...',
  ],
];
/** Прыгает через забор или куст: лапы вперёд и назад. */
export const DOG_JUMP: Rows = [...DOG_TOP_RUN, 'wk.......kw..'];
/** Бежит от нас: спина и хвост. */
export const DOG_UP: readonly Rows[] = [
  ['..k.k..', '..kkk..', '.kwwwk.', '.kkkkk.', '.kkkkk.', '.kkgkk.', '.w.g.w.', '.w...w.'],
  ['..k.k..', '..kkk..', '.kwwwk.', '.kkkkk.', '.kkkkk.', '.kkgkk.', '...g.w.', '.w.....'],
];
/** Бежит на нас; первый кадр заодно и поворот: собака на миг смотрит прямо. */
export const DOG_DOWN: readonly Rows[] = [
  ['.k...k.', '.kkkkk.', '.kekek.', '.kwnwk.', '..www..', '.kwwwk.', '.kk.kk.', '.w...w.'],
  ['.k...k.', '.kkkkk.', '.kekek.', '.kwnwk.', '..www..', '.kwwwk.', '.kk.kk.', '.....w.'],
];
/** Плывёт: видны голова и спина. */
export const DOG_SWIM: Rows = DOG_TOP.slice(0, 4);

/* ---------- фонарь на столбе у ворот ---------- */

export const LANTERN: readonly Rows[] = [
  ['.c.', 'yYy', 'yYy', '.c.', '.b.', '.b.', '.b.', '.b.'],
  ['.c.', 'yyy', 'yYy', '.c.', '.b.', '.b.', '.b.', '.b.'],
];
export const LANTERN_PAL: Pal = { c: '#3A2A20', y: '#F2C14E', Y: '#FFF2B3', b: '#5A3E2A' };
