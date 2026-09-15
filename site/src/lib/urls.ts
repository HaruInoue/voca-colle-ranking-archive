/** URLを組み立てる。 */

import type { Division, EventId, HourKey, WatchId } from '@data-model';

const BASE = import.meta.env?.BASE_URL ?? '/';

/** サイト内リンクを返す。 */
export function siteHref(pathname: string): string {
  const trimmedBase = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
  return `${trimmedBase}${pathname}`;
}

export function eventHref(eventId: EventId): string {
  return siteHref(`/${eventId}/`);
}

export function divisionHref(
  eventId: EventId,
  division: Division,
  hourKey?: HourKey | null,
): string {
  const query = hourKey ? `?hour=${encodeURIComponent(hourKey)}` : '';
  return siteHref(`/${eventId}/${division}/${query}`);
}

export function videoHref(eventId: EventId, watchId: WatchId): string {
  return siteHref(`/${eventId}/watch/${watchId}/`);
}

/** 時刻列のHTML断片のURLを返す。 */
export function columnFragmentHref(
  eventId: EventId,
  division: Division,
  hourKey: HourKey,
): string {
  return siteHref(`/${eventId}/${division}/columns/${hourKey}.html`);
}

export function watchUrl(watchId: WatchId): string {
  return `https://www.nicovideo.jp/watch/${watchId}`;
}

/** 埋め込みプレイヤーのスクリプトURLを返す。 */
export function embedScriptUrl(watchId: WatchId): string {
  return `https://embed.nicovideo.jp/watch/${watchId}/script?w=640&h=360`;
}

export function ownerUrl(ownerId: string): string {
  return `https://www.nicovideo.jp/user/${ownerId}`;
}

/** 外部サービスの動画リンクをグループ化して返す。 */
export function externalVideoLinkGroups(
  watchId: WatchId,
): { name: string; links: { label: string; url: string; icon: string }[] }[] {
  return [
    {
      name: 'ニコニコ動画',
      links: [
        { label: '動画ページ', url: watchUrl(watchId), icon: 'nicovideo.ico' },
        {
          label: '公開マイリスト',
          url: `https://www.nicovideo.jp/openlist/${watchId}`,
          icon: 'nicovideo.ico',
        },
        {
          label: 'ニコニ広告',
          url: `https://nicoad.nicovideo.jp/video/publish/${watchId}`,
          icon: 'nicoad.ico',
        },
        {
          label: 'ニコニ・コモンズ',
          url: `https://commons.nicovideo.jp/works/${watchId}`,
          icon: 'commons.ico',
        },
      ],
    },
    {
      name: 'その他のサービス',
      links: [
        { label: 'ニコログ', url: `https://www.nicolog.jp/watch/${watchId}`, icon: 'nicolog.ico' },
        {
          label: 'ニコニコチャート',
          url: `https://www.nicochart.jp/watch/${watchId}`,
          icon: 'nicochart.ico',
        },
        {
          label: 'ニコランWEB',
          url: `https://nicoranweb.com/watch/${watchId}`,
          icon: 'nicoranweb.png',
        },
        { label: 'X で検索', url: `https://x.com/search?q=%23${watchId}`, icon: 'x.ico' },
      ],
    },
  ];
}

/** 保存済みサービスアイコンのパスを返す。 */
export function serviceIconHref(fileName: string): string {
  return siteHref(`/icons/${fileName}`);
}
