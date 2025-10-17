#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# setup_cloud_run_custom_domain.sh
# ------------------------------------------------------------------------------
# 目的:
#   - Cloud Run サービスにカスタムドメインを割り当て (api.nanitabeyo.net → Cloud Run)
#   - Google 管理の TLS 証明書を自動プロビジョニング
#   - 必要な DNS レコード（A/AAAA/CNAME/TXT 等）を表示
#   - 動作確認コマンドと .env（API_HOST / COOKIE_DOMAIN など）を出力
#
# 使い方:
#   chmod +x setup_cloud_run_custom_domain.sh
#   ./setup_cloud_run_custom_domain.sh <PROJECT_ID> <REGION> <SERVICE_NAME> <DOMAIN> [COOKIE_BASE_DOMAIN]
#
# 引数:
#   PROJECT_ID          : GCP プロジェクト ID（例: food-scroll）
#   REGION              : Cloud Run リージョン（例: asia-northeast1）
#   SERVICE_NAME        : Cloud Run サービス名（例: api-service）
#   DOMAIN              : 割り当てる FQDN（例: api.nanitabeyo.net）
#   COOKIE_BASE_DOMAIN  : Cookie のドメイン（省略時: .<DOMAIN の eTLD+1> → 例: .nanitabeyo.net）
#
# 前提:
#   - gcloud CLI ログイン済み（gcloud auth login / application-default いずれでも可）
#   - 実行ユーザーに Cloud Run / Project IAM / DNS 操作権限
#   - 指定サービス (SERVICE_NAME) が既にデプロイ済み
#
# 作成/操作する主なリソース:
#   - Cloud Run Domain Mapping（Google 管理 TLS）
#
# ベストプラクティス:
#   - set -euo pipefail
#   - 冪等性: 既存なら describe して DNS 案内のみ
# ------------------------------------------------------------------------------

set -euo pipefail

PROJECT_ID="${1:-}"
REGION="${2:-}"
SERVICE_NAME="${3:-}"
DOMAIN="${4:-}"
COOKIE_BASE_DOMAIN_INPUT="${5:-}"

if [[ -z "${PROJECT_ID}" || -z "${REGION}" || -z "${SERVICE_NAME}" || -z "${DOMAIN}" ]]; then
  echo "❌ 引数不足です。"
  echo "使い方: $0 <PROJECT_ID> <REGION> <SERVICE_NAME> <DOMAIN> [COOKIE_BASE_DOMAIN]"
  exit 1
fi

# eTLD+1 抽出（例: api.nanitabeyo.net → nanitabeyo.net）
# ざっくり: 最後の2ラベルを取り出す（企業ドメイン想定）。複雑なPublic Suffixは扱わない簡易版。
ETLD1="$(echo "${DOMAIN}" | awk -F. '{print $(NF-1)"."$NF}')"
COOKIE_BASE_DOMAIN="${COOKIE_BASE_DOMAIN_INPUT:-.${ETLD1}}"

echo "▶️  PROJECT_ID         : ${PROJECT_ID}"
echo "▶️  REGION             : ${REGION}"
echo "▶️  SERVICE_NAME       : ${SERVICE_NAME}"
echo "▶️  DOMAIN (to map)    : ${DOMAIN}"
echo "▶️  COOKIE_BASE_DOMAIN : ${COOKIE_BASE_DOMAIN}"
echo "────────────────────────────────────────────────────────"

gcloud config set project "${PROJECT_ID}" >/dev/null

# --- 0) 必要な API を有効化 ---------------------------------------------------
echo "🔧 Enabling APIs (idempotent)…"
gcloud services enable \
  run.googleapis.com \
  certificatemanager.googleapis.com \
  --quiet

# --- 1) Cloud Run サービス存在チェック ----------------------------------------
echo "🔎 Checking Cloud Run service existence…"
if ! gcloud run services describe "${SERVICE_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  echo "❌ Cloud Run サービス '${SERVICE_NAME}' が region='${REGION}' に見つかりません。先にデプロイしてください。"
  exit 1
fi

# --- 2) 既存ドメインマッピングの有無 ------------------------------------------
echo "🔎 Checking domain mapping…"
MAPPING_EXISTS="false"
if gcloud run domain-mappings describe --domain "${DOMAIN}" --region "${REGION}" >/dev/null 2>&1; then
  MAPPING_EXISTS="true"
fi

# --- 3) 作成 or 既存案内 ------------------------------------------------------
if [[ "${MAPPING_EXISTS}" == "true" ]]; then
  echo "ℹ️  Domain mapping already exists for ${DOMAIN}."
else
  echo "🔗 Creating domain mapping: ${DOMAIN} → ${SERVICE_NAME}"
  # Google 管理証明書が自動で発行・紐付けされます（DNS 設定が通れば自動で ACTIVE へ）
  gcloud run domain-mappings create \
    --service "${SERVICE_NAME}" \
    --domain "${DOMAIN}" \
    --region "${REGION}" \
    --quiet
fi

# --- 4) DNS レコードの案内 ----------------------------------------------------
echo "📡 Fetching required DNS records…"
# resourceRecords に必要な A/AAAA/CNAME/TXT などが並ぶ
DM_DESC="$(gcloud run domain-mappings describe --domain "${DOMAIN}" --region "${REGION}" --format='yaml(resourceRecords, status, certificate)')"

echo "────────────────────────────────────────────────────────"
echo "🧾 Domain Mapping status (for reference):"
echo "${DM_DESC}"
echo "────────────────────────────────────────────────────────"

# レコードだけ抜粋表示（見やすさ用）
echo "📌 追加・確認が必要な DNS レコード（抜粋）:"
gcloud run domain-mappings describe \
  --domain "${DOMAIN}" --region "${REGION}" \
  --format='table(resourceRecords.type, resourceRecords.name, resourceRecords.rrdata)'

echo "💡 上記を DNS に設定し、伝播後に証明書が ACTIVE になります。"

# --- 5) 確認コマンド ----------------------------------------------------------
echo ""
echo "🔎 確認コマンド（DNS 伝播・証明書アクティブ化後）:"
echo "  curl -sSI https://${DOMAIN}/ | sed -n '1,10p'"
echo "  gcloud run domain-mappings describe --domain ${DOMAIN} --region ${REGION} \\"
echo "    --format='value(certificate.state,certificate.routeName,status.resourceRecords)'"
echo ""

# --- 6) .env（アプリ向け）出力 ------------------------------------------------
#   API ホストと Cookie のベースドメインをアプリ側に共有
echo "🧩 .env に追加（アプリ用）:"
cat <<ENV
API_BASE_URL=https://${DOMAIN}
COOKIE_DOMAIN=${COOKIE_BASE_DOMAIN}
# 例: Set-Cookie: <name>=<val>; Domain=\${COOKIE_DOMAIN}; Path=/; Secure; HttpOnly; SameSite=None
ENV
echo ""

# --- 7) 補足メモ --------------------------------------------------------------
cat <<'MEMO'
📝 メモ:
- このドメインマッピングは Google 管理の TLS 証明書を自動発行します。
  DNS が正しく向いていれば、数分〜数十分で certificate.state=ACTIVE になります。
- 以降、API は https://<DOMAIN>/ で到達可能です。Set-Cookie の Domain を
  .<eTLD+1>（例: .nanitabeyo.net）にすれば、cdn.nanitabeyo.net へも Cookie が送信されます。
- ブラウザ/プレイヤー側は、資格情報付きでの取得を有効化してください:
  fetch(..., { credentials: 'include' }) / XHR.withCredentials = true / hls.js xhrSetup など。
- CORS を使う場合は、API 側で以下を返してください（ホワイトリストで出し分け）:
  Access-Control-Allow-Origin: https://app.<your-domain>
  Access-Control-Allow-Credentials: true
  Vary: Origin
MEMO
