# 2026-08-23 ドキュメント全量査定と整理方針

リポジトリ内の Markdown 103 ファイルを全数査定し、[管理規約](../README.md) を制定した記録。
各ファイルの処分判定と、その根拠（コードとの突き合わせ結果）を残す。

## 背景と根本原因

`docs/` 直下 23 ファイルのうち約半分が「PR 説明文をそのままファイル化した実装サマリー」で、
存在しない API を説明する文書が複数あった。原因は次の 4 つ。

1. **ライフサイクル規則の不在**: AI エージェントが実装のたびに `*_IMPLEMENTATION.md` / `*_SUMMARY.md` を
   生成し、マージ後も削除されずに堆積した（2026-08-14 の PR #1332 で 15 本が一括流入）
2. **正の一本化がされていない**: 同一トピック（CDN Cookie ×3、画像リサイズ ×3、共有リンク ×4、動画 ×2）が
   世代違いで並存し、どれが現行か判別不能だった
3. **エージェント指示書の分裂**: `CLAUDE.md` / `.github/copilot-instructions.md` / `.codex/**` が独立に書かれ、
   「lint は壊れている（実際は CI で全 PR 実行中）」等の真逆の記述が放置された
4. **ブランチ衛生**: head branch の自動削除が無効なため、マージ済みブランチが残る
   （ただし実測では残骸は最大 4 本で、大半は release / 作業中だった。下記参照）

## 決定事項

1. **設計と実装を分けない。** 設計の議論・経緯は Issue / PR、設計で決まったことは該当コードの
   `#Issue番号 【設計】` コメント（[.codex/commentary-policy.md](../../.codex/commentary-policy.md) が正）に書く。
   実装・アーキテクチャの解説 md は作らない — ソースコードを見た方が早いものはソースコードを見る
2. md として残すのは「コードを読んでも分からないこと」だけ。種類を 4 つ（仕様サマリー / ランブック /
   意思決定記録 / 作業ログ）に限定する — 規約は [docs/README.md](../README.md)。
   仕様サマリーは一目で引ける圧縮形に保ち、詳細はコードへの参照で示す
3. PR 説明の残骸・2 枚目 README・`*_OLD` を禁止し、既存分は下表のとおり削除・統合する
4. 廃止は**削除**で行う（履歴は git にある）。アーカイブディレクトリは作らない
5. `scripts/` 配下の日付付き作業ディレクトリは自己完結した作業ログとして**凍結（現状維持）**とする
6. `CLAUDE.md` にドキュメント作成規則を追記し、エージェントによる再堆積を防ぐ

## 処分表: docs/ 配下

判定の根拠は 2026-08-23 時点のコードとの突き合わせ。「参照 0 件」は他ファイルからのリンクが無いことを確認済み。

| ファイル                                              | 判定                                       | 根拠                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BEHAVIOR_TRACKING_LOGS.md`                           | KEEP（改名 kebab-case）                    | 参照先 6 ファイル全実在。#1078/#1079 の契約まで追記され手入れ継続中                                                                                                                                                       |
| `CDN_SIGNED_COOKIE_IMPLEMENTATION.md`                 | **DELETE**（CDN セットアップ手順のみ救出） | 記載の `cdnCookies` 方式はコード 0 ヒット。`CDN_HOST` も現在必須でフォールバック記述が不成立。セットアップ手順は `specs/cdn-signed-cookies.md` へ移した                                                                   |
| `HLS_SIGNED_COOKIE_IMPLEMENTATION.md`                 | 圧縮 → `specs/cdn-signed-cookies.md`       | CDN Cookie 3 兄弟で唯一現行実装と一致。ただし解説部分は設計コメントとして CookieQueueService 等の該当コードへ移し、md は Cookie 属性・CDN 前提などコードから読めない外部契約だけに圧縮する                                |
| `IMPLEMENTATION_SUMMARY_CDN_COOKIES.md`               | **DELETE**                                 | GitHub Actions ランナーの絶対パス・受け入れ条件チェックボックス等、純粋な PR 説明文。恒久情報ゼロ                                                                                                                         |
| `IMAGE_RESIZE_IMPLEMENTATION.md`                      | **DELETE**                                 | 中核 API `getOrQueueResizedSignedUrl()` / `queueResizeJob()` がコード 0 ヒット。現行方式（`thumbnail_processing_status` + CDN URL 組み立て）の設計判断は `dish-media.assembler.ts` 等のコードコメントへ書く               |
| `FEATURE_IMAGE_RESIZE_SUMMARY.md`                     | **DELETE**                                 | 上の PR 説明版。存在しない `validate.ts` の実行ログ入り                                                                                                                                                                   |
| `IMPLEMENTATION_VIDEO_ARCHITECTURE.md`                | **DELETE**（要点はコードコメントへ）       | 前提の `internal/transcode/` と `enqueueTranscodeJob()` が不在。実際は `internal/transcoder/`（webhook）+ 直接呼び出しで Cloud Tasks を経由しない                                                                         |
| `VIDEO_ARCHITECTURE_SUMMARY.md`                       | **DELETE**                                 | 上の短縮版で同じ誤りを含む                                                                                                                                                                                                |
| `IMPLEMENTATION_SUMMARY_OLD.md`                       | **DELETE**                                 | 中身（Google Places の通貨判定）は生きているが、関数一覧・対応通貨・使用例まで `app-expo/lib/googlePlaces.ts` に書いてあり md 側に足せる情報が無い。コードを正とする                                                      |
| `MAINTENANCE_SYSTEM.md`                               | 圧縮（+2 点修正）                          | `useHealthCheck.ts` は不在で実体は `HealthCheckInitializer.tsx`（そちらのコードコメントの方が既に詳しい＝コードを正とする実例）。md は運用パラメータと Remote Config 契約の要約に圧縮し、`allowedPaths` に `/livez` 追記  |
| `MEDIA_SELECTION_IMPLEMENTATION.md`                   | **DELETE**                                 | パス 3 箇所移動済み、`expo-av` は撤去済み（現 `expo-video`）。PR サマリー形式                                                                                                                                             |
| `DISH_CATEGORY_AUTOCOMPLETE_IMPLEMENTATION.md`        | **DELETE**                                 | 中心の「ReviewForm への統合」が解体済み。部品の現行利用箇所は別画面                                                                                                                                                       |
| `DISH_CATEGORY_MANUAL_IMAGE_SUPPLY.md`                | KEEP → `runbooks/`                         | 画面・DTO と一致。BigQuery/gsutil 手順は他に代替なし                                                                                                                                                                      |
| `auth-e2e-coverage.md`                                | KEEP                                       | 更新規約つきの生きた表。#1359 で実更新、`e2e-web/README.md` から参照                                                                                                                                                      |
| `database-connection-pool.md`                         | KEEP                                       | `env.ts` の 4 変数と完全一致                                                                                                                                                                                              |
| `manual-verification-parallel-dev-7he5dw.md`          | **DELETE**（末尾の恒久判断のみ退避）       | 特定ブランチの消化済み実機確認チェックリスト。`workflows: write` を付与しない理由等の恒久判断は `.claude/skills/parallel-development/CORE.md` へ移してから消す。`SavedRestaurantsSheet.tsx:55` の参照コメントも同時に更新 |
| `share-links.md`                                      | KEEP（統合先・圧縮候補）                   | 現行実装・コード内コメント・テストと一致する最新世代。落とし穴の記述はコードコメントと重複しているため、統合時にコード側を正として md は URL 設計の仕様サマリーへ寄せる                                                   |
| `mobile/UNIVERSAL_LINKS_IMPLEMENTATION.md`            | MERGE → `share-links.md`                   | AASA 配置先 `api/public/**` が不在（実体は `app-expo/public/`）。ドメイン・Team ID 等の生きた情報のみ移す                                                                                                                 |
| `mobile/share-and-links.md`                           | **DELETE**                                 | 最古世代。`your-domain.com` プレースホルダ、移動済みパス。内容は他 2 つに包含                                                                                                                                             |
| `mobile/store-redirect.md`                            | MERGE → `share-links.md`                   | 仕様は生きているが URL が全て旧 `food-scroll.web.app` 固定                                                                                                                                                                |
| `ui-catalog.md` / `ui-catalog-mobile.md`              | KEEP（自動生成物）                         | `pnpm catalog:doc` の出力。手編集・削除とも不可                                                                                                                                                                           |
| `ux/blur-modal-teardown.md`                           | KEEP → `decisions/` へ移設                 | 意思決定記録の手本。`assert-legacy-blur-modal-boundary.mjs` のエラーメッセージが本文書を指すため、**移設時にスクリプトとテストの参照パスも更新**                                                                          |
| `detailed_design/*.csv`, `sequence/*.mmd`, `ux/*.svg` | KEEP（現状維持）                           | 一次資料。今回の対象外                                                                                                                                                                                                    |

## 処分表: 散在ドキュメント

| ファイル                                                  | 判定                                     | 根拠                                                                                                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/README.md`                                           | **DELETE**（Auth Guards 3 行のみ救出）   | 103 行中 100 行が NestJS スターター定型文                                                                                                                                               |
| `api/LOG_BUFFERING_IMPLEMENTATION.md`                     | **DELETE**（設計判断はコードコメントへ） | コードは実在するが Before/After 形式の PR 説明。残す価値がある判断はバッファリング実装箇所の `【設計】` コメントへ                                                                      |
| `api/src/internal/resize-image/README.md`                 | 大幅圧縮（最優先）                       | 中核として説明する `getOrQueueResizedSignedUrl()` がコード 0 ヒット。**存在しない API の説明は無い文書より有害**。エンドポイントの外部契約とコードへの案内だけに圧縮する                |
| `api/test/functional/v1/dish-categories/README.md`        | KEEP                                     | ツールの使い方として正確                                                                                                                                                                |
| `app-expo/LOGGING_IMPLEMENTATION.md`                      | **DELETE**                               | 列挙イベントの一部（`dish_menu_opened` 等）がコード 0 ヒット。`docs/BEHAVIOR_TRACKING_LOGS.md` と役割重複                                                                               |
| `app-expo/.../DISH_CATEGORY_MANUAL_TEXT_SUPPLY_README.md` | MERGE → `docs/runbooks/`                 | 内容は正確だが「Issue #749 実装」形式。姉妹文書（画像版）と置き場所を揃える                                                                                                             |
| `app-expo/contexts/SeoContext/README.md`                  | KEEP                                     | 現行構成と一致                                                                                                                                                                          |
| `app-expo/features/mapMarkers/README*.md`（3 本）         | 3→1 統合・圧縮                           | `README_ARCHITECTURE.md` と `README_IMPLEMENTATION.md` は問題背景・解決策が相互重複、「廃止予定」記述も放置。`README.md`（42 行のコード案内）だけ残し、設計判断は該当コードのコメントへ |
| `app-expo/features/search/README.md`                      | KEEP                                     | 参照ファイル全実在                                                                                                                                                                      |
| `infra/big-query/README.md`                               | KEEP（migration SQL 一覧に 4 本追記）    | 入口として妥当だが一覧が 3/7 本しか載っていない                                                                                                                                         |
| `infra/big-query/README_BACKFILL.md`                      | KEEP（`backfill-runbook.md` へ改名）     | 再実行可能な運用ガイド                                                                                                                                                                  |
| `infra/big-query/IMPLEMENTATION_SUMMARY.md`               | **DELETE**                               | 「✅実装完了」形式。実手順は README_BACKFILL に全て存在                                                                                                                                 |
| `issues/central-cropping-bug-in-resizeImage.md`           | **DELETE**（`issues/` ごと）             | 提案どおり `position: 'center'` が実装済み。ディレクトリ唯一の残存物で、課題管理は GitHub Issues に移行済み                                                                             |
| `catalog/`, `e2e-web/`, `e2e-mobile/` の README           | KEEP                                     | いずれも現役・正確                                                                                                                                                                      |
| `scripts/**`（作業ログ 14 本）                            | 凍結（現状維持）                         | 日付付きディレクトリとして自己完結し、失敗記録・機械可読 JSON 連携まで揃っており水準が高い。個別整理はコストに見合わない                                                                |

## 処分表: エージェント指示書類

| ファイル                                                    | 判定                                     | 根拠                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/copilot-instructions.md` 1〜308 行                 | **全面書き直し**                         | 「lint は壊れている」「jest が無い」「E2E は機能していない」が全て逆（`pr-check.yml` が全 PR で lint/test を実行中、E2E は日次稼働中）。`.env` テンプレも必須変数 34 個中 8 個欠落で起動しない。**現状は Copilot を積極的に誤らせている**。正は `pr-check.yml` と README に置き、薄い参照にする |
| 同 309 行以降（コメント規約・i18n・PR スクショ）            | MERGE → `.codex/commentary-policy.md` 等 | コメント種別が `.codex` 側と不一致（【パフォーマンス】vs【性能】等）。実コードは `.codex` 側の 5 種別に従っているのでそちらを正とする                                                                                                                                                           |
| `README.md`（ルート）                                       | 更新                                     | `e2e/` → `e2e-web/` + `e2e-mobile/`、workspace 4 → 6 パッケージ、Expo SDK 53 → 54 / RN 0.79 → 0.81、スクリプト表の欠落補完                                                                                                                                                                      |
| `CLAUDE.md` の EAS 差分リスト                               | 参照化                                   | 差分パス 6 個のリストは `audit-ota-inputs.sh` の `native_path_pattern`（`ios/`, `android/`, `patches/` 等を含む）より狭く、単独に従うと OTA 可否を誤判定しうる。スクリプトへの参照に置き換え二重管理をやめる                                                                                    |
| `.codex/bigquery/{schemas,query-patterns,event-catalog}.md` | FROM 句差し替え                          | views 推奨だが、`error-triage/FORENSICS.md` の実測でビューはパーティション枝刈りが効かず 18.4GB/日（生テーブル 77MB）。同ディレクトリの `safety-policy.md`（1GB 超はユーザー確認）と自己矛盾。生テーブル `run_googleapis_com_stdout` 直参照へ                                                   |
| `.codex/bigquery/access.md`                                 | 更新                                     | `/home/ubuntu` 前提の gcloud パスが現環境に不在。BigQuery MCP ツール経路を正として追記。dev データセット規則の `API_TESTING.md:59` への丸写しも参照に変える                                                                                                                                     |
| `.claude/skills/**`, `.codex/skills/**`                     | KEEP                                     | 週次で手入れされており実質の正。スキル内に役割分担表・単一ソース規則が既にある                                                                                                                                                                                                                  |

## ブランチ衛生

リモートブランチ 59 本の内訳を `origin/main` の履歴と突き合わせて確認した結果、
**「大半が残骸」ではなかった**（当初の見立ては誤り）。実際の内訳は次のとおり。

| 種別                                          | 本数 | 扱い                                                                                                  |
| --------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------- |
| `release/1.0` 〜 `release/1.13`、`web`        | 15   | 意図的に残しているもの。**触らない**                                                                  |
| open PR に紐づくもの                          | 22   | 作業中。触らない                                                                                      |
| main に完全に含まれるもの（ancestor）         | 2    | **削除してよい**（`claude/issue-1212-carousel-gutter`、`claude/parallel-dev-orchestration-7he5dw`）   |
| マージ済みだが後続コミットが 1 件残るもの     | 2    | 中身を確認してから判断（`copilot/add-text-labels-to-bottom-tabs`、`copilot/fix-negative-like-count`） |
| open PR が無く、main に無いコミットを持つもの | 17   | **自動削除しない。** `claude/1399-*` / `claude/1400-*` など未完の作業が含まれる可能性がある           |

つまり掃除の対象は最大でも 4 本で、残り 17 本はオーナーが 1 本ずつ判断する必要がある。
機械的な一括削除は行わない。

**再発防止としては GitHub の「Automatically delete head branches」を有効化する**
（Settings → General → Pull Requests）。これはリポジトリ設定なのでオーナー操作が必要。
有効化しておけば、以後マージ済みブランチは自動で消え、残るのは意図的なものと未完のものだけになる。

## 実施フェーズ

| フェーズ | 内容                                                                                                   | 状態                   |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| 1        | 規約制定（`docs/README.md`）、本記録、`CLAUDE.md` への規則追記                                         | 完了                   |
| 2        | DELETE 判定の削除、圧縮・改名、共有リンク / mapMarkers の統合、参照元の更新                            | 完了                   |
| 3        | 指示書類の修正（`CONTRIBUTING.md` 新設、copilot-instructions 全面改訂、README 更新、EAS 差分の参照化） | 完了                   |
| 4        | `.codex/bigquery` の矛盾解消（コスト規則の明記、MCP 経路の追記、二重管理の解消）                       | 完了                   |
| 5        | 残骸ブランチの削除 + head branch 自動削除の有効化（**オーナー操作が必要**）                            | 未着手（オーナー操作） |
| 6        | CI ガード `pnpm assert:doc-hygiene` を `pr-check.yml` へ追加                                           | 完了                   |
