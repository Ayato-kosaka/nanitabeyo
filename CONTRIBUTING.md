# コントリビューションガイド

人間・AI エージェントを問わず、このリポジトリへ変更を入れるときの共通ルール。
エージェント別の入口は [CLAUDE.md](CLAUDE.md)（Claude Code）、[.codex/](.codex/)（Codex）、
[.github/copilot-instructions.md](.github/copilot-instructions.md)（Copilot）にあるが、**ここが共通の正**。

## セットアップと基本コマンド

セットアップ手順・技術スタック・ディレクトリ構成は [README.md](README.md) が正。

| したいこと                | コマンド                                                                      |
| ------------------------- | ----------------------------------------------------------------------------- |
| 依存インストール          | `pnpm install --frozen-lockfile`                                              |
| 整形                      | `pnpm format`                                                                 |
| lint                      | `pnpm --filter app-expo lint` / `pnpm --filter api lint`                      |
| 型検査                    | `pnpm typecheck`（turbo で全パッケージ）                                      |
| ビルド                    | `pnpm build`                                                                  |
| app-expo のユニットテスト | `pnpm --filter app-expo test`                                                 |
| Expo 開発サーバ           | `pnpm --filter app-expo start`（`dev` は `--tunnel` 付きで ngrok を要求する） |
| API 開発サーバ            | `pnpm --filter api dev`（`api/.env` が必要）                                  |

**ルートに `test` スクリプトは無い。** E2E は `pnpm test:e2e`（Web / Playwright）と
`pnpm test:e2e:mobile`（Detox）で、いずれも実行環境の準備が要る。

`pnpm --filter api test` は `api/.env`（secrets）を要求し、現状 red のため CI に入れていない。
ローカルで API を触るときだけ動かすこと。

## push 前に通しておくもの

CI（[`.github/workflows/pr-check.yml`](.github/workflows/pr-check.yml)）が全 PR で回すのは次の 8 つ。
**この一覧の正は workflow 側**なので、食い違ったら workflow を見ること。

1. `pnpm assert:doc-hygiene`
1. `pnpm --filter app-expo assert:remote-config-defaults`
1. `pnpm --filter app-expo assert:legacy-blur-modal-boundary`
1. `pnpm --filter error-triage test`
1. `pnpm --filter app-expo lint`
1. `pnpm --filter shared build`
1. `pnpm --filter app-expo typecheck`
1. `pnpm --filter app-expo test`

`pr-check.yml` は **required check ではない**（赤でもマージできる）。
理由は [docs/decisions/20260813-ci-gate-and-worker-permissions.md](docs/decisions/20260813-ci-gate-and-worker-permissions.md)。
ブロックされないからこそ、**push 前に手元で上記を通してから出すこと。**

E2E（`e2e-web-test.yml` / `e2e-mobile-test.yml`）は日次で動いている。

## コードコメント

**設計で決まったことはドキュメントではなくコードコメントに書く。**
書式・種別・粒度の正は [.codex/commentary-policy.md](.codex/commentary-policy.md)。

```
// #<Issue番号> 【<種別>】<要点>（理由・根拠）
```

種別は `設計` / `バグ` / `性能` / `互換性` / `運用` の 5 つ。迷ったら `設計`。

- **禁止**: 意図が説明できない TODO、Issue 番号なしの仕様変更コメント、英語と日本語の混在
- 複雑な型・関数には JSDoc（日本語）で「入出力」「副作用」「失敗時挙動」を書く
- スタイルは既存ファイルへ厳密に追従する。逸脱するなら「なぜ今だけ違うか」をコメントに残す

## ドキュメント

md を作る・直すときの規約は [docs/README.md](docs/README.md)。
**設計解説・実装サマリーの md は作らない**（PR 本文か Issue、あるいはコードコメントへ書く）。

## i18n

- 対象言語は `app-expo/locales/` の 8 つ:
  `ar-SA` / `en-US` / `es-ES` / `fr-FR` / `hi-IN` / `ja-JP` / `ko-KR` / `zh-CN`
- **UI 文字列の直書きは禁止**（テストを含む）。必ずキー参照にする
- **動的なキー生成も禁止。** 静的キーだけを使う（未翻訳の検出ができなくなるため）
- 文言を足したら 8 言語すべてに入れる

## PR のルール

### フロントエンド変更にはスクリーンショットを付ける

対象は `app-expo/` 配下の変更、および画面表示に影響しうる変更（状態管理・表示条件・API レスポンスの表示など）。

- PR 本文に**変更前 / 変更後**のスクリーンショットを添付する。影響画面が複数あれば主要な画面すべて
- ダークモードや多言語で影響が大きいときは代表例も添付する
- 端末・OS（例: iPhone 15 / iOS 18、Pixel / Android 15、Web）と操作手順があるとレビューが速い
- 撮り方は [.claude/skills/evidence-video/SKILL.md](.claude/skills/evidence-video/SKILL.md) を参照

UI に一切影響しない変更（型定義のみ、コメントのみ、ビルド設定のみ）は免除するが、
その場合は **「スクショ不要の理由」を PR 本文に明記**すること。

### コミットメッセージ

書式の正は [.codex/commit-message-guidelines.md](.codex/commit-message-guidelines.md)。

### ネイティブビルド

EAS Build はビルド枠を消費する。ネイティブ差分の判定は
`.codex/skills/gh-nanitabeyo-release/scripts/audit-ota-inputs.sh` が正で、
差分が無ければ EAS Build ではなく eas-update（OTA）で配信する。
