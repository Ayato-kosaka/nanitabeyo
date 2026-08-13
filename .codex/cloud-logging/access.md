# Cloud Logging Access

## Environment

```bash
export PATH=/home/ubuntu/.local/google-cloud-sdk/bin:$PATH
```

- GCP project: `food-scroll`
- development service: `api-development`
- production service: `api-production`
- primary resource type: `cloud_run_revision`

production調査を明示的に依頼された場合だけ `api-production` を読む。APIの開発・検証では `api-development` を使う。

## Command shape

```bash
gcloud logging read '
  resource.type="cloud_run_revision"
  AND resource.labels.service_name="api-production"
  AND timestamp>="{FROM_ISO8601}"
  AND timestamp<="{TO_ISO8601}"
' \
  --project=food-scroll \
  --order=asc \
  --limit=100 \
  --format=json
```

最初からファイルへ大量出力しない。まず `--limit=20`〜`100` でshapeを確認し、必要な場合だけ上限を増やす。

## Payload decoding

nanitabeyoの `jsonPayload.payload`、`request_payload`、`response_payload` は、Cloud Logging上ではJSON文字列であることが多い。取得後に必要な行だけ `fromjson?` で展開する。

```bash
jq -r '.[] |
  (.jsonPayload.payload | fromjson? // {}) as $payload |
  [.timestamp, .jsonPayload.event_name, ($payload.error // "")] |
  @tsv'
```

`fromjson` ではなく `fromjson?` を使い、文字列でない旧ログや壊れたpayloadで調査全体を止めない。
