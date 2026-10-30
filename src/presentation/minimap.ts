/**
 * Мини-карта для узкого экрана: весь луг, рамка видимой части, собака, загон и те овцы, что
 * видны и на большом экране. Сквозь туман она не показывает ничего лишнего: овцы вдали выдают
 * себя только кругами блеяния. Касание карты посылает туда собаку.
 */

import type { Frame } from '@/application/game';
import { clearRadius, fogDensity, lanternLight, sheepVisible } from '@/domain/fog';
import { CELL, cellAt } from '@/domain/grid';
import type { HerdEvent } from '@/domain/herd';
import type { Level, Point } from '@/domain/level';
import { COLS, FOREST, HORIZON, ROWS, TILE, WORLD_H, WORLD_W } from '@/domain/world';

import { fogColor, PALETTES } from './palette';

/** Точек карты на клетку сетки. */
const S = 2;
const MAP_W = COLS * S;
const MAP_H = ROWS * S;
/** Единиц луга на точку карты. */
const K = TILE / S;

const BLEAT_LIFE = 1.1;

interface Ping {
  x: number;
  y: number;
  at: number;
  warm: boolean;
}

function terrain(level: Level): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = MAP_W;
  out.height = MAP_H;
  const c = out.getContext('2d') as CanvasRenderingContext2D;
  const pal = PALETTES[level.spec.season];
  const fence = pal.snow ? '#6A5034' : '#4A3020';
  const p = level.pen.inner;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * TILE;
      const y = row * TILE;
      const cell = cellAt(level.grid, col, row);
      let color = pal.grass;
      if (y < HORIZON) color = '#242C40';
      else if (cell === CELL.water) color = pal.water;
      else if (cell === CELL.bridge) color = '#9C7148';
      else if (cell === CELL.fence) color = fence;
      else if (cell === CELL.bush) color = pal.bushDark;
      else if (x < FOREST || x >= WORLD_W - FOREST || y >= WORLD_H - FOREST)
        color = pal.forestFloor;
      else if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) color = pal.penFloor;
      c.fillStyle = color;
      c.fillRect(col * S, row * S, S, S);
    }
  }
  return out;
}

export function createMinimap(canvas: HTMLCanvasElement) {
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  let base: { key: string; canvas: HTMLCanvasElement } | null = null;
  let pings: Ping[] = [];
  let now = 0;

  const dot = (x: number, y: number, size: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x / K - size / 2), Math.round(y / K - size / 2), size, size);
  };

  return {
    events(events: readonly HerdEvent[]) {
      for (const e of events) {
        if (e.type === 'bleat') pings.push({ x: e.x, y: e.y, at: now, warm: e.lonely });
      }
      if (pings.length > 30) pings = pings.slice(-30);
    },
    /** Точка карты (clientX, clientY) → точка луга. */
    toWorld(clientX: number, clientY: number, box: DOMRect): Point {
      return {
        x: ((clientX - box.left) / Math.max(1, box.width)) * WORLD_W,
        y: ((clientY - box.top) / Math.max(1, box.height)) * WORLD_H,
      };
    },
    draw({ level, run, time }: Frame, camera: number, viewW: number, reduced: boolean) {
      now = time;
      const key = `${level.seed}:${level.spec.number}`;
      if (!base || base.key !== key) {
        base = { key, canvas: terrain(level) };
        pings = [];
      }
      const land = base.canvas;
      ctx.globalAlpha = 1;
      ctx.drawImage(land, 0, 0);
      // Туман: всё затянуто, кроме круга вокруг собаки и света фонаря.
      const density = fogDensity(level, run.t);
      const [r, g, b] = fogColor(0.2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${density * 0.7})`;
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      const light = lanternLight(level);
      if (density > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(run.dog.x / K, run.dog.y / K, clearRadius(level, run.t) / K, 0, Math.PI * 2);
        ctx.moveTo((light.x + light.r0) / K, light.y / K);
        ctx.arc(light.x / K, light.y / K, light.r0 / K, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(land, 0, 0);
        ctx.restore();
      }
      // Круги блеяния: как и на большом экране, это единственная весть из тумана.
      pings = pings.filter((p) => now - p.at < BLEAT_LIFE);
      for (const p of pings) {
        const k = (now - p.at) / BLEAT_LIFE;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.warm ? '#F2D16B' : '#F4F0E6';
        ctx.beginPath();
        ctx.arc(p.x / K, p.y / K, reduced ? 3 : 2 + k * 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const s of run.sheep) {
        if (s.status === 'lost') continue;
        if (s.status === 'free' && !sheepVisible(level, run.dog, run.t, s.x, s.y)) continue;
        dot(s.x, s.y, 4, '#2A2422');
        dot(s.x, s.y, 2, s.stray > 0 ? '#E8604A' : '#F4F0E6');
      }
      const lit = reduced || Math.floor(time * 2) % 2 === 0;
      dot(level.pen.lantern.x, level.pen.lantern.y, 3, lit ? '#FFF2B3' : '#F2C14E');
      // Собака — золотая: на карте её нельзя спутать с овцой.
      dot(run.dog.x, run.dog.y, 6, '#1E1D24');
      dot(run.dog.x, run.dog.y, 4, '#F2C14E');
      // Рамка: что сейчас на большом экране.
      ctx.strokeStyle = '#F0B45A';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(camera / K) + 0.5, 0.5, Math.round(viewW / K) - 1, MAP_H - 1);
    },
  };
}

export type Minimap = ReturnType<typeof createMinimap>;
