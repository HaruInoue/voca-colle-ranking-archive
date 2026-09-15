import { buildSearchIndex } from '#lib/search-index.ts';

import type { APIRoute } from 'astro';

/** 検索索引。 */
export const GET: APIRoute = () => {
  return new Response(JSON.stringify(buildSearchIndex()), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
