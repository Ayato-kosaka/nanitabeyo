#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# create_play_submission_service_account.sh
# ------------------------------------------------------------------------------
# Google Play へのアプリ提出 (eas submit) および FCM v1 (Android Push 通知) 用の
# Service Account を作成し、JSON キーを Base64 で出力する支援スクリプト。
# 参考: create_api_dev_service_account.sh
#
# このスクリプトで自動化できるのは「GCP プロジェクト側の準備」までです。
# Google Play Console への招待 & 権限付与はブラウザ操作が必要なので手順を表示します。
#
# 機能:
#  1. 必要な API の有効化 (androidpublisher / iam / firebase)
#  2. Service Account 作成 (存在する場合はスキップ)
#  3. IAM ロール付与 (最小限 + オプションで FCM 用)
#  4. JSON キー作成 & Base64 出力 (CI/CD 変数登録などに活用)
#  5. Play Console / Expo (EAS) への次ステップ案内
#
# 付与ロール (デフォルト):
#   - roles/serviceusage.serviceUsageConsumer   (API 呼び出し前提)
#   - roles/storage.objectViewer               (Play Asset 配信等で参照が必要なケースを想定)
# オプション (--with-fcm) を指定した場合追加:
#   - roles/firebase.messagingAdmin            (FCM v1 送信用 / 最小権限に応じ調整可)
#
# Play Console 側で必要となる権限 (ブラウザで付与 / 自動付与不可):
#   - アカウント権限: 「アプリの作成と公開」等、内部テスト / 本番リリースに必要な権限
#   - もしくは対象アプリ個別のリリース / バージョン管理権限
# 詳細: https://docs.expo.dev/submit/android/service-accounts/
#
# 使い方:
#   chmod +x infra/gcp/create_play_submission_service_account.sh
#   ./infra/gcp/create_play_submission_service_account.sh <GCP_PROJECT_ID> [--name sa-name] [--with-fcm]
# 例:
#   ./infra/gcp/create_play_submission_service_account.sh my-project-123 --with-fcm
# ------------------------------------------------------------------------------
set -euo pipefail

# ----- Parse Args -------------------------------------------------------------
PROJECT_ID="${1:-${GOOGLE_CLOUD_PROJECT:-}}"
shift || true
SA_NAME="playstore-submit-sa"   # デフォルト SA 名
WITH_FCM=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      SA_NAME="$2"; shift 2;;
    --with-fcm)
      WITH_FCM=true; shift;;
    -h|--help)
      cat <<'USAGE'
Usage: create_play_submission_service_account.sh <GCP_PROJECT_ID> [--name <service-account-name>] [--with-fcm]

Options:
  --name <name>    作成する Service Account の名前 (default: playstore-submit-sa)
  --with-fcm       FCM v1 (Android Push) 用ロール roles/firebase.messagingAdmin を追加付与
  -h, --help       このヘルプを表示

出力:
  Base64 エンコードされた Service Account JSON キーを標準出力 (1 行) に表示します。
  CI/CD のシークレット変数登録などに利用してください。

後続 (手動) 手順サマリ:
  1. Google Play Console > ユーザーと権限 で当該 SA メールを招待
  2. 必要なアプリ権限 / アカウント権限を付与
  3. eas credentials -p android もしくは eas submit -p android でキーを登録
  4. Push 通知を共用する場合は Expo FCM 設定 (docs.expo.dev) を参照
USAGE
      exit 0;;
    *)
      echo "不明なオプション: $1" >&2; exit 1;;
  esac
done

if [[ -z "${PROJECT_ID}" ]]; then
  echo "❌ PROJECT_ID が指定されていません。"
  echo "   使い方: ./create_play_submission_service_account.sh <GCP_PROJECT_ID> [--with-fcm]"
  exit 1
fi

SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE="./${SA_NAME}-key.json"

cleanup() { rm -f "${KEY_FILE}" || true; }
trap cleanup EXIT

echo "▶️  プロジェクト: ${PROJECT_ID}"
echo "▶️  Service Account: ${SA_EMAIL}"
[[ "${WITH_FCM}" == true ]] && echo "▶️  FCM 用ロール: 付与予定"
echo "───────────────────────────────────────────────"

# ----- 1. Enable APIs --------------------------------------------------------
echo "🔧 Enabling required APIs (idempotent)…"
gcloud services enable \
  iam.googleapis.com \
  androidpublisher.googleapis.com \
  firebase.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# ----- 2. Create Service Account ---------------------------------------------
if ! gcloud iam service-accounts list \
  --project="${PROJECT_ID}" \
  --filter="email=${SA_EMAIL}" \
  --format="value(email)" | grep -q "${SA_EMAIL}"; then
  echo "✅ Creating Service Account…"
  gcloud iam service-accounts create "${SA_NAME}" \
    --description="Play Store submission & FCM (optional)" \
    --display-name="Play Submission & FCM" \
    --project="${PROJECT_ID}"
else
  echo "ℹ️  Service Account already exists. Skipping creation."
fi

# ----- 3. Bind Roles ---------------------------------------------------------
# 最小限ロール (プロジェクト側)。Play Console 権限は別途ブラウザで。 
BASE_ROLES=(
  roles/serviceusage.serviceUsageConsumer
  roles/storage.objectViewer
)
if [[ "${WITH_FCM}" == true ]]; then
  BASE_ROLES+=(roles/firebase.messagingAdmin)
fi

echo "🔗 Binding IAM Roles…"
for ROLE in "${BASE_ROLES[@]}"; do
  echo "  -> ${ROLE}"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --quiet >/dev/null
done

# ----- 4. Create JSON Key ----------------------------------------------------
# 既存キーをそのまま再利用したいケースもあるので毎回作成 (要回転時も便利)
if [[ -f "${KEY_FILE}" ]]; then rm -f "${KEY_FILE}"; fi

echo "🔑 Creating JSON Key…"
gcloud iam service-accounts keys create "${KEY_FILE}" \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --quiet

# ----- 5. Output Base64 ------------------------------------------------------
echo "📦 Base64 Encoded Key ↓"
base64 --wrap=0 "${KEY_FILE}"
echo

# ----- 6. Next Steps ---------------------------------------------------------
cat <<EONEXT
📘 次の手順 (手動):
  1. Google Play Console > ユーザーと権限 で ${SA_EMAIL} を招待
  2. 必要なアプリまたはアカウント権限を付与 (内部テスト / 本番リリース可)
  3. (FCM 利用時) Expo Push 用として同じキーを登録: https://docs.expo.dev/push-notifications/fcm-credentials/
  4. eas submit -p android または eas build --profile production などを実行

🔒 セキュリティ:
  - 使い終わったら不要な古いキーは GCP Console で無効化 / 削除 (ローテーション)
  - CI/CD には上記 Base64 をシークレット環境変数 GOOGLE_SERVICE_ACCOUNT_KEY などで保存
EONEXT

echo "🎉 Done."
