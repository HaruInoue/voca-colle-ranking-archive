import fs from 'node:fs';
import path from 'node:path';
import { siteHref } from './urls.js';

/** OGP のカード画像 */

const OG_DIR = ['public/og', 'site/public/og']
  .map((relPath) => path.join(process.cwd(), relPath))
  .find((candidate) => fs.existsSync(candidate));

const generated = new Set(OG_DIR ? fs.readdirSync(OG_DIR) : []);

export function ogImageHref(eventId, division) {
  const candidates = [
    eventId && division && `${eventId}-${division}.png`,
    eventId && `${eventId}.png`,
    'site.png',
  ].filter(Boolean);
  const name = candidates.find((candidate) => generated.has(candidate));
  return name ? siteHref(`/og/${name}`) : null;
}
