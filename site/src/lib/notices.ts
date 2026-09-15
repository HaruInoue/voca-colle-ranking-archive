/** 開催回ごとの注記を振り分ける。 */

import type { Division, EventFile, Notice } from '@data-model';

export function noticesForEventPage(event: EventFile | null | undefined): Notice[] {
  return event?.website?.notices ?? [];
}

/** 部門を指定していない注記は開催回全体の話なので、どの部門のページにも出す。 */
export function noticesForDivisionPage(
  event: EventFile | null | undefined,
  division: Division,
): Notice[] {
  return (event?.website?.notices ?? []).filter(
    (notice) => !notice.division || notice.division === division
  );
}
