# 日本の飲食店オープンデータ網羅性 POC（Issue #843 / #1261）

日本全国の初期 restaurant seed 候補について、同じ定義で件数・欠損・重複を測り、現行DBのrestaurant CSVを全件照合する再実行可能なPOCです。本スクリプトはDBを更新しません。

詳細な調査、ライセンス評価、Google place ID・画像・レビュー方針は [REPORT.md](./REPORT.md) を参照してください。Issue #1261 の現行DB実測とNo-Go判定は [ISSUE_1261.md](./ISSUE_1261.md)、機械可読値は [issue_1261_results_2026-08-10.json](./issue_1261_results_2026-08-10.json) にあります。固定した取得元は [sources.lock.json](./sources.lock.json)、初回実測値は [poc_results_2026-08-08.json](./poc_results_2026-08-08.json) にあります。

## 結論

- 全国seedの第一候補は **Overture Maps Places**。2026-07-22.0の日本`food_and_drink`は789,612行で、名称・座標・住所を持ち、source横断dedupe済みです。
- **食品衛生申請等システム（IFAS）**は補完候補。ただし公開対象は電子申請かつ申請者が公開に同意したものだけで、全国網羅DBではありません。
- **OpenStreetMap**はODbLの下で営業時間・料理種別等を補完する候補。コア8業態199,798件で、全国seedの主軸には不足します。
- 行数は真の網羅率ではありません。採用条件は`--reference-csv`による**現行DB全件の100%照合**です。
- Issue #1261 の判定では、閉店を除いた既存需要カバー率95%以上を合格とします。未一致は `seed_missing` / `matching_failure` / `closed` の3分類でレビューします。

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

### 旧法期の自治体CSVを追加する

自治体ごとに列名・encoding・license・snapshotが異なるため、自動推測はしません。[`legacy_sources.example.json`](./legacy_sources.example.json) をコピーし、取得元ごとの mapping を明示します。公開CSVに緯度経度がない場合は、住所をジオコーディングした派生CSVを `data/legacy/` に置き、原典URL・license・snapshotをmanifestへ残してください。

```bash
.venv/bin/python open_data_poc.py analyze \
  --overture-parquet data/overture-asia.parquet \
  --ifas-dir data/ifas \
  --legacy-csv-manifest legacy_sources.json \
  --skip-osm \
  --output out/with-legacy-permits.json
```

出力には、IFASと旧法期CSVそれぞれについて L0（従来正規化完全一致）、L1（NFKC・法人格/店種別語・異体字）、L2（150m block + pg_trgm互換trigram）の累積一致率が入ります。Overtureは名称類似+50mクラスタリング後のユニーク件数と、website/socialの単独・組合せ充足率も集計します。

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

最初の実行で `out/reference-matching/unmatched_review_sample.csv` が決定的samplingで生成されます。`classification` を3分類のいずれかで埋めた後、全未一致をレビューしたCSVを指定して95% gateを確定します。

```bash
.venv/bin/python open_data_poc.py analyze \
  --overture-parquet data/overture-asia.parquet \
  --ifas-dir data/ifas \
  --reference-csv data/reference/current_restaurants.csv \
  --reviewed-unmatched-csv out/reference-matching/reviewed_unmatched.csv \
  --skip-osm \
  --output out/current-db-coverage-reviewed.json
```

出力:

- `out/current-db-coverage.json`: 総件数、採用可能match、曖昧、未照合、100% gate
- `out/reference-matching/reference_matches.csv`: source ID・距離・方式・confidence
- `out/reference-matching/unmatched_reference.csv`: 人手確認またはcarry-forwardが必要な全件
- `out/reference-matching/unmatched_review_sample.csv`: 目視3分類用の再現可能な最大100件sample

照合は完全一致を最優先し、次にL1正規化一致、最後に150m以内のtrigram類似度0.6以上を候補にします。50m以内の同名cross-source候補は相互裏付けとして扱い、離れた同順位候補は`ambiguous`にします。これは候補抽出であり、自動的な同一店舗の断定ではありません。

## テスト

```bash
python -m unittest -v test_open_data_poc.py
```

ネットワークや大容量データなしで、L1/住所/trigram正規化、IFAS有効判定、旧法CSV mapping、距離、重複cluster、曖昧match、100%/95% gateを検証します。
