# Cloud Logging Investigation Notes

Cloud Run の直近ログを、低コストかつ小さい結果集合で調査するための共通手順。

調査前に読む:

- `access.md`: 環境と実行方法
- `safety-policy.md`: 読み取り・個人情報・結果量の規則
- `field-mapping.md`: nanitabeyo の構造化ログと時刻の意味
- `query-patterns.md`: 承認済みの検索パターン

基本方針は **Cloud Logging first, BigQuery fallback**。

- 直近の個別障害、request ID、user ID、Cloud Run HTTP/system logはCloud Loggingを使う。
- 保持期間外、長期集計、複雑なJOIN、legacyログとの横断はBigQueryを使う。
- Cloud Loggingで0件でも「事象なし」と断定しない。保持期間・取り込み遅延・filterを確認し、必要ならBigQueryへ切り替える。
