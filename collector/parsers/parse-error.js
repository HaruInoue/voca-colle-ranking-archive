/**
 * 想定の構造で読めなかったことを表す。
 *
 * これが投げられた場合、生データを退避してジョブを失敗させる
 * （取得元の構造が変わった可能性があり、静かに欠測させてはいけない）。
 */
export class ParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParseError';
  }
}
