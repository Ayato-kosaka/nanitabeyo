# migrations — DB 変更の進め方

**このディレクトリを触る前に、必ずここを読むこと。**

このリポジトリの本番と開発は「別 DB」ではなく **同じ DB の別スキーマ**である
（本番 = `public` / 開発 = `dev` / `test`）。壊れやすく、壊れたときの影響が大きい。

---

## 規則 1. DB 変更は**勝手に流さない**

`db-migrate.yml` を **dry run 以外で実行してよいのは、その変更についてオーナーの承認を得た後だけ**である。

- 「前に db-migrate を流してよいと言われた」は**次の変更の承認にならない**。
  承認は **migration 1 本ごと**に取ること
- `target_schema: public` はもちろん、**`dev` でも同じ**である。
  dev が migration ファイルと食い違うと、`regenerate_prisma`（`prisma db pull`）が
  食い違ったままの `schema.prisma` を commit して、そこから先の全員が巻き込まれる

### 承認の取り方: DB 変更は**サブ Issue を立てる**

コード変更の PR に DB 変更を混ぜて「ついでに流す」をしない。親 Issue の下に
**DB 変更だけのサブ Issue**を立て、そこで次を提示して承認を得る。

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

承認が下りたら `db-migrate.yml` を **`dry_run: true` で 1 回**流し、対象ファイルと
適用先スキーマをログで確認してから、実適用する。

---

## 規則 2. **本番未適用の migration は、新しいファイルを積まずに直接直す**

これがいちばん間違えやすい。

`public` にまだ当たっていない migration は、**この世に「その形で存在した DB」が無い**。
そこへ ALTER を積むと、履歴だけが «作って → すぐ足す» という嘘の経緯になり、

- 後から読んだ人が「なぜ 2 段階なのか」を無駄に考える
- ALTER で足す列は **必ず NULLABLE になる**（既存行を埋められないため）。
  本当は NOT NULL にしたかった列が、経緯だけの理由で NULLABLE のまま固定される

という実害が出る。**元の `CREATE TABLE` のファイルを直接書き換えること。**

### public にどこまで当たっているかの調べ方

`db-migrate.yml` の実行履歴で、ジョブ名が `public スキーマへ migration を適用` の
最新の run のログを見る。`📄 Applying:` の行が実際に当たったファイルである。

```
gh api repos/{owner}/{repo}/actions/workflows/db-migrate.yml/runs
```

> 2026-08-22 時点: `public` の最終適用は `20260807T0100_drop_share_links_created_by_fkey.sql`。
> **`20260819T0000` 以降は 1 本も当たっていない。**

### 直接書き換えるときに必ずやること

`scripts/apply-migration.sh` は `from_file` 以降を**毎回全部流す**ので、
`CREATE TABLE IF NOT EXISTS` は「既にテーブルがある環境」ではスキップされる。
つまり **`CREATE TABLE` を直しただけでは dev に反映されない。**

ファイル末尾の「既存テーブルを現行仕様へ揃え直す」ブロックへも
`ADD COLUMN IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS` → `ADD CONSTRAINT` の形で
同じ変更を書き、**何度流しても同じ結果になる（冪等）**ようにすること。
`20260819T0200_create_dish_media_external_embeddings.sql` がその実例である。

---

## 規則 3. 本番適用済みの migration は**絶対に書き換えない**

`public` に当たったファイルを後から直すと、環境ごとに DB の形が違う状態を作る。
この場合だけ新しいファイルを積む。どちらなのかは規則 2 の手順で必ず確認すること。

---

## 規則 4. `public` への適用は別の承認

`dev` への適用が承認されても、`public` は別である。`confirm_public: true` は
**本番 DB を変更するスイッチ**なので、そのつど改めて承認を取ること。

---

## 補足: 適用後にやること

- `regenerate_prisma: true` で流すと `schema.prisma` と Prisma Client が
  **自動 commit・push される**（`db-migrate.yml` が `git push origin HEAD:${GITHUB_REF_NAME}`）。
  自分のブランチに他人名義の commit が増えるので、驚かないこと
- `shared/supabase/database.types.ts` と `shared/converters/` は **手で追従させる**。
  自動生成は 2026-08-21 に廃止した（`shared/converters/README.md`）
- `CREATE INDEX CONCURRENTLY` を含む migration は、適用後に **索引が VALID か必ず確認する**。
  失敗しても INVALID な索引が残り、`IF NOT EXISTS` が以後ずっとスキップする。
  確認は `scripts/db-checks/assert_index_valid.py` を `db-script-run.yml` から流す
