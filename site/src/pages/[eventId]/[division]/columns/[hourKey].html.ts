import {
  publishableEvents,
  publishableDivisions,
  loadVideos,
  loadSnapshot,
  availableHourKeys,
} from '#lib/data.ts';
import { columnBodyHtml } from '#lib/render-column.ts';

import type { APIRoute, GetStaticPaths } from 'astro';

export const getStaticPaths: GetStaticPaths = () => {
  return publishableEvents().flatMap((event) =>
    publishableDivisions(event.eventId).flatMap((division) =>
      availableHourKeys(event.eventId, division).map((hourKey) => ({
        params: { eventId: event.eventId, division, hourKey },
      }))
    )
  );
};

export const GET: APIRoute = ({ params }) => {
  const { eventId, division, hourKey } = params;
  if (!eventId || !division || !hourKey) throw new Error('時刻列のパラメータが足りません');
  const hourKeys = availableHourKeys(eventId, division);
  const position = hourKeys.indexOf(hourKey);

  const html = columnBodyHtml({
    snapshot: loadSnapshot(eventId, division, hourKey),
    previousSnapshot: position > 0 ? loadSnapshot(eventId, division, hourKeys[position - 1]) : null,
    videos: loadVideos(eventId),
    eventId,
  });

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
