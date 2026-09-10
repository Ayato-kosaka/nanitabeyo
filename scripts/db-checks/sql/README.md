# scripts/db-checks/sql — 計測対象の SQL（自動生成。手で書かない）

本番のコードが **実際に組み立てた SQL / 判定** をそのまま書き出したもの。
計測スクリプトはこのファイルを読んで測る（全体像は
[`../README.md`](../README.md) の図）。

| ファイル | 正本 | 読む側 |
| --- | --- | --- |
| `search_nearby_restaurants.*.sql` | `api/src/v1/restaurants/restaurants.repository.ts` | `measure_order_by_posts.py` |
| `opening_status.*.sql` | `api/src/v1/restaurants/restaurant-opening-status.ts` | `explain_opening_status.py` |
| `usable_dish_media_conditions.sql` | `api/src/v1/dish-media/usable-dish-media-filter.ts` | `dish_media_coverage_sql.py` |
| `dish_media_search.sql` | `api/src/v1/dish-media/dish-media.repository.ts`（`findDishMediaIds`） | `explain_dish_media_search.py` |

## なぜファイルにするのか

以前は計測スクリプトの中に SQL を写経していた。#1629 で
**「repository を直したのに写経が古いままで、同じ遅い数字が出て «直っていない» と
誤読しかけた」**事故が起きたので、写経をやめて 1 本を共有している。

それぞれ対応する jest が「このファイル == 本番の組み立て結果」を機械検査している。
ずれたら `pnpm --filter api exec jest` が赤くなる
（`restaurants.order-by-posts-plan.spec.ts` / `opening-status-sql.spec.ts` /
`usable-dish-media-filter.spec.snapshot.spec.ts`）。

## 更新のしかた

SQL を意図して変えたときだけ、次で書き出す（手編集はしない）。

```
UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest restaurants.order-by-posts-plan
UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest opening-status-sql
UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest usable-dish-media-filter.spec.snapshot
UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest dish-media-search-sql
```

バインド位置は半角疑問符で表現されている。**SQL のコメントに半角疑問符を書かないこと**
（プレースホルダと区別が付かず、計測スクリプトが値の位置をずらす）。
