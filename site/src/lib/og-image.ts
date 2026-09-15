import fs from 'node:fs';
import path from 'node:path';
import { siteHref } from '#lib/urls.ts';

import type { Division, EventId } from '@data-model';

/** OGP のカード画像 */

const OG_DIR = ['public/og', 'site/public/og']
  .map((relPath) => path.join(process.cwd(), relPath))
  .find((candidate) => fs.existsSync(candidate));

const generated = new Set(OG_DIR ? fs.readdirSync(OG_DIR) : []);

export function ogImageHref(
  eventId?: EventId | null,
  division?: Division | null,
): string | null {
  const candidates = [
    eventId && division && `${eventId}-${division}.png`,
    eventId && `${eventId}.png`,
    'site.png',
  ].filter((candidate): candidate is string => Boolean(candidate));
  const name = candidates.find((candidate) => generated.has(candidate));
  return name ? siteHref(`/og/${name}`) : null;
}
