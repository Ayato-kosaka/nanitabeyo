# scripts/db-checks/sql — 計測対象の SQL（自動生成。手で書かない）

`api/src/v1/restaurants/restaurants.repository.ts` が **実際に組み立てた SQL** をそのまま
書き出したもの。`scripts/db-checks/measure_order_by_posts.py` はこのファイルを読んで測る。

## なぜファイルにするのか

以前は計測スクリプトの中に SQL を写経していた。#1629 で
**「repository を直したのに写経が古いままで、同じ遅い数字が出て «直っていない» と
誤読しかけた」**事故が起きたので、写経をやめて 1 本を共有している。

`api/src/v1/restaurants/restaurants.order-by-posts-plan.spec.ts` が
「このファイル == repository の組み立て結果」を機械検査している。ずれたら
`pnpm --filter api exec jest` が赤くなる。

## 更新のしかた

SQL を意図して変えたときだけ、次で書き出す（手編集はしない）。

```
UPDATE_RESTAURANT_SQL_SNAPSHOT=1 pnpm --filter api exec jest restaurants.order-by-posts-plan
```

バインド位置は半角疑問符で表現されている。**SQL のコメントに半角疑問符を書かないこと**
（プレースホルダと区別が付かず、計測スクリプトが値の位置をずらす）。
