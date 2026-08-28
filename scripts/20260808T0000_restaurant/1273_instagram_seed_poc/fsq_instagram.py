"""#1273 4.2 Foursquare OS Places の `instagram` 列から日本の飲食店の Instagram を数える。

FSQ OS Places は S3 の公開バケットから撤去され、Hugging Face 側が gated になった
（アクセスすると `401` / `x-error-code: GatedRepo`）。したがって**トークンが要る**。
ライセンスは Apache-2.0 のままなので規約上は使えるが、無記名では 1 バイトも取れない。

HF_TOKEN を環境変数で渡すこと。トークンはコミットしない。
"""
import json
import os
import sys
import time

import duckdb

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
RELEASE = sys.argv[1] if len(sys.argv) > 1 else "2026-08-11"
BASE = f"hf://datasets/foursquare/fsq-os-places/release/dt={RELEASE}/places/parquet"
N_FILES = 100

# FSQ のカテゴリは階層をラベル文字列で持つ。飲食は必ず "Dining and Drinking" で始まる。
DINING = "list_contains(list_transform(fsq_category_labels, x -> starts_with(x, 'Dining and Drinking')), true)"
OPEN = "(date_closed IS NULL OR date_closed = '')"
HAS_IG = "(instagram IS NOT NULL AND instagram <> '')"


def main():
    token = os.environ["HF_TOKEN"]
    c = duckdb.connect()
    c.execute("INSTALL httpfs; LOAD httpfs;")
    c.execute(f"CREATE SECRET hf (TYPE huggingface, TOKEN '{token}')")
    c.execute("SET preserve_insertion_order = false;")

    # 100ファイルを一括 glob で読むと Hugging Face が 429 を返す（実測: 84本目で停止）。
    # 1ファイルずつ、失敗したら待って積み直す。
    c.execute("SET threads = 4; SET http_retries = 8; SET http_retry_wait_ms = 3000;")
    c.execute("""CREATE TABLE jp (fsq_place_id VARCHAR, name VARCHAR, address VARCHAR,
        locality VARCHAR, region VARCHAR, latitude DOUBLE, longitude DOUBLE, tel VARCHAR,
        website VARCHAR, instagram VARCHAR, fsq_category_labels VARCHAR[],
        date_closed VARCHAR, date_refreshed VARCHAR, unresolved_flags VARCHAR[])""")
    for i in range(N_FILES):
        url = f"{BASE}/places_{i:06d}.parquet"
        for attempt in range(6):
            try:
                c.execute(f"""INSERT INTO jp SELECT fsq_place_id, name, address, locality, region,
                    latitude, longitude, tel, website, instagram, fsq_category_labels,
                    date_closed, date_refreshed, unresolved_flags
                    FROM read_parquet('{url}') WHERE country = 'JP'""")
                break
            except Exception as e:
                if attempt == 5:
                    raise
                wait = 15 * (attempt + 1)
                print(f"  {i}: {str(e)[:80]} -> retry in {wait}s", flush=True)
                time.sleep(wait)
        if i % 10 == 0:
            print(f"  {i+1}/{N_FILES} jp_rows={c.execute('SELECT count(*) FROM jp').fetchone()[0]}", flush=True)

    q = lambda s: c.execute(s).fetchone()[0]
    stats = {
        "release": RELEASE,
        "jp_places": q("SELECT count(*) FROM jp"),
        "jp_dining": q(f"SELECT count(*) FROM jp WHERE {DINING}"),
        "jp_dining_open": q(f"SELECT count(*) FROM jp WHERE {DINING} AND {OPEN}"),
        "jp_dining_open_with_instagram": q(f"SELECT count(*) FROM jp WHERE {DINING} AND {OPEN} AND {HAS_IG}"),
        "jp_dining_open_distinct_instagram": q(
            f"SELECT count(DISTINCT lower(trim(instagram))) FROM jp WHERE {DINING} AND {OPEN} AND {HAS_IG}"),
        "jp_all_with_instagram": q(f"SELECT count(*) FROM jp WHERE {HAS_IG}"),
        "jp_dining_open_with_website": q(
            f"SELECT count(*) FROM jp WHERE {DINING} AND {OPEN} AND website IS NOT NULL AND website <> ''"),
    }
    stats["jp_dining_open_instagram_pct"] = round(
        100.0 * stats["jp_dining_open_with_instagram"] / max(stats["jp_dining_open"], 1), 3)

    c.execute(f"""
      COPY (SELECT fsq_place_id, name, address, locality, region, latitude, longitude,
                   tel, website, lower(trim(instagram)) AS instagram_handle, fsq_category_labels
            FROM jp WHERE {DINING} AND {OPEN} AND {HAS_IG})
      TO '{OUT}/fsq_jp_dining_instagram.csv' (HEADER, DELIMITER ',')
    """)

    print(json.dumps(stats, indent=2, ensure_ascii=False))
    with open(f"{OUT}/fsq_instagram.json", "w") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
