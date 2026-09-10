# voca-colle-ranking-archive

ニコニコ動画の投稿イベント「ボカコレ（The VOCALOID Collection）」の毎時ランキングの非公式アーカイブ。

公式サイトでは見られなくなった過去の毎時ランキングを記録して順位の推移を後から見返せるようにする。

公開ページ：https://vocacolle.haruinoue.net/

## 構成

| ディレクトリ         | 内容                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `collector/`         | 公式サイトからランキングを取得してJSONとして保存するスクリプト |
| `data/`              | 収集したランキングデータ（開催回ごと）                           |
| `site/`              | 収集したデータを閲覧する静的サイト（Astro）                      |
| `.github/workflows/` | GitHub Actionsで収集とデプロイの自動化                                           |

1. **収集**: GitHub Actionsが開催期間中のみ30分間隔で起動し、その時刻の未取得の部門だけ公式サイトから取得する。
2. **保存**: 集計時刻ごとのスナップショットJSONをこのリポジトリに蓄積する。
3. **閲覧**: Astroで静的サイトをビルドし、GitHub Pagesに公開する。

## 開発

Node.js は `.nvmrc` の版（現在 24.19.0）。`collector/` と `site/` はそれぞれ独立した
npm パッケージで、リポジトリ直下にパッケージは無い。

### collector（依存0）

```
node collector/collect.js                                     # 開催中の収集（Actions と同じ挙動）
node collector/collect.js --event <eventId> --dry-run         # 候補時刻を確認するだけ（取得しない）
node collector/collect.js --event <eventId> --assume-expired  # 過去回の一括取り込み
node collector/finalize.js --event <eventId>                  # 最終ランキングの取得（手動）
node collector/reparse.js --dry-run                           # raw/ からの再解析（パーサの回帰確認）
node collector/refresh-thumbnails.js --dry-run                # 404 になったサムネイルURLの確認
```

各コマンドは `--help` で使い方を表示する。新しい開催回を追加するには`data/events/<eventId>/event.json` を作成する。

### site（Astro）

```
npm ci          # 初回のみ
npm run dev     # 開発サーバ
npm run build   # dist/ へ静的ビルド
npm run preview # ビルド結果の確認
npm test        # test/ のテスト
```

`data/` を直接読んでビルドするため、収集済みのデータがそのまま表示される。

## 出典と位置づけ

**本リポジトリは非公式のアーカイブであり、ボカコレ運営、株式会社ドワンゴ、その他の関係団体とは一切関係がありません。**

- ランキング情報の出典は[ボカコレ公式サイト](https://vocaloid-collection.jp/)。
- サムネイル画像は再配布せず公式CDNのURLを参照するのみ）。

### 配慮していること

公式サイトから直接データを取得しているため、相手に負担をかけないよう次のようにしている。

- **1つの時刻・部門につき生涯1リクエスト。** 一度取得したら二度と取りに行かない。
  1開催回あたりの総リクエスト数は約210回で、実行頻度を上げても増えない。
- 取得は直列。1リクエストごとに1秒あける。
- `User-Agent` にこのリポジトリのURLを入れ、何者からのアクセスかを明示する。

### 削除・修正の依頼

公式・権利者の方からのご要望があれば速やかに対応します。
リポジトリ所有者までご連絡ください。

## ライセンス

コードと収集データで扱いが異なります。

- `collector/` `site/` `.github/` などのコード: [MIT License](LICENSE)
- `data/` の収集データ: ライセンスを設定していません。
  順位・再生数などの数値は事実ですが、動画のタイトル・投稿者名などの権利は各権利者に帰属し、当方がライセンスを設定することはできません。
