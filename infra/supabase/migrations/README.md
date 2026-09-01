# migrations — DB 変更の進め方

**このディレクトリを触る前に、必ずここを読むこと。**

このリポジトリの本番と開発は「別 DB」ではなく **同じ DB の別スキーマ**である
（本番 = `public` / 開発 = `dev` / `test`）。壊れやすく、壊れたときの影響が大きい。

前提となる仕組み（`db-migrate.yml` / `scripts/apply-migration.sh`）:

- DB 側に適用済み台帳（schema_migrations 的なテーブル）は**無い**。適用記録は
  `db-migrate.yml` の dispatch ログだけである
- 適用は「`from_file` 以降を**ファイル名昇順で毎回全部**流す」方式である

したがってこの運用の成立条件はただひとつ、**「ファイル名順 = 適用順」が崩れないこと**である。
以下の規則はすべてこの不変条件を守るためにある。

---

## 規則 1. migration は「migration だけの小 PR」を先に main へ（migration-first）

**実適用（`dry_run: false`）は main ブランチからしか実行できない**（`db-migrate.yml` が拒否する）。
機能ブランチから dev へ先行適用することは禁止。

> 2026-08 に、機能ブランチ（#1469）から dev へ先行適用した結果、dev の schema と
> 噛み合うコードがそのブランチにしか無くなり、**main から api-development を
> デプロイできない**事故が起きた。DB を先行させたブランチが「唯一のデプロイ可能
> ブランチ」になるのは構造の必然なので、運用で先回りして防ぐ。

進め方:

1. 親 Issue の下に **DB 変更だけのサブ Issue** を立て、承認を得る（規則 4 のフォーマット）
2. **migration ファイルだけの小 PR** を作って main へマージする
   （schema.prisma / Prisma Client は次の適用ステップで自動 commit されるので含めなくてよい）
3. main から `db-migrate.yml` を dispatch して dev へ適用する
   （`regenerate_prisma: true` なら introspect 結果が main へ自動 commit される）
4. 機能ブランチは main を取り込み、新しいスキーマを使うコードを書く

ブランチから許可されるのは `dry_run: true` のみ（適用対象と静的検査の事前確認用）。

## 規則 2. ファイル名の日付は「書いた日」ではなく「適用列に並ぶ順序」

新しい migration のファイル名は、**main にある全ファイルより辞書順で後ろ**でなければ
ならない。PR の CI（`migration-order-check.yml`）が機械検査する。

- マージが遅れて main の最後尾より前の名前になってしまったら、**マージ前にリネーム**する。
  public 未適用のファイルはリネームし放題である（ファイル名は DB のどこにも記録されない）
- 並行する複数 PR が同じタイムスタンプを名乗っていても、この規則でマージ順に直列化される

## 規則 3. migration は後方互換（additive）に限る

migration は「それを使うコードがまだ無い main」へ先にマージされ、DB はコードより
先へ進む。したがって**古いコードのまま動き続けられる変更**だけを流してよい。

- OK: テーブル追加・NULLABLE 列追加・インデックス追加・制約の緩和
- NG（そのままでは流せない）: 列削除・リネーム・NOT NULL 化など、既存コードを壊す変更
  → **expand / contract** に分ける:
  ① 新しい形を追加（expand）→ ② コードを移行してリリース → ③ 古い形を削除（contract）。
  ①と③は別々の migration・別々の承認になる

## 規則 4. 実適用は**勝手に流さない**（1 本ごとにオーナー承認）

`db-migrate.yml` を **dry run 以外で実行してよいのは、その変更についてオーナーの承認を得た後だけ**。

- 「前に流してよいと言われた」は**次の変更の承認にならない**。承認は migration 1 本ごと
- `target_schema: public` はもちろん、**`dev` でも同じ**である
- `public` への適用は**別の承認**。`confirm_public: true` は本番 DB を変更するスイッチなので、
  そのつど改めて承認を取る

サブ Issue に書くこと:

```markdown
## 変更するテーブル
dish_media_external_embeddings

## 適用先
dev（public はまだ未適用のテーブルなので、public への適用は別途）

## SQL
（実際に流す DDL をそのまま貼る）

## 既存データへの影響
NULLABLE 列の追加のみ。既存行は書き換わらない（テーブル rewrite なし）

## ロールバック
ALTER TABLE ... DROP COLUMN ...;

## なぜ必要か
（どの機能が、この列が無いと成立しないのか）
```

承認が下りたら `dry_run: true` で 1 回流し、対象ファイルと適用先スキーマをログで
確認してから実適用する。

## 規則 5. 本番未適用の migration は、新しいファイルを積まずに直接直す

`public` にまだ当たっていない migration は、この世に「その形で存在した DB」が無い。
そこへ ALTER を積むと履歴が «作って → すぐ足す» という嘘の経緯になり、

- 後から読んだ人が「なぜ 2 段階なのか」を無駄に考える
- ALTER で足す列は必ず NULLABLE になり、本当は NOT NULL にしたかった列が経緯だけの
  理由で NULLABLE のまま固定される

という実害が出る。**元のファイルを直接書き換える小 PR を main へ積むこと。**

直接書き換えるときに必ずやること: `apply-migration.sh` は from_file 以降を毎回全部
流すので、`CREATE TABLE IF NOT EXISTS` は既にテーブルがある環境ではスキップされる。
つまり CREATE TABLE を直しただけでは dev に反映されない。ファイル末尾の
「既存テーブルを現行仕様へ揃え直す」ブロックへも `ADD COLUMN IF NOT EXISTS` /
`DROP CONSTRAINT IF EXISTS` → `ADD CONSTRAINT` の形で同じ変更を書き、
**何度流しても同じ結果になる（冪等）**ようにすること。
`20260824T0200_create_dish_media_external_embeddings.sql` がその実例である。

## 規則 6. 本番適用済みの migration は**絶対に書き換えない**

`public` に当たったファイルを後から直すと、環境ごとに DB の形が違う状態を作る。
この場合だけ新しいファイルを積む。どちらなのかは下の手順で必ず確認すること。

---

## 適用状況の調べ方と現在地

`db-migrate.yml` の実行履歴で、ジョブ名が `public スキーマへ migration を適用` /
`dev スキーマへ migration を適用` の run のログを見る。`📄 Applying:` の行が実際に
当たったファイルである。

```
gh api repos/{owner}/{repo}/actions/workflows/db-migrate.yml/runs
```

> **2026-09-01 時点の現在地**
>
> - `public`: `20260828T0000_add_restaurants_address_country_and_links.sql` まで適用済み
>   （v1.14 リリース /
>   [run 33451203062](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/33451203062)）。
>   このとき `20260823T0000_...` 以降の 16 本をまとめて当てた
> - `dev`: `20260828T0000` まで適用済み
> - 次に `public` へ適用するときの `from_file` は、この行より後に足した最初のファイル
>
> ⚠️ **`CREATE INDEX CONCURRENTLY` を含む migration を当てたら、`indisvalid` を必ず確認する。**
> 失敗しても INVALID な索引が残るだけで run は成功し、`IF NOT EXISTS` が以後黙って
> スキップし続ける。確認は読み取り専用の
> `scripts/db-checks/assert_index_valid.py` を `db-script-run.yml` から流す
> （`--schema public --index <名前>`）。v1.14 では 6 本が対象だった

## 補足: 適用後にやること

- `regenerate_prisma: true` で流すと `schema.prisma` と Prisma Client が
  **実行ブランチ（= main）へ自動 commit・push される**。api のデプロイ
  （`api-deploy.yml`）はこのコミット済み schema からビルドする（デプロイ時に
  DB を introspect しない）ので、これが型の正本である
- `shared/supabase/database.types.ts` は **`db-migrate.yml` が自動で再生成し、同じ commit で
  push する**（#1575）。手で直す必要は無い
- **手で追従させるのは `shared/converters/` だけ**である（`shared/converters/README.md`）。
  列が増減したら、対応する `convert_<table>.ts` の両方向の関数へ反映する
- `db-migrate.yml` は push する前に `pnpm -F shared build` を実行して
  「Supabase 型の列集合 ≡ Prisma 型の列集合」を検算する。**落ちた場合は main へ push せず**、
  生成物を `chore/db-introspect-<from_file>` ブランチへ退避して run を失敗させる。
  その場合はそのブランチから PR を作り、converters を追従させてマージすること。
  DB だけが先行する状態になるが、規則 3（additive のみ）の範囲なので既存コードは動き続ける
- `CREATE INDEX CONCURRENTLY` を含む migration は、適用後に**索引が VALID か必ず確認する**。
  失敗しても INVALID な索引が残り、`IF NOT EXISTS` が以後ずっとスキップする。
  確認は `scripts/db-checks/assert_index_valid.py` を `db-script-run.yml` から流す
