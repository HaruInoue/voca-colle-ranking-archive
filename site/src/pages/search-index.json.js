import { buildSearchIndex } from '@/lib/search-index.js';

/** 検索索引。 */
export function GET() {
  return new Response(JSON.stringify(buildSearchIndex()), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
