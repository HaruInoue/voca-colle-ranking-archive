/** 開催回ごとの注記を振り分ける。 */

export function noticesForEventPage(event) {
  return event?.website?.notices ?? [];
}

/** 部門を指定していない注記は開催回全体の話なので、どの部門のページにも出す。 */
export function noticesForDivisionPage(event, division) {
  return (event?.website?.notices ?? []).filter(
    (notice) => !notice.division || notice.division === division
  );
}
