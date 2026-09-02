# PostgreSQL 接続プール設定

## 背景

Prisma ORM 7 で `@prisma/adapter-pg` を使用する場合、接続プールは Prisma の内蔵Poolではなく `pg.Pool` が管理する。

`DATABASE_URL` に残っている次の旧Prisma向けパラメータは、`pg.Pool` の接続数・待機時間設定として扱わない。

- `connection_limit`
- `pool_timeout`
- `pgbouncer`

Issue #904 の初回対応ではURLパラメータを削除せず、接続方式も Supavisor session mode（5432）のままとする。URLの整理や transaction mode（6543）への切り替えは、prepared statementなどの互換性を別途確認してから実施する。

## 実効設定

API起動時に `api/src/core/config/env.ts` で検証し、`api/src/prisma/prisma.service.ts` から `pg.Pool` へ明示的に渡す。

| 環境変数                        |   初期値 |         許容範囲 | `pg.Pool` 設定            |
| ------------------------------- | -------: | ---------------: | ------------------------- |
| `DB_POOL_MAX`                   |      `1` |        `1`〜`10` | `max`                     |
| `DB_POOL_CONNECTION_TIMEOUT_MS` |  `60000` |  `1000`〜`60000` | `connectionTimeoutMillis` |
| `DB_POOL_IDLE_TIMEOUT_MS`       | `300000` | `1000`〜`300000` | `idleTimeoutMillis`       |
| `DB_POOL_MAX_LIFETIME_SECONDS`  |      `0` |      `0`〜`3600` | `maxLifetimeSeconds`      |

`DB_POOL_MAX_LIFETIME_SECONDS=0` は接続寿命による強制ローテーションを無効にする。変更する場合は、接続再生成の頻度とレイテンシを本番メトリクスで確認する。

## Cloud Runの最大接続数

Issue #898 の調査時点ではCloud Runの最大インスタンス数は8、DB上限は60接続だった。

初期値では理論最大接続数は次のとおり。

```text
8 instances × DB_POOL_MAX 1 = 8 connections
```

`DB_POOL_MAX` を変更するときは、アプリ以外の予約接続とSupabase内部サービスの利用枠を差し引き、全インスタンス合計がDB上限を超えないことを確認する。

## 観測項目

既存のPrometheusレジストリへ次のメトリクスを登録する。

- `pg_pool_total_connections`
- `pg_pool_idle_connections`
- `pg_pool_waiting_requests`
- `pg_pool_connection_errors_total{source="acquire"|"idle"}`
- `pg_pool_acquire_duration_milliseconds{status="success"|"error"}`

DBクエリ時間は既存の `prisma_query_duration_milliseconds` で計測する。

idle clientのエラーは `pool.on('error')` で捕捉し、接続数と待機数を含む `pg_pool` 構造化ログとしてCloud Loggingへ出力する。起動時には実効設定を `pg_pool_config` ログへ出力する。

## 調整手順

1. まず `DB_POOL_MAX=1` でエラー率、APIレイテンシ、接続取得待ち時間、`waiting_requests` を確認する。
2. 待機が継続し、DB側に十分な接続余力がある場合のみ `DB_POOL_MAX` を段階的に増やす。
3. 変更後はCloud Runの最大インスタンス数を掛けた理論最大接続数を再計算する。
4. 接続エラーやレイテンシが悪化した場合は直前の値へ戻す。
