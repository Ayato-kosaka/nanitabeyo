# #1273 フェーズA — 対話turn(MCP有り)で片付ける保留アクション

fired ループturnは MCP(BigQuery/GitHub) 不可・IG_TOKEN 失効のため以下は対話turn保留。

## GitHub (MCP)
- [ ] resolve 改修 PR を作成: branch `claude/resolve-prefill-place-id` → main。
      内容: prefill.googlePlaceId 追加（一意確定店の環境非依存キー）。CIで typecheck/jest 検証。
- [ ] Issue #1273 に【判断ログ 2026-08-30】を記録:
      resolve 単一頭脳 / dev-public 非依存キー(google_place_id) / catalog=parsed の ready 部分集合 /
      4テーブル定義 / 収集ルート3種(柱1/柱2/検索) / place_id は #1276 無料SKU。

## BigQuery (MCP)
- [x] dataset sns_seed + 4テーブル作成済み（対話turnで実施）
- [ ] sns_coverage にカテゴリ別ロールアップ投入: out/cov_cat_insert.sql（93行）
- [ ] sns_post_raw に 1800投稿投入: out/bqload/post_raw_*.sql（6バッチ, gitignore済み・要再生成）
      ※ ローカルBQ資格情報が無く load API 不可。MCP execute_sql でバッチ投入するか、
        資格情報が得られれば load_table_from_json に切替。

## トークン再供給が要るもの（オーナー）
- [ ] IG_TOKEN 再供給 → 374人全フィード harvest（外挿15〜22万→確定値）。
      scratchpad は揮発しセッション跨ぎで消失するため、.env ではなく都度供給が要る。
