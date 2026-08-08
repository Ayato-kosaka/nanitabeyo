# 日本の飲食店オープンデータ網羅性 POC（Issue #843）

日本全国の初期 restaurant seed 候補について、同じ定義で件数・欠損・重複を測り、現行DBのrestaurant CSVを全件照合する再実行可能なPOCです。本スクリプトはDBを更新しません。

詳細な調査、ライセンス評価、Google place ID・画像・レビュー方針は [REPORT.md](./REPORT.md) を参照してください。固定した取得元は [sources.lock.json](./sources.lock.json)、実測値は [poc_results_2026-08-08.json](./poc_results_2026-08-08.json) にあります。

## 結論

- 全国seedの第一候補は **Overture Maps Places**。2026-07-22.0の日本`food_and_drink`は789,612行で、名称・座標・住所を持ち、source横断dedupe済みです。
- **食品衛生申請等システム（IFAS）**は補完候補。ただし公開対象は電子申請かつ申請者が公開に同意したものだけで、全国網羅DBではありません。
- **OpenStreetMap**はODbLの下で営業時間・料理種別等を補完する候補。コア8業態199,798件で、全国seedの主軸には不足します。
- 行数は真の網羅率ではありません。採用条件は`--reference-csv`による**現行DB全件の100%照合**です。

## 実行

Python 3.11以上を想定します。

```bash
cd scripts/20260808T0000_restaurant/0000_open_data_poc
python -m venv .venv
.venv/bin/pip install -r requirements.txt

# 約627 MB。SHA-256を検証して保存
.venv/bin/python open_data_poc.py download-overture

# 公開ページの157自治体CSV、合計約359 MiB
.venv/bin/python open_data_poc.py download-ifas

.venv/bin/python open_data_poc.py analyze \
  --overture-parquet data/overture-asia.parquet \
  --ifas-dir data/ifas \
  --as-of 2026-08-08 \
  --output out/report.json
```

外部通信なしでsnapshotだけ再集計する場合は`--skip-osm`を付けます。取得元への負荷を避け、CIではdownloadを実行しないでください。

## 現行DBの100%網羅ゲート

次の列をUTF-8 CSVに書き出します。`google_place_id`は監査用に任意で含められますが、照合キーには使いません。

```csv
id,name,latitude,longitude,google_place_id
<restaurant UUID>,<現在の名称>,<緯度>,<経度>,<任意>
```

```bash
.venv/bin/python open_data_poc.py analyze \
  --overture-parquet data/overture-asia.parquet \
  --ifas-dir data/ifas \
  --reference-csv current_restaurants.csv \
  --skip-osm \
  --output out/current-db-coverage.json
```

出力:

- `out/current-db-coverage.json`: 総件数、採用可能match、曖昧、未照合、100% gate
- `out/reference-matching/reference_matches.csv`: source ID・距離・方式・confidence
- `out/reference-matching/unmatched_reference.csv`: 人手確認またはcarry-forwardが必要なもの

照合は名称をNFKC正規化し、100m以内の完全一致を優先、類似度0.88以上を候補にします。同順位候補が複数あると`ambiguous`になり、100% gateには数えません。これは候補抽出であり、自動的な同一店舗の断定ではありません。

## テスト

```bash
python -m unittest -v test_open_data_poc.py
```

ネットワークや大容量データなしで、正規化、IFAS有効判定、距離、曖昧match、100% gateを検証します。
