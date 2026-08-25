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
このディレクトリを丸ごと生成していた。**この仕組みは廃止した**（生成器は #1575 で削除済み）。
理由は 3 つ。

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

`db-migrate.yml` を流すと、`schema.prisma` と `shared/supabase/database.types.ts` は
**どちらも自動で**更新される（#1575。あちらが `supabase gen types` まで実行する）。

**手で追従させるのはこのディレクトリだけである。**

`shared/converters/convert_<table>.ts` の**両方向の関数へ**列の増減を反映する。
変換規則は上表のとおり。

**この追従を忘れると main の `shared` ビルドが赤くなり、claude worker が step 6
「sharedパッケージをビルド」で全滅する**（2026-08-24 に実測。Claude が起動する前に
落ちるので「Claude が出力しなかった」ようにしか見えない）。api-deploy がしばらく
走っていないと誰も気づかないまま数時間進むので、**migration を流したその日のうちに
ここを通すこと**。

そのうえで次を通すこと。`shared` の `tsc` が「Supabase 型と Prisma 型の食い違い」を
そのまま検出するので、**ここが実質の検査になる**。

```
pnpm --filter shared build
pnpm --filter api typecheck
```

`db-migrate.yml` は push する前に `pnpm -F shared build` を自分で実行する。
落ちた場合は main へ push せず、生成物を `chore/db-introspect-<from_file>` ブランチへ
退避して run を失敗させる。**その退避ブランチで converters を追従させ、PR を出すこと。**

## 新しいテーブルを足したとき

converter は「そのテーブルを Supabase 経由で運ぶ」場合にだけ要る。
API サーバの内部だけで完結するテーブル（例: `dish_media_external_embeddings`）は
Prisma から直接読み書きするので、**converter を作る必要は無い**。
必要になってから、既存ファイルをひな形にして手で書くこと。

## `docs/detailed_design/*.csv` について

`T_COLUMNS.csv` などは、廃止した生成スクリプトがスプレッドシートから書き出していたもの。
**いまは更新されない凍結スナップショット**である。現在の列定義を知りたいときは
`shared/prisma/schema.prisma`（実 DB の introspect 結果）を見ること。
