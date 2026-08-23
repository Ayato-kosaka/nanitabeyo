# converters — Supabase 型 ⇄ Prisma 型の変換

**このディレクトリのファイルは手書きです。生成しません。**

## 何をするものか

同じテーブルに対して 2 つの型が存在するので、その間を橋渡しする。

| 型 | 出どころ | 特徴 |
| --- | --- | --- |
| `SupabaseXxx` = `TableRow<'xxx'>` | `shared/supabase/database.types.ts` | API 通信で運ぶ形。日付は **ISO 文字列**、`numeric` は文字列 |
| `PrismaXxx` | `shared/prisma`（`prisma db pull` の生成物） | アプリ内部で扱う形。日付は **`Date`**、`numeric` は `Decimal` |

変換規則はこれだけである。

- 日付型（`timestamptz` など）… Supabase→Prisma は `new Date(v)`、Prisma→Supabase は `v?.toISOString() ?? null`
- 高精度数値（`numeric` / `decimal`）… `Number(v)` / `String(v)`
- それ以外 … そのまま通す

## 2026-08-21 以前は自動生成だった（もうやらない）

`pnpm generate:converters` が Google スプレッドシート（GAS WebAPI）から列定義を取り、
このディレクトリを丸ごと生成していた。**この仕組みは廃止した。** 理由は 3 つ。

1. **スプレッドシートは二次情報になった。** `schema.prisma` は `db-migrate.yml` の
   `regenerate_prisma` が `prisma db pull` で **実 DB から** introspect している。
   DB が真実であり、列定義を別途スプレッドシートに書くのは二重管理で、
   ズレても誰も気づけない
2. **実際にズレて事故った。** #1395 で `dish_media.render_type` を足し
   `media_path` / `dish_reviews.created_dish_media_id` を nullable 化したとき、
   `schema.prisma` だけが実 DB に追いつき、スプレッドシート由来の
   `database.types.ts` が取り残されて型エラーが 8 件出た
3. **新しいテーブルほど困る。** スプレッドシートに行が無いテーブル
   （`dish_media_external_embeddings` など）は、そもそも生成できない

## DB を変えたときにやること

`db-migrate.yml` を流すと `schema.prisma` は**自動で**更新される。
**手で追従させるのは次の 2 つ。**

1. **`shared/supabase/database.types.ts`** — `Row` / `Insert` / `Update` の 3 箇所を直す
   - nullable な列は `string | null`。`Insert` / `Update` では `?:` にする
   - `DEFAULT` を持つ NOT NULL の列は、`Insert` では `?:` にする（値を省略できるため）
2. **`shared/converters/convert_<table>.ts`** — 列の増減を両方向の関数へ反映する

そのうえで次を通すこと。`shared` の `tsc` が「Supabase 型と Prisma 型の食い違い」を
そのまま検出するので、**ここが実質の検査になる**。

```
pnpm --filter shared build
pnpm --filter api typecheck
```

## 新しいテーブルを足したとき

converter は「そのテーブルを Supabase 経由で運ぶ」場合にだけ要る。
API サーバの内部だけで完結するテーブル（例: `dish_media_external_embeddings`）は
Prisma から直接読み書きするので、**converter を作る必要は無い**。
必要になってから、既存ファイルをひな形にして手で書くこと。

## `docs/detailed_design/*.csv` について

`T_COLUMNS.csv` などは、廃止した生成スクリプトがスプレッドシートから書き出していたもの。
**いまは更新されない凍結スナップショット**である。現在の列定義を知りたいときは
`shared/prisma/schema.prisma`（実 DB の introspect 結果）を見ること。
