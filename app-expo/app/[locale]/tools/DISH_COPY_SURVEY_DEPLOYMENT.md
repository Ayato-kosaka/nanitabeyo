# 料理コピー調査アンケート - CDNデータ配置手順

## 概要

`/app-expo/app/[locale]/tools/dish-copy-survey.tsx` で使用する料理データJSONをGoogle Cloud Storageに配置する手順です。

## データ形式

JSONファイルは以下の形式で10件の料理データを含みます：

```json
[
  {
    "qid": "dish_001",
    "label": "唐揚げ",
    "image": "https://upload.wikimedia.org/wikipedia/commons/e/e6/Chicken_karaage_003.jpg",
    "candidates": [
      {
        "type": "A",
        "title": "ジューシーな唐揚げ",
        "tagline": "外はカリッと、中はジューシー。一口で幸せが広がる"
      },
      {
        "type": "B",
        "title": "黄金の唐揚げ",
        "tagline": "香ばしい衣と肉汁の絶妙なハーモニー"
      },
      {
        "type": "C",
        "title": "至福の唐揚げ",
        "tagline": "熱々を頬張る瞬間、心まで温まる"
      }
    ]
  }
  // ... 他9件
]
```

## GCS配置手順

### 1. サンプルデータの準備

サンプルデータは `/tmp/dish-copy-survey-data.json` に作成済みです。

### 2. GCSバケットへアップロード

```bash
# GCS_BUCKET_NAME は api/.env で定義されているバケット名
# 本番環境の場合は nanitabeyo-static などを使用

gsutil cp /tmp/dish-copy-survey-data.json gs://nanitabeyo-static/dish-copy-survey-data.json

# 公開アクセスを許可
gsutil acl ch -u AllUsers:R gs://nanitabeyo-static/dish-copy-survey-data.json

# キャッシュ制御ヘッダーを設定（1時間キャッシュ）
gsutil setmeta -h "Cache-Control:public, max-age=3600" gs://nanitabeyo-static/dish-copy-survey-data.json
```

### 3. アクセス確認

```bash
# URLでアクセス可能か確認
curl https://storage.googleapis.com/nanitabeyo-static/dish-copy-survey-data.json
```

## データ更新時の注意

- データを更新する場合は、同じ手順でファイルを上書きアップロードしてください
- キャッシュがあるため、即座に反映されない可能性があります
- キャッシュをクリアしたい場合は `Cache-Control:no-cache` を設定してください

## トラブルシューティング

### CORSエラーが発生する場合

GCSバケットにCORS設定を追加してください：

```bash
# cors-config.json を作成
cat > cors-config.json << EOF
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF

# CORS設定を適用
gsutil cors set cors-config.json gs://nanitabeyo-static
```

### アクセス権限エラーが発生する場合

バケットの権限設定を確認してください：

```bash
# バケットの権限を確認
gsutil iam get gs://nanitabeyo-static

# 必要に応じてStorage Object Viewer権限を追加
```

## 本番データへの置き換え

サンプルデータは仮のデータです。本番運用時には以下の手順で実際のデータに置き換えてください：

1. 実際の料理データ（10件）を準備
2. 各料理に対して適切な画像URLを設定
3. 候補コピー（A/B/C）を作成
4. JSONファイルを生成
5. 上記手順に従ってGCSにアップロード

## セキュリティ考慮事項

- このJSONは公開データとして扱われます
- 機密情報や個人情報を含めないでください
- 画像URLは公開アクセス可能なURLを使用してください
