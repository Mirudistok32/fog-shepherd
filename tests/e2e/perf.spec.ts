import { expect, test } from '@playwright/test';

import { URL } from './helpers';

// «Туман и стадо из 30+ овец не роняют FPS на телефоне»: двенадцатый уровень (40 овец,
// самый густой туман) при процессоре, замедленном в четыре раза, как у недорогого телефона.
// Меряется чистое время работы кадра — шаги симуляции, туман и отрисовка.
test('40 овец в густом тумане: кадр укладывается в 60 Гц даже на вчетверо медленном процессоре', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const work: number[] = [];
    (window as unknown as { __work: number[] }).__work = work;
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        const a = performance.now();
        cb(t);
        work.push(performance.now() - a);
      });
  });
  await page.goto(`${URL}?autopilot&level=12`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.locator('#btn-start').click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => ((window as unknown as { __work: number[] }).__work.length = 0));
  await page.waitForTimeout(4000);
  const work = await page.evaluate(() => [...(window as unknown as { __work: number[] }).__work]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  work.sort((a, b) => a - b);
  const at = (q: number) =>
    work[Math.min(work.length - 1, Math.floor(q * work.length))] ?? Infinity;
  console.log(
    `кадров: ${work.length}, медиана ${at(0.5).toFixed(2)} мс, 95 % ${at(0.95).toFixed(2)} мс`,
  );
  expect(work.length).toBeGreaterThan(100);
  expect(at(0.5)).toBeLessThan(8);
  expect(at(0.95)).toBeLessThan(16);
});
