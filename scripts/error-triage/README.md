# error-triage

本番ログ（BigQuery）の `error` を日次でトリアージし、未知のエラーグループを [#1196](https://github.com/Ayato-kosaka/nanitabeyo/issues/1196) の Sub Issue として起票する仕組みの実装。

**このディレクトリの現状は PR2 です。** BigQuery からの読み取り（`bq.js`）と、Issue を起票しない dry-run の `plan` 経路までが入っています。GitHub API を叩くコード（`github.js` / `apply` / `triage` Job / `schedule` トリガ）はまだ1行も入っていません。

確定設計は #1196 のコメント「【横断レビュー】#1197 / #1198 / #1199 の統合設計」です。#1197 / #1198 / #1199 の個別設計は参考資料で、レビューと矛盾する箇所はレビューが優先します。

## PR の分割（レビュー §10）

| PR      | 内容                                                                                         | 状態     |
| ------- | -------------------------------------------------------------------------------------------- | -------- |
| PR1     | 純関数群・fixture・ユニットテスト・workspace 登録                                            | マージ済 |
| **PR2** | `sql/error-triage.sql`（生成物）+ 生成器 + 一致検査、`bq.js`、`plan`（dry-run）Job、WIF 認証 | **これ** |
| PR3     | `github.js`、`apply` 経路、`triage` Job、`schedule` トリガ、sub-issue 紐付け、親の常駐サマリ | 未着手   |

唯一の不可逆な副作用（Issue の起票）を最後の PR に隔離し、それ以前に「何が起票されるか」を実データで数日観測できる状態を作るのが、この順序の目的です。

## ファイル

| ファイル             | 役割                                                                                         | 外部I/O |
| -------------------- | -------------------------------------------------------------------------------------------- | ------- |
| `constants.js`       | 契約とガードレールの定数（`SCHEMA_VERSION` / `FP_ALGO_VERSION` / 除外ステータス / 各種上限） | なし    |
| `normalize-rules.js` | **置換ルール表＋後処理（唯一の正）** と `normalize()`                                        | なし    |
| `fingerprint.js`     | fingerprint のハッシュ合成、`-- fpalgo: N` の一致検査                                        | なし    |
| `window.js`          | 25h スライド窓の計算、RFC3339 UTC、clock の注入点                                            | なし    |
| `triage.js`          | 契約エンベロープの組み立て・検証、索引、状態遷移、優先順位付け、起票計画                     | なし    |
| `render.js`          | Issue 本文・タイトル・Job Summary・常駐サマリの整形、本文マーカーの読み書き                  | なし    |
| `sql-generator.js`   | **ルール表から BigQuery SQL を生成する**（純関数。文字列を返すだけ）                         | なし    |
| `generate-sql.js`    | `sql/error-triage.sql` を書き出す CLI                                                        | ファイル |
| `sql/error-triage.sql` | **生成物**（直接編集しない）。窓のリテラル2つだけがテンプレート変数                        | —       |
| `bq.js`              | BigQuery REST `jobs.query` の直叩き、コストガード2層、契約エンベロープの組み立て             | ネットワーク |
| `main.js`            | 唯一のエントリポイント。`plan`（dry-run）サブコマンドのみ実装（`apply` は PR3）              | 実時刻/ファイル/ネットワーク |
| `__fixtures__/`      | 固定JSON（正規化ケース / SQL 出力行 / 既存 Issue 一覧 / runSummary）                         | —       |
| `*.test.js`          | 上記のユニットテスト（実装とコロケート）。BigQuery も GitHub も叩かない                      | なし    |

## SQL の再生成

```bash
pnpm --filter error-triage generate:sql
```

`normalize-rules.js`（置換ルール表 / 後処理）か `constants.js`（除外ステータス / グループ上限 / `FP_ALGO_VERSION`）を
変えたら**必ず**これを回して、生成物 `sql/error-triage.sql` を一緒に commit してください。
`sql-generator.test.js` が「ディスク上の生成物 ≡ いま生成した文字列」を1バイト単位で比較するので、
忘れると CI が赤になります。**SQL を手で編集しないでください**（ルール表と二重管理になった瞬間、
SQL の `REGEXP_REPLACE` と JS の `normalize()` が別の結果を出し、同じエラーが2グループに割れて重複起票されます）。

## テスト

```bash
pnpm --filter error-triage test
```

`jest` のみ（`ts-jest` も `babel` も使わない CommonJS の素の JS）。ランナーは `app-expo` / `api` と同じ jest 29.7 に合わせています。**vitest は入れません。**

CI では `.github/workflows/pr-check.yml` の「error-triage のユニットテスト」step が `pull_request` ごとに実行します。secrets もネットワークも `shared` の build も不要なので、fork からの PR でも走ります。

`contract.test.js` はレビュー §7「契約の不変条件」6項目を1対1で固定しています。契約を変えるときはここが赤くなります。

## 設計上の要点（実装で効いてくるもの）

### 正規化は SQL、ハッシュ合成は JS（レビュー 1-2 / B1）

`normalize-rules.js` が唯一の正で、**PR2 でここから SQL を生成**します。正規化を JS 側でやると、生 message 全件を BigQuery の外へ出すことになり（秘密値の露出）、かつ JS 側で再グルーピングする羽目になって `affectedUsers` が `occurrences` に退化します。

生成の材料は2つあり、**どちらもこのファイルが唯一の正**です。

| エクスポート      | 生成される SQL                                                          |
| ----------------- | ----------------------------------------------------------------------- |
| `NORMALIZE_RULES` | `REGEXP_REPLACE(<expr>, r'<re2Pattern>', '<replacement>')` を順に重ねる |
| `POST_RULE_STEPS` | 各要素の `sql`（`TRIM` → `SUBSTR(…, 1, 200)` → `TRIM`）を順に重ねる     |

`POST_RULE_STEPS` が表の外にあると、PR2 が生成した SQL は trim も切り詰めもしない式を吐き、その出力を `isNormalized()` が「未正規化」と判定して `validateEnvelope` に弾かれます。切り詰めは **コードポイント単位**です（BigQuery の `SUBSTR()` は文字単位、JS の `slice()` は UTF-16 コードユニット単位なので、絵文字の境界で孤立サロゲートが生まれる）。

そのためルールは **RE2 と JS 正規表現の共通部分集合**に限定しています。

- 先読み・後読み・後方参照・インラインフラグを使わない
- **Unicode 差のあるショートハンド `\s` / `\S` / `\w` / `\W` を使わない。** RE2 の `\s` は `[\t\n\f\r ]`（ASCII のみ。`\v` すら含まない）、JS の `\s` は U+00A0 / U+2007 / U+3000 / U+FEFF / `\v` などを含むため、同じルール文字列が SQL と JS で違う結果を出します。空白は `WHITESPACE_CODE_POINTS`（＝ JS の `\s` と同一集合。全角スペース U+3000 を含む）から文字クラスを生成します
- 非 ASCII の表記は JS が `\uXXXX`、RE2 が `\x{XXXX}` と違うので、各ルールは `pattern`（JS 表記）と `re2Pattern`（RE2 表記）の両方を持ちます。**唯一の正はコードポイントの集合**であって、正規表現の文字列そのものではありません
- `\d` と `\b` は RE2 / JS とも ASCII 一致なのでそのまま使えます

これらは `normalize-rules.test.js` が機械的に検査します（構文だけでなく、上記の**意味の差**も検査します）。

### fingerprint は 1行 ⇔ 1グループ

`attachFingerprints()` は入力行数と出力要素数が必ず一致します。**JS 側で再グルーピングしません。** 同じ fingerprint の行が2つ来ても決してマージしません（マージすると `affectedUsers` が壊れる）。

### Issue 本文は人間の記述を絶対に捨てない

`renderIssueBody()` は自動領域マーカー（`error-triage:auto:start` / `:end`）の内側だけを差し替えます。**マーカーが見つからない場合でも既存 body は1文字も捨てず**、作り直した自動領域の下へそのまま保全します。自動領域内の注意書きは `<!-- fp:… -->` を消すなとしか書いておらず、人間がマーカーだけ消すことは十分あり得るためです。ここで捨てると PR3 の body 更新（PATCH）で担当者の調査メモが黙って消えます。

### clock は注入する（レビュー S12）

`window.js` は `Date.now()` / 引数なしの `new Date()` を呼びません。実時刻の入口は `systemClock()` ただ1つで、これを呼ぶのはエントリポイント（PR2/PR3 の `main.js`）だけです。これにより `plan` 出力がバイト単位で再現します。

### 除外ステータス（レビュー §6-4 / S3）

除外は `401, 403, 404, 408, 425, 426, 429` のみ。**`400` / `409` / `422` は残します。**
`app-expo/lib/logQueue.ts` の `TRANSIENT_STATUSES` が「400/422 は契約が壊れている状態＝不具合」と定義済みで、この API の一次クライアントは自前の `app-expo` なので、`ValidationError` 400 はほぼ常に自分たちの DTO 不整合＝実バグです。`constants.js` の `TRANSIENT_HTTP_STATUSES` は `logQueue.ts` と同一定義なので、片方だけ変えないこと。

### `FP_ALGO_VERSION`（レビュー 1-3）

fingerprint 定義は SQL 側の正規化と JS 側の合成に跨がります。JS の定数1つを正とし、PR2 で SQL 冒頭に `-- fpalgo: 1` を書いて `assertSqlFpAlgoVersion()` で一致検査します。片方だけ変えて全件再起票、を構造的に防ぐためのものです。

### SQL は生成物（PR2）

`sql/error-triage.sql` は `sql-generator.js` の出力です。生成器が守っている制約は次のとおりで、
どれも `sql-generator.test.js` が機械的に検査します。

| 制約 | なぜ |
| --- | --- |
| **単一文**（`CREATE TEMP FUNCTION` を使わない） | multi-statement script になると `dryRun` がバイト見積りを返さず、コストガードの第2層が黙って無効化される（B3） |
| 正規化式は `UNNEST([...]) WITH OFFSET` で**1回だけ**書く | 5箇所へコピペするとルール表との対応が壊れる。`norm[OFFSET(n)]` で取り出す |
| `re2Pattern` は**三重引用 `r'''...'''`** で埋め込む | ルール6（url-query）が `'` と `"` を両方含むため、`r'...'` も `r"..."` も構文エラーになる（PR #1200 再レビュー） |
| `LIMIT` ではなく `QUALIFY ROW_NUMBER() OVER (...) <= 500` | `runSummary.groupCount` を**制限前**の CTE から数えないと、切り捨て検知（G3）が原理的に不能になる |
| 窓は**リテラル埋め込み**。`CURRENT_TIMESTAMP()` を使わない | パーティション枝刈りが外れた瞬間 22.8GiB のフルスキャンになる |
| ビュー・`*_legacy` を参照しない / `TO_JSON_STRING(jsonPayload)` を使わない | ビューの `created_at` は計算列で枝刈りが効かず 18.4GB/日。全リーフ読みも同じ爆発を再現する |
| `GROUP BY` は `fingerprint.js` の `FINGERPRINT_KEY_FIELDS` と**完全一致** | SQL の1行と JS の1グループが 1:1 でないと `affectedUsers` が `occurrences` に退化する（B1） |
| `ANY_VALUE()` を使わない | fingerprint に含まれない列へ使うと出力が非決定的になり、同じ入力から違う Issue 本文が出る（N4） |

`jsonPayload.error_message` は **STRUCT に存在しません**（オーナーが `bq show --schema` で確認済み）。
直接参照するとクエリ全体が `Field name error_message does not exist in STRUCT` で落ちるため、
横断レビュー §6-3 / #1197 §8-1 の退避策どおり `CAST(NULL AS STRING)` に固定しています。
`JSON_VALUE(TO_JSON_STRING(jsonPayload), '$.error_message')` 経由なら列が無くても落ちませんが、
`TO_JSON_STRING(jsonPayload)` は `request_payload` / `response_payload` を含む全リーフ読みになり、
#1196 が避けた 18.4GB/日 のコスト爆発をそのまま再現するので採っていません。
失われるのは除外ルール E7 の正規表現条件だけで、external のエラー判定は `status_code` 側で成立します。

### BigQuery アクセスは REST 直叩き（PR2 / 横断レビュー §6-1）

`bq` CLI は使いません。`google-github-actions/auth@v2` の `token_format: access_token` で
アクセストークンを受け取り、`jobs.query` を Node 組み込み `fetch` で叩きます。
`bq` × WIF の前例がこのリポジトリに1本も無く初回で詰まるリスクが高いこと、
REST のリクエストボディに `maximumBytesBilled` と `dryRun` を入れられるので
**コスト上限も dry-run 見積りも CLI と等価**に保てること、依存パッケージが増えないことが理由です。
`setup-gcloud` も要りません。

コストガードは2層です。

1. `maximumBytesBilled = 200MB` を**常に**リクエストへ載せる。`buildQueryRequest()` は引数で渡された値を
   **無視して**定数を使うので、Workflow の `env` / `inputs` からはバイパスできません（テストで固定）。
2. 本クエリの前に `dryRun: true` で見積もり、200MB を超えていたら**本クエリを投げずに fail** します。
   毎日の実スキャン量が Job Summary に残るので、じわじわ増えていることにも気づけます。

### dry-run の回し方（PR2 時点）

```bash
gh workflow run error-triage.yml -f lookback_hours=25
# ブランチで検証する間は --ref を明示（schedule はまだ無く、workflow_dispatch のみ）
gh workflow run error-triage.yml --ref <branch> -f lookback_hours=25
```

`plan` Job は `issues: read` しか持たないため、Issue の起票・reopen・コメントは**権限レベルで不可能**です。
PR2 の時点ではまだ既存 Issue を読んでいない（`github.js` が PR3）ので、全グループが「未知の fingerprint」
として扱われます。ここで見るべきは**エラーグループの種類数と `excludedBreakdown` の内訳**です。
