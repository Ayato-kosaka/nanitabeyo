# error-triage

本番ログ（BigQuery）の `error` を日次でトリアージし、未知のエラーグループを [#1196](https://github.com/Ayato-kosaka/nanitabeyo/issues/1196) の Sub Issue として起票する仕組みの実装。

**このディレクトリの現状は PR1（純関数群とユニットテストのみ）です。** 外部I/O（BigQuery / GitHub API / ファイルシステム）を持つコードはまだ1行も入っていません。

確定設計は #1196 のコメント「【横断レビュー】#1197 / #1198 / #1199 の統合設計」です。#1197 / #1198 / #1199 の個別設計は参考資料で、レビューと矛盾する箇所はレビューが優先します。

## PR の分割（レビュー §10）

| PR      | 内容                                                                                         | 状態     |
| ------- | -------------------------------------------------------------------------------------------- | -------- |
| **PR1** | 純関数群・fixture・ユニットテスト・workspace 登録                                            | **これ** |
| PR2     | `sql/error-triage.sql`（生成物）+ 生成器 + 一致検査、`bq.js`、`plan`（dry-run）Job、WIF 認証 | 未着手   |
| PR3     | `github.js`、`apply` 経路、`triage` Job、`schedule` トリガ、sub-issue 紐付け、親の常駐サマリ | 未着手   |

唯一の不可逆な副作用（Issue の起票）を最後の PR に隔離し、それ以前に「何が起票されるか」を実データで数日観測できる状態を作るのが、この順序の目的です。

## ファイル

| ファイル             | 役割                                                                                         | 外部I/O |
| -------------------- | -------------------------------------------------------------------------------------------- | ------- |
| `constants.js`       | 契約とガードレールの定数（`SCHEMA_VERSION` / `FP_ALGO_VERSION` / 除外ステータス / 各種上限） | なし    |
| `normalize-rules.js` | **置換ルール表（唯一の正）** と `normalize()`                                                | なし    |
| `fingerprint.js`     | fingerprint のハッシュ合成、`-- fpalgo: N` の一致検査                                        | なし    |
| `window.js`          | 25h スライド窓の計算、RFC3339 UTC、clock の注入点                                            | なし    |
| `triage.js`          | 契約エンベロープの組み立て・検証、索引、状態遷移、優先順位付け、起票計画                     | なし    |
| `render.js`          | Issue 本文・タイトル・Job Summary・常駐サマリの整形、本文マーカーの読み書き                  | なし    |
| `__fixtures__/`      | 固定JSON（正規化の10例 / SQL 出力行 / 既存 Issue 一覧 / runSummary）                         | —       |
| `*.test.js`          | 上記のユニットテスト（実装とコロケート）                                                     | なし    |

## テスト

```bash
pnpm --filter error-triage test
```

`jest` のみ（`ts-jest` も `babel` も使わない CommonJS の素の JS）。ランナーは `app-expo` / `api` と同じ jest 29.7 に合わせています。**vitest は入れません。**

`contract.test.js` はレビュー §7「契約の不変条件」6項目を1対1で固定しています。契約を変えるときはここが赤くなります。

## 設計上の要点（実装で効いてくるもの）

### 正規化は SQL、ハッシュ合成は JS（レビュー 1-2 / B1）

`normalize-rules.js` の `NORMALIZE_RULES` が唯一の正で、**PR2 でここから SQL の `REGEXP_REPLACE` 群を生成**します。正規化を JS 側でやると、生 message 全件を BigQuery の外へ出すことになり（秘密値の露出）、かつ JS 側で再グルーピングする羽目になって `affectedUsers` が `occurrences` に退化します。

そのためルールは **RE2 と JS 正規表現の共通部分集合**に限定しています（先読み・後読み・後方参照・インラインフラグ禁止）。これは `normalize-rules.test.js` が機械的に検査します。

### fingerprint は 1行 ⇔ 1グループ

`attachFingerprints()` は入力行数と出力要素数が必ず一致します。**JS 側で再グルーピングしません。** 同じ fingerprint の行が2つ来ても決してマージしません（マージすると `affectedUsers` が壊れる）。

### clock は注入する（レビュー S12）

`window.js` は `Date.now()` / 引数なしの `new Date()` を呼びません。実時刻の入口は `systemClock()` ただ1つで、これを呼ぶのはエントリポイント（PR2/PR3 の `main.js`）だけです。これにより `plan` 出力がバイト単位で再現します。

### 除外ステータス（レビュー §6-4 / S3）

除外は `401, 403, 404, 408, 425, 426, 429` のみ。**`400` / `409` / `422` は残します。**
`app-expo/lib/logQueue.ts` の `TRANSIENT_STATUSES` が「400/422 は契約が壊れている状態＝不具合」と定義済みで、この API の一次クライアントは自前の `app-expo` なので、`ValidationError` 400 はほぼ常に自分たちの DTO 不整合＝実バグです。`constants.js` の `TRANSIENT_HTTP_STATUSES` は `logQueue.ts` と同一定義なので、片方だけ変えないこと。

### `FP_ALGO_VERSION`（レビュー 1-3）

fingerprint 定義は SQL 側の正規化と JS 側の合成に跨がります。JS の定数1つを正とし、PR2 で SQL 冒頭に `-- fpalgo: 1` を書いて `assertSqlFpAlgoVersion()` で一致検査します。片方だけ変えて全件再起票、を構造的に防ぐためのものです。
