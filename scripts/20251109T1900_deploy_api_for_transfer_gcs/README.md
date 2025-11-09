# 20251109T1900_deploy_api_for_transfer_gcs

GCS **新バケット移行**のための実行ラッパ群です。`infra/gcp/*.sh` を呼び出し、

- 冪等性
- 詳細ログ
- DRY_RUN 対応
- 失敗時の安全性（`set -Eeuo pipefail` + `trap`）

を標準化します。

---

## 内容物

```
./scripts/20251109T1900_deploy_api_for_transfer_gcs/
  ├── 1_1_create_private_bucket.sh
  ├── 1_2_create_public_bucket.sh
  ├── 3_1_setup_public_cdn.sh
  ├── 4_1_transfer_gcs_develop.sh
  ├── 4_2_setup_private_cdn.sh
  ├── 5_1_db_migration_prod.sh
  ├── 6_setup_cloud_run_custom_domain_production.sh
  ├── 7_2_transfer_gcs_production.sh
  ├── common.sh
  ├── .env.common
  ├── .env.develop
  ├── .env.production
  └── README.md
```

> 既存の以下のスクリプトを **前提** とします：
>
> - `./infra/gcp/create-gcs-bucket.sh`
> - `./infra/gcp/create-gcs-cors.sh`
> - `./infra/gcp/setup_cdn_signed_cookies_and_lb.sh`
> - `./infra/gcp/transfer_gcs_bucket_prefix.sh`
> - `./infra/gcp/setup_cloud_run_custom_domain.sh`

---

## 使い方（基本）

1. ルートに `infra/gcp/*.sh` が存在することを確認
2. `.env.common` を確認（本テンプレートはご指定値を反映済み）
3. 必要に応じて `DRY_RUN=true` を付けてコマンドを試走（**推奨**）

例：

```bash
cd ./scripts/migration/20251109T1900_deploy_api_for_transfer_gcs

# 1. バケット作成（private / public）
DRY_RUN=true ./1_1_create_private_bucket.sh
DRY_RUN=true ./1_2_create_public_bucket.sh

# 実行
./1_1_create_private_bucket.sh
./1_2_create_public_bucket.sh

# 3. Public CDN の作成
./3_1_setup_public_cdn.sh

# 4. develop 先行移行（旧 private -> 新 private）
./4_1_transfer_gcs_develop.sh

# 4. private CDN（cdn.nanitabeyo.net）再作成（旧LBはベストエフォートで削除）
./4_2_setup_private_cdn.sh

# 5. 本番 DB マイグレーション
./5_1_db_migration_prod.sh

# 6. 本番 Cloud Run のカスタムドメイン
./6_setup_cloud_run_custom_domain_production.sh

# 7. 本番 prefix 転送
./7_2_transfer_gcs_production.sh
```

> DNSは **後で** 新LB/証明書に向けてください。
>
> - `cdn-public.nanitabeyo.net`：未設定 → LB発行後に向ける
> - `cdn.nanitabeyo.net`：旧A(34.8.77.138) → 新LBへ差し替え
> - `api.nanitabeyo.net`：未設定 → Cloud Run へ向ける

---

## スクリプトの役割

- `1_1_create_private_bucket.sh`  
  新 private バケットを作成し、CORS（デフォルト `*`）を適用

- `1_2_create_public_bucket.sh`  
  新 public バケットを作成し、CORS（デフォルト `*`）を適用

- `3_1_setup_public_cdn.sh`  
  `cdn-public.nanitabeyo.net` を **新 public バケット** に向けて、Signed Cookies 対応で作成  
  TTL は **infra デフォルト**

- `4_1_transfer_gcs_develop.sh`  
  旧 private（`food-scroll.firebasestorage.app`）→ 新 private へ `development/` プレフィックスのみ転送

- `4_2_setup_private_cdn.sh`  
  旧 `cdn.nanitabeyo.net` LB を **ベストエフォート削除**（指定3リソース名）後、
  同ホスト名で **新 private バケット** をオリジンに Signed Cookies 対応で再作成  
  TTL は **infra デフォルト**

- `5_1_db_migration_prod.sh`  
  プロジェクトルートで `pnpm run db:migration 20250924T1200_alter_users_add_fk_and_rls.sql` を実行し、本番 DB を更新

- `6_setup_cloud_run_custom_domain_production.sh`  
  Cloud Run サービス `api-production`（`asia-northeast1`）へ `api.nanitabeyo.net` を割当

- `7_2_transfer_gcs_production.sh`  
  旧 private → 新 private へ `production/` プレフィックスを転送

---

## 事前条件

- gcloud CLI ログイン済み
- `gcloud config set project food-scroll` が可能
- 実行ユーザーに GCS / LB / CDN / Cloud Run の必要権限があること

---

## ロールバック/安全策メモ

- バケット転送は **上書き** 動作（スクリプト側で対応済）  
  旧→新の**コピー**のみで、旧資産は削除しません
- CDN の切替後に想定外があれば、DNS を旧IPへ戻すことで一時回避可能（旧LBを既に削除した場合は不可）
- メンテナンスモードは **アプリ側で手動**（本スクリプトでは切替しません）

---

## トラブルシュート

- `Missing required env`：`.env.common` の該当変数が空でないか確認
- `gcloud not found`：Cloud SDK をインストール
- `Permission denied`：ファイルに実行権限を付与 `chmod +x *.sh`
- 旧LBの削除に失敗：リソース名が異なる可能性。`gcloud compute url-maps list` 等で名称を確認のうえ手動対応してください。
