/**
 * Адрес сайта для canonical и превью ссылки (они должны быть абсолютными): SITE_URL задаёт
 * сборка на GitHub Pages, на Vercel — его рабочий домен, иначе — homepage из package.json.
 */
export function siteUrl(env: Record<string, string | undefined>, homepage: string): string {
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = env.SITE_URL || (vercel ? `https://${vercel}` : homepage);
  if (!/^https?:\/\/[^/\s]+/.test(url)) throw new Error(`Адрес сайта не похож на адрес: ${url}`);
  return url.endsWith('/') ? url : `${url}/`;
}
