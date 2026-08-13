# catalog — UI カタログ(全画面のスクリーンショット + 画面一覧)

「今どんな画面が存在するのか」を、スクリーンショットと「画面名 / URL / 説明 / 遷移関係」の一覧として
書き出す仕組み。Claude Design などへ渡して UI カタログ・画面遷移図を作る用途を想定している。

**これはテストではない。** アプリの正しさは既存の E2E(`e2e-web` / `e2e-mobile`)が検証する。
ここは収集が目的なので、実データ次第で到達できない画面があってもジョブは赤くせず、
「未取得」として一覧に残す。

## 構成

| ファイル                       | 役割                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `screens.json`                 | **画面定義の唯一の情報源**。Web(Playwright)とモバイル(Detox)が共通で読む      |
| `generate-catalog.mjs`         | 定義 × 撮影結果 → Markdown の一覧・画面遷移図・機械可読 JSON を生成(依存ゼロ) |
| `../e2e-web/tests/catalog/`    | Web の巡回・撮影(`@catalog`)                                                  |
| `../e2e-mobile/tests/catalog/` | ネイティブの巡回・撮影(`@catalog`。Android / iOS)                             |
| `../docs/ui-catalog.md`        | 生成物(Web)。リポジトリにコミットする                                         |
| `../docs/ui-catalog-mobile.md` | 生成物(モバイル)。リポジトリにコミットする                                    |

スクリーンショット本体はコミットしない(CI の Artifact と GCS 公開で配布する)。

## screens.json の書き方

```jsonc
{
	"id": "profile-settings", // ← そのままファイル名になる。ASCII 英小文字・数字・ハイフン
	"name": "設定", // 画面名(日本語)
	"route": "/[locale]/profile/settings", // expo-router のルート定義
	"url": "/ja-JP/profile/settings", // 代表的な URL。モバイルはここからディープリンクを組み立てる
	"platforms": {
		"web": { "capture": "auto", "session": "anon" },
		"mobile": { "capture": "auto", "session": "anon" },
	},
	"state": "…", // 同一 URL 内の UI 状態(モーダル・タブ等)。単独画面なら null
	"description": "…", // 画面の簡単な説明
	"from": ["…"], // どの画面から遷移してくるか
	"to": ["…"], // 主な遷移先
	"note": "…", // 補足(自動取得しない理由など)
}
```

`capture` の意味:

| 値         | 意味                                                               |
| ---------- | ------------------------------------------------------------------ |
| `auto`     | 必ず撮る                                                           |
| `optional` | 実データ次第で撮れないことがある(撮れなくてもジョブは失敗させない) |
| `mutation` | dev DB へ書き込むフローのため `RUN_MUTATION=1` のときだけ撮る      |
| `manual`   | 自動取得の対象外(理由は `note` に書く)                             |

画面遷移図は末尾の `flow`(`from` / `to` は画面 ID か `pseudoNodes` の仮想ノード)から生成する。

## ファイル名の規約

- Web: `<画面 ID>.png`
- モバイル: `<画面 ID>-<android|ios>.png`

**公開 URL だけを見てどの画面か分かること**を最優先にしている。
`evidence-collect.yml` は `[A-Za-z0-9._-]` 以外を `_` に潰すため、日本語名は公開 URL では読めなくなる。

## 使い方

```bash
# Web(要 dist ビルド + api-development への到達)
pnpm --filter app-expo build:web
pnpm --filter e2e-web test:catalog        # レビュー投稿フローも撮るなら test:catalog:all
pnpm catalog:doc

# モバイル(要 Detox ビルド + エミュレータ / シミュレータ)
pnpm --filter e2e-mobile test:catalog:android
pnpm catalog:doc:mobile
```

CI では次の 2 段で公開する。

1. `E2E Web Test`(`capture_ui_catalog = true`)/ `E2E Mobile Test`(`scope = catalog`)で収集し、
   Artifact `ui-catalog-screenshots` / `ui-catalog-screenshots-android` / `-ios` に保存する
2. その run を `Evidence Collect` に渡すと `nanitabeyo-public` へ公開され、
   **写真付きの一覧ページ(`index.html`)と画面名入りの公開 URL** が手に入る

公開 URL 付きの一覧を作り直す場合は manifest を渡す(複数指定可):

```bash
node ./catalog/generate-catalog.mjs --platform mobile --screenshots e2e-mobile/screenshots \
  --manifest manifest-android.json --manifest manifest-ios.json --out docs/ui-catalog-mobile.md
```
