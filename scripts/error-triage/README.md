# error-triage

本番ログ（BigQuery）の `error` を日次でトリアージし、未知のエラーグループを [#1196](https://github.com/Ayato-kosaka/nanitabeyo/issues/1196) の Sub Issue として起票する仕組みの実装。

**このディレクトリの現状は PR3（最終）です。** BigQuery からの読み取り（`bq.js`）、突合と起票計画（`triage.js`）、GitHub API と適用（`github.js`）まで揃っています。

確定設計は #1196 のコメント「【横断レビュー】#1197 / #1198 / #1199 の統合設計」です。#1197 / #1198 / #1199 の個別設計は参考資料で、レビューと矛盾する箇所はレビューが優先します。

## PR の分割（レビュー §10）

| PR      | 内容                                                                                         | 状態     |
| ------- | -------------------------------------------------------------------------------------------- | -------- |
| PR1     | 純関数群・fixture・ユニットテスト・workspace 登録                                            | マージ済 |
| PR2     | `sql/error-triage.sql`（生成物）+ 生成器 + 一致検査、`bq.js`、`plan`（dry-run）Job、WIF 認証 | マージ済 |
| **PR3** | `github.js`、`apply` 経路、`triage` Job、`schedule` トリガ、sub-issue 紐付け、親の常駐サマリ | **これ** |

唯一の不可逆な副作用（Issue の起票）を最後の PR に隔離し、それ以前に「何が起票されるか」を実データで数日観測できる状態を作るのが、この順序の目的です。

## ファイル

| ファイル               | 役割                                                                                         | 外部I/O                      |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- |
| `constants.js`         | 契約とガードレールの定数（`SCHEMA_VERSION` / `FP_ALGO_VERSION` / 除外ステータス / 各種上限） | なし                         |
| `normalize-rules.js`   | **置換ルール表＋後処理＋pathName のロケール剥がし（唯一の正）** と `normalize()`             | なし                         |
| `fingerprint.js`       | fingerprint のハッシュ合成、旧世代 fingerprint の復元、`-- fpalgo: N` の一致検査             | なし                         |
| `window.js`            | 25h スライド窓の計算、RFC3339 UTC、clock の注入点                                            | なし                         |
| `triage.js`            | 契約エンベロープの組み立て・検証、索引、状態遷移、優先順位付け、起票計画                     | なし                         |
| `render.js`            | Issue 本文・タイトル・Job Summary・常駐サマリの整形、本文マーカーの読み書き                  | なし                         |
| `sql-generator.js`     | **ルール表から BigQuery SQL を生成する**（純関数。文字列を返すだけ）                         | なし                         |
| `generate-sql.js`      | `sql/error-triage.sql` を書き出す CLI                                                        | ファイル                     |
| `sql/error-triage.sql` | **生成物**（直接編集しない）。窓のリテラル2つだけがテンプレート変数                          | —                            |
| `bq.js`                | BigQuery REST `jobs.query` の直叩き、コストガード2層、契約エンベロープの組み立て             | ネットワーク                 |
| `github.js`            | GitHub REST（索引・起票・reopen・body 更新・sub-issue 紐付け・常駐サマリ）と `applyPlan`     | ネットワーク                 |
| `main.js`              | 唯一のエントリポイント。`plan`（dry-run）と `apply`（書き込み）                              | 実時刻/ファイル/ネットワーク |
| `__fixtures__/`        | 固定JSON（正規化ケース / SQL 出力行 / 既存 Issue 一覧 / runSummary）                         | —                            |
| `*.test.js`            | 上記のユニットテスト（実装とコロケート）。BigQuery も GitHub も叩かない                      | なし                         |

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

### `CREATE_LIMIT = 20`（オーナー判断）

#1196 の当初値は 5 でしたが、PR2 の dry-run を本番で回した実データに基づき **20** へ引き上げました。
25h 窓の除外後エラーグループは **21 件**（backend 10 / frontend 11、保持行 5,575）で、除外前 526 件の
うち 505 件は `ApiExceptionFilter` / `HttpException` の 404（`wp-login.php` `.env` `wp-json/` 等の
外部脆弱性スキャナ）── E6 の除外が正しく落としています。5 のままだと 21 件を捌くのに5日かかり、
その間ずっと「毎日5件ずつ増える」状態になります。20 なら初回 20 件・翌日 1 件で収束します。
`PANIC_THRESHOLD`（50）には届かず、`GROUP_LIMIT`（500）の切り捨ても起きません。

### 除外ステータス（レビュー §6-4 / S3）

除外は `401, 403, 404, 408, 425, 426, 429` のみ。**`400` / `409` / `422` は残します。**
`app-expo/lib/logQueue.ts` の `TRANSIENT_STATUSES` が「400/422 は契約が壊れている状態＝不具合」と定義済みで、この API の一次クライアントは自前の `app-expo` なので、`ValidationError` 400 はほぼ常に自分たちの DTO 不整合＝実バグです。`constants.js` の `TRANSIENT_HTTP_STATUSES` は `logQueue.ts` と同一定義なので、片方だけ変えないこと。

### `FP_ALGO_VERSION`（レビュー 1-3）

fingerprint 定義は SQL 側の正規化と JS 側の合成に跨がります。JS の定数1つを正とし、SQL 冒頭に `-- fpalgo: N` を書いて `assertSqlFpAlgoVersion()` で一致検査します。片方だけ変えて全件再起票、を構造的に防ぐためのものです。

現行は **`FP_ALGO_VERSION = 2`**。世代の履歴は次のとおりです。

| 世代 | 内容                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| 1    | 初版                                                                                |
| 2    | `groupKey.pathName` の**先頭ロケールを剥がす**（下の「pathName のロケール正規化」） |

### pathName のロケール正規化（fpalgo 2 / #1196 CLUSTERING.md 類型1）

`path_name` は `app-expo` の `usePathname()` そのもので、`app/[locale]/…` というルーティングの都合上、
**必ず先頭にロケールが付きます**（`/ja-JP/search/result` / `/en-US/search/result` / …）。
そのため同じ画面の同じエラーが言語ごとに別 fingerprint へ割れ、初回起票では
オーナー返信 18 件のうち 13 件が「重複してそう」になりました。

`normalize-rules.js` の `PATH_LOCALE_RULES`（唯一の正。SQL は `sql-generator.js` がここから生成する）で、
**`normalize()` の後に**先頭ロケールを剥がします。

- 剥がす形: `ja` / `ja-JP` / `zh-Hant` / `zh-Hant-TW` / `es-<n>`（`es-419` が数値ルールを通った姿）/ `[locale]`
- **剥がさない形**: 素の3文字小文字（`map` `food` …）。`app/[locale]/(tabs)/map.tsx` が実在するため、
  これを許すと `/ja-JP/map` → `/map` → `/` と2段で画面名まで消えます。素で許すのは2文字言語タグだけです。
- 剥がしたロケールは**捨てません**。SQL が `localeCounts`（ロケール別件数）を出し、Issue 本文の
  「どのロケール」行に内訳が載ります。CLUSTERING.md の「1ロケールだけなら別物の可能性がある」を
  人間が確かめられるようにするためです。1ロケールしか無いときは本文に注意書きが出ます
  （`(ロケールなし)` だけのとき＝ `/store` のようなロケール配下でないパスには出しません）。
- **既知の限界**: `stripPathLocale()` は各ルールを1回しか掛けないので、ロケール2段
  （`/ja/en/foo` → `/en/foo`）では冪等になりません。`app-expo/app/` にロケール直下の2文字小文字
  セグメントは無いので実データでは起きませんが、`+not-found.tsx` が任意 URL を拾うためゼロではありません。
  この形を検出したときは**そのグループだけを `invalid`** にし、run 全体は止めません
  （1つの奇妙なパスでその日のトリアージ（起票も body 更新も）が丸ごと止まる方が被害が大きいため）。
  件数と fingerprint は `plan.invalidGroups` / Job Summary / 親の常駐サマリに必ず出ます。
  他の契約検査（禁止フィールド / 正規化 / fingerprint 形式 / 未知 surface）は従来どおり run 全体を止めます。

### fingerprint 世代の移行（fpalgo 1 → 2）— 人間がやること

fingerprint の定義を変えると、既存 Issue のマーカー（`<!-- fp:… -->`）が現行の fingerprint と一致しなくなり、
放っておくと**全件が新規起票**されます。これを次の3段構えで防いでいます。

1. **突合（自動・止められない）** — `fingerprint.js` の `computeLegacyFingerprints()` が、
   `localeCounts` を使って「この group が fpalgo 1 のとき持っていたはずの fingerprint」を
   ロケールごとに**厳密に復元**し、現行 fingerprint で当たらなかったときだけそちらで索引を引きます
   （`triage.js` の `resolveEntry()`）。**重複起票しないことはこの一段だけで成立します。**
2. **リキー（自動・後片付け）** — 旧 fingerprint で当たった Issue の body を PATCH して、
   `<!-- fp:… -->` と `<!-- fpalgo:… -->` を現行世代へ書き換えます（`render.js` の `rekeyIssueBody()`）。
   本文には「なぜ fingerprint が変わったか」と**統合先（代表）の Issue 番号**の注記が自動で入ります。
   **これは失敗しても・上限で溢れても重複起票にはなりません。**
3. **保留（自動・移行中だけ）** — 1. の復元は**その run の `localeCounts` に載っているロケールぶんだけ**
   当たります。旧 Issue のロケールがその窓に1件も出ていない（`ar` / `hi` のような低頻度ロケール）と
   突合が外れて新規起票になり、以後は現行 fingerprint が先に当たるので**旧 Issue が永久に孤児化**します。
   そこで、**まだ突合できていない旧世代の open Issue が残っている間は frontend の起票を保留**します
   （`triage.js` の `migrationBlockers()` / action `withheld`）。取りこぼしは翌日回復できますが、
   孤児化は人手でしか回復できないためです。backend / external は `keyPathName` が常に NULL で
   v1 = v2 なので**保留しません**（不必要に起票を止めない）。

   保留が解ける条件は「未突合の旧世代 open Issue が 0 件になること」で、
   Job Summary と親 #1196 の常駐サマリに**その Issue 番号が毎 run 出ます**（`plan.migrationBlockers`）。
   突合されれば自動で消え、二度と再発しないものは人間が close すれば消えます。
   なお **`pendingAlgoVersions` が空になるのは待ちません**。backend / external の旧 Issue は
   現行 fingerprint でそのまま当たる（＝リキー計画に載らない）ため、そのマーカーは fpalgo 1 のまま
   永久に残り、これを保留条件にすると frontend の起票が**永久に止まる**からです。

つまり移行は **`apply` を普通に回すだけで自動的に進みます**。人間がやることは次の3つだけです。

```bash
# 1. まず影響を読む（GitHub へ1バイトも書かない）
node scripts/error-triage/main.js apply --dry-run --out /tmp/plan.json
```

Job Summary に「fingerprint のリキー」の表が出ます。**どの Issue がどの Issue と同じ fingerprint に
統合されるか**をここで確認してください。表の「統合先」列が代表（残す Issue）です。
特に `err/skip` 付きの行に ⚠️ が出ていたら、次の 2. を先に行います。

**このとき、リキー表に v1（`fpalgo 1`）の Issue が1件残らず載っていることを必ず確認してください。**
載っていない v1 Issue は「そのロケールがこの窓に出ていない」＝ 突合できていない Issue で、
孤児化の候補です。載っていない Issue は Job Summary の 🚧 の行（`plan.migrationBlockers`）に
番号が出るので、突き合わせて確認できます。1件でも残っている間は frontend の起票が保留されます。

2. **`err/skip` 付きの重複 Issue があれば、先にラベルを外す。**
   旧 CLUSTERING.md の手順は「代表を残し、重複側に `err/skip`」でしたが、ロケール差分が**同一 fingerprint に
   畳まれた後**はこの手順が使えません。統合後は1つの fingerprint なので、重複側に付いた `err/skip` が
   **クラスタ全体を恒久無視**にします。移行後は「重複側は `err/skip` を付けずに duplicate として close」が正です。

3. **`apply` を回す**（日次 schedule でも同じです）。リキーが走り、
   `plan.migrationBlockers` が空（＝ Job Summary に 🚧 の行が出ない）になったら
   **frontend の起票が再開**します。ここが実質的な移行完了地点です。
   統合された重複 Issue は自動では閉じません。**人間が duplicate として close してください**
   （どれを残すかは各 Issue 本文の「統合先: #NNNN」/「このIssueが統合先（代表）です」で分かります）。

補足:

- **冪等**です。同じ run を何度流しても、2回目以降は API を1回も叩きません（`rekeyIssueBody()` が `null` を返す）。
  途中でクラッシュして一部だけリキー済みでも、次回は現行 fingerprint で当たるので何も起きません。
- 1 run のリキー件数は `REKEY_LIMIT`（50）で頭打ちにします。溢れたぶんは次回 run へ回ります
  （**突合は既に成立している**ので、これは重複起票にはなりません）。
  一方 `LOCALE_BREAKDOWN_LIMIT`（50）で溢れたロケールは**突合そのものが外れる**（＝ create になる）ので
  別問題です。そちらは上の 3.（保留）で受け止めます。混同しないこと。
- `SUPPORTED_ALGO_VERSIONS` に載っていない世代（＝復元器を持たない世代）が索引に混ざったら、
  従来どおり**1バイトも書かずに abort** します（#1198 §8-A）。
- 将来 fpalgo 3 を作るときは、`computeLegacyFingerprints()` が使い回している**現行の合成器**が
  そのままでよいか確認してください。世代差が「groupKey の値の作り方」に閉じている間しか使い回せません。
  合成器そのもの（キー構成 / 区切り / ハッシュ）を変えるなら、v1 の合成器をスナップショットとして持つ必要があります。

### SQL は生成物（PR2）

`sql/error-triage.sql` は `sql-generator.js` の出力です。生成器が守っている制約は次のとおりで、
どれも `sql-generator.test.js` が機械的に検査します。

| 制約                                                                       | なぜ                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **単一文**（`CREATE TEMP FUNCTION` を使わない）                            | multi-statement script になると `dryRun` がバイト見積りを返さず、コストガードの第2層が黙って無効化される（B3）   |
| 正規化式は `UNNEST([...]) WITH OFFSET` で**1回だけ**書く                   | 5箇所へコピペするとルール表との対応が壊れる。`norm[OFFSET(n)]` で取り出す                                        |
| `re2Pattern` は**三重引用 `r'''...'''`** で埋め込む                        | ルール6（url-query）が `'` と `"` を両方含むため、`r'...'` も `r"..."` も構文エラーになる（PR #1200 再レビュー） |
| `LIMIT` ではなく `QUALIFY ROW_NUMBER() OVER (...) <= 500`                  | `runSummary.groupCount` を**制限前**の CTE から数えないと、切り捨て検知（G3）が原理的に不能になる                |
| 窓は**リテラル埋め込み**。`CURRENT_TIMESTAMP()` を使わない                 | パーティション枝刈りが外れた瞬間 22.8GiB のフルスキャンになる                                                    |
| ビュー・`*_legacy` を参照しない / `TO_JSON_STRING(jsonPayload)` を使わない | ビューの `created_at` は計算列で枝刈りが効かず 18.4GB/日。全リーフ読みも同じ爆発を再現する                       |
| `GROUP BY` は `fingerprint.js` の `FINGERPRINT_KEY_FIELDS` と**完全一致**  | SQL の1行と JS の1グループが 1:1 でないと `affectedUsers` が `occurrences` に退化する（B1）                      |
| `ANY_VALUE()` を使わない                                                   | fingerprint に含まれない列へ使うと出力が非決定的になり、同じ入力から違う Issue 本文が出る（N4）                  |

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

1. `maximumBytesBilled = 1GB` を**常に**リクエストへ載せる。`buildQueryRequest()` は引数で渡された値を
   **無視して**定数を使うので、Workflow の `env` / `inputs` からはバイパスできません（テストで固定）。
2. 本クエリの前に `dryRun: true` で見積もり、1GB を超えていたら**本クエリを投げずに fail** します。
   毎日の実スキャン量が Job Summary に残るので、じわじわ増えていることにも気づけます。

### GitHub 同期（PR3 / `github.js`）

**索引は `list_issues` のラベルフィルタで作ります。`search_issues` は使いません。**
検索インデックスの反映が遅れるため、起票直後の run で「まだ検索に出てこない」→「未知 fingerprint」→
**重複起票**が普通に起きます。`GET /repos/{o}/{r}/issues?labels=error-triage&state=all` は
検索インデックス非依存です。`sort=created&direction=asc` を明示するのは、既定の `created desc` だと
ページング中に新規 Issue ができた瞬間に全体が後ろへずれて1件読み飛ばすためです。

第2の索引源として `GET /repos/{o}/{r}/issues/1196/sub_issues` を和集合に入れます（レビュー §4）。
ラベルに一切依存しないので、人間が `error-triage` ラベルを外しても救われます
（`err/auto` の2枚目ラベルは §4 で却下されました）。**これが失敗しても run は落としません。**

| 状態                    | 条件                                         | アクション                                    | 通知 |
| ----------------------- | -------------------------------------------- | --------------------------------------------- | ---- |
| `NEW`                   | 索引に無い                                   | 起票（`CREATE_LIMIT` の枠内）                 | あり |
| `SKIPPED`               | `err/skip` 付き（open / closed 問わず）      | **API コール0**。reopen もしない              | なし |
| `KNOWN_OPEN`            | open                                         | body の自動領域だけ更新（スロットリングつき） | なし |
| `CLOSED_WONTFIX`        | closed(not_planned)                          | reopen しない。body のみ                      | なし |
| `REGRESSION`            | closed かつ `closedAt + 24h` 以降に 3 件以上 | 回帰コメント → reopen                         | あり |
| `RECURRENCE_SUPPRESSED` | closed だが猶予内 / 件数不足 / 旧ビルドのみ  | 何もしない                                    | なし |
| `STALE_OPEN`            | BigQuery に出てこない open                   | **自動 close しない**                         | なし |

通知が飛ぶ操作は**「新規起票」と「回帰 reopen + コメント」の2つだけ**です。既存 open Issue の
件数更新は body の PATCH で行います（本文編集では通知が飛びません）。

**冪等性の担保**は「状態を持たず、毎回 GitHub の索引から再構成する」ことです。加えて:

- **起票の直前に索引を取り直す**。計画を作ってから今までの間に別 run が起票していたら気づいて飛ばす
- POST / PATCH は**自動リトライしない**。結果不明になったらバックオフして索引を読み直し、「読めた事実」で判断する
- 回帰コメントは `<!-- error-triage:regression:{fp}:{YYYY-MM-DD} -->` マーカーで重複投稿を抑止する。
  マーカー探索は `since=closedAt` で絞る（issue comments API は古い順にしか返さず `sort` / `direction` を
  受け付けないため、ページ数で頭打ちにすると**最も古い 300 件**しか読めず、最新側にあるマーカーを取り逃がす）
- 起票が本当に失敗したらその run では起票を打ち切る（二次レート制限を引き当てない）
- `fpalgo` が既存 Issue と食い違ったら**1バイトも書かずに止める**（#1198 §8-A）

**sub-issue の紐付けは best-effort** です（レビュー §6-2）。起票は単一 POST で原子的に完了させ、
紐付けはその後。失敗しても run を落とさず、失敗件数を Job Summary へ出します。
**上限に近づいても古い sub-issue を親から自動 DELETE しません**（S11）。紐付けが不安定な状態で
付け外しを自動化すると reconcile と競合して振動します。`github.js` に DELETE は1本もありません。
`err/skip` の Issue は reconcile の対象外です（恒久無視と決めたものを親へぶら下げると、
自動 DELETE を禁じている以上、100 件のソフト上限枠を人手でしか回収できなくなるため）。

**書き込みを止める理由は2種類あり、止め方が違います。**

| 理由                     | 起票 / reopen / body 更新 | 親の常駐サマリ | 終了コード |
| ------------------------ | ------------------------- | -------------- | ---------- |
| `abort`（fpalgo 不一致） | **1バイトも書かない**     | 書かない       | 1          |
| `panic` / 契約違反       | 書かない                  | **書く**       | 1          |
| `--dry-run`              | 書かない                  | 書かない       | 0          |

`panic` / 契約違反で常駐サマリだけ残すのは、Job Summary が 90 日で消えるからです（G5）。
一番あとから振り返りたい run の記録だけが消える、という状態にしません。

**Issue 本文へ載せる `messagePattern` は、埋め込む直前にサニタイズします**（`sanitizeInlineText`）。
本番の任意のエラーメッセージ（サードパーティ API の文言も通る）を正規化しただけの値で、
`` ` `` / `|` / `<!-- -->` は正規化ルールが触りません。無escape で埋めると、
自動領域の終了マーカー注入で body が毎 run 膨張し、バックティックが閉じると `@ユーザー名` が
コードスパンの外へ出て**実在ユーザーへ通知が飛び**ます。
サニタイズは**表示直前だけ**で、`fingerprint` の計算入力には持ち込みません（持ち込むと突合が全部外れます）。

### 回し方

```bash
# BigQuery だけ見る（issues: read。突合しない）
gh workflow run error-triage.yml -f mode=plan -f lookback_hours=25
# 既存 Issue と突合するが1バイトも書かない（issues: read）
gh workflow run error-triage.yml -f mode=preview
# 起票する（issues: write）。日次 09:00 JST の schedule と同じ経路
gh workflow run error-triage.yml -f mode=apply
```

`plan` / `preview` Job は `issues: write` を持たないため、Issue の起票・reopen・コメントは
**権限レベルで不可能**です。`permissions:` は Job 単位でしか効かないので、フラグ方式（`--dry-run` だけ）に
頼らず Job を分けています。

ローカルでの確認:

```bash
GCP_PROJECT_ID=... BQ_ACCESS_TOKEN=... GITHUB_TOKEN=... GITHUB_REPOSITORY=Ayato-kosaka/nanitabeyo \
  node scripts/error-triage/main.js apply --dry-run --out /tmp/plan.json
```
