import {
  publishableEvents,
  publishableDivisions,
  loadVideos,
  loadSnapshot,
  availableHourKeys,
} from '@/lib/data.js';
import { columnBodyHtml } from '@/lib/render-column.js';

export function getStaticPaths() {
  return publishableEvents().flatMap((event) =>
    publishableDivisions(event.eventId).flatMap((division) =>
      availableHourKeys(event.eventId, division).map((hourKey) => ({
        params: { eventId: event.eventId, division, hourKey },
      }))
    )
  );
}

export function GET({ params }) {
  const { eventId, division, hourKey } = params;
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
}
