import { describe, expect, it } from 'vitest';

import { siteUrl } from '../../scripts/siteUrl';

const HOME = 'https://user.github.io/game/';

describe('адрес сайта для метатегов', () => {
  it('без настроек — homepage из package.json', () => {
    expect(siteUrl({}, HOME)).toBe(HOME);
    expect(siteUrl({}, 'https://user.github.io/game')).toBe(HOME);
  });

  it('GitHub Pages: адрес из сборки, косая черта на конце появляется сама', () => {
    expect(siteUrl({ SITE_URL: 'https://user.github.io/other-repo' }, HOME)).toBe(
      'https://user.github.io/other-repo/',
    );
  });

  it('Vercel: рабочий домен без протокола', () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'game.vercel.app' }, HOME)).toBe(
      'https://game.vercel.app/',
    );
  });

  it('SITE_URL важнее домена Vercel: так один адрес задаётся для обоих хостингов', () => {
    expect(
      siteUrl({ SITE_URL: HOME, VERCEL_PROJECT_PRODUCTION_URL: 'game.vercel.app' }, HOME),
    ).toBe(HOME);
  });

  it('пустая переменная — как её отсутствие; мусор роняет сборку, а не сайт', () => {
    expect(siteUrl({ SITE_URL: '' }, HOME)).toBe(HOME);
    expect(() => siteUrl({ SITE_URL: 'fog-shepherd' }, HOME)).toThrow();
  });
});
