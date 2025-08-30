# resolve_commons_url.py
# Wikimedia Commons の Special:FilePath や thumbnail URL を実体URL (upload.wikimedia.org) に変換するスクリプト
# - SPARQL から取得した image フィールドは Special:FilePath/... のことが多く、そのままでは Android のプリロードが 403 で失敗する
# - このスクリプトはファイル名を正規化 → MD5 ハッシュで2階層ディレクトリを生成 → 実体URLを組み立てる
# - 入力: dishes_xxx.csv（image_raw または image/image_title 列を含む）
# - 出力: image_url 列に実体URLを追加したCSV
#
# 設計思想:
# - SPARQL 側はシンプルに（タイムアウト防止）
# - URL解決はすべてオフラインで完結（MediaWikiのディレクトリ規則を忠実に再現）
# - 不整合（ファイル名無しや変換できないケース）は image_url を空にすることで安全に処理

import sys, csv, hashlib, urllib.parse, unicodedata, re
from typing import Optional

# --- URL からファイル名を抽出 ---
# Special:FilePath / upload.wikimedia.org / thumbnail など、形式が色々あるので正規表現で拾う
def extract_title(image_raw: str) -> Optional[str]:
    if not image_raw:
        return None
    s = image_raw.strip()
    # URLデコードして扱いやすく（%20 → 空白 など）
    u = urllib.parse.unquote(s)

    # 1) Special:FilePath/XXXX の形式
    m = re.search(r"Special:FilePath/([^?&#]+)", u, flags=re.IGNORECASE)
    if m:
        return m.group(1)

    # 2) upload.wikimedia.org の原寸画像: /wikipedia/commons/<d1>/<d2>/<FileName>
    m = re.search(r"/wikipedia/commons/[0-9a-f]/[0-9a-f]{2}/([^/?#]+)$", u)
    if m:
        return m.group(1)

    # 3) サムネイル (thumb) URL: /wikipedia/commons/thumb/<d1>/<d2>/<FileName>/<WIDTH>px-<FileName>
    # 元ファイル名は「/thumb/.../<FileName>/...」の <FileName>
    m = re.search(r"/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/([^/?#]+)/", u)
    if m:
        return m.group(1)

    # 4) 上記に当てはまらない場合 → URL末尾のファイル名っぽい部分を保険で拾う
    m = re.search(r"/([^/?#]+)$", u)
    if m:
        return m.group(1)

    return None

# --- MediaWikiファイル名の正規化 ---
# MediaWiki の規則に合わせて MD5 ハッシュ計算前に正規化を行う
# - 空白 → アンダースコア
# - Unicode正規化 (NFC)
# - 先頭文字を大文字化（MediaWiki既定）
def canonize_filename(title: str) -> Optional[str]:
    if not title:
        return None
    t = urllib.parse.unquote(title.strip())
    t = t.replace(" ", "_")                        # 空白 → アンダースコア
    t = unicodedata.normalize("NFC", t)            # Unicode正規化
    if t:
        t = t[:1].upper() + t[1:]                  # 先頭大文字化
    if "/" in t or "\\" in t:                      # パス文字を含む場合は不正とみなし除外
        return None
    return t

# --- 実体URLの合成 ---
# ファイル名を MD5 ハッシュ化し、先頭1文字/2文字でディレクトリを決定
# upload.wikimedia.org の規則: /<d1>/<d2>/<FileName>
def generate_commons_url_from_title(filename: str) -> Optional[str]:
    fn = canonize_filename(filename)
    if not fn:
        return None
    md5 = hashlib.md5(fn.encode("utf-8")).hexdigest()
    d1, d2 = md5[0], md5[0:2]
    enc = urllib.parse.quote(fn)                   # URLエンコード（日本語や特殊文字対応）
    return f"https://upload.wikimedia.org/wikipedia/commons/{d1}/{d2}/{enc}"

def main():
    if len(sys.argv) != 3:
        print("usage: resolve_commons_url.py input.csv output.csv", file=sys.stderr)
        sys.exit(1)
    input_csv, output_csv = sys.argv[1], sys.argv[2]
    processed = resolved = 0

    with open(input_csv, newline="", encoding="utf-8") as infile, \
         open(output_csv, "w", newline="", encoding="utf-8") as outfile:
        reader = csv.DictReader(infile)
        # 出力する列を固定（DBにインポートしやすい形）
        fieldnames_out = ["id","label_en","labels","image_url","origin","cuisine","tags"]
        writer = csv.DictWriter(outfile, fieldnames=fieldnames_out)
        writer.writeheader()

        for row in reader:
            processed += 1
            image_url = ""
            # image_raw があればそれを優先的に使う
            raw = (row.get("image_raw") or row.get("image") or "").strip()
            # ファイル名抽出（rawがあれば extract、無ければ image_title）
            title = extract_title(raw) if raw else (row.get("image_title") or "").strip()

            # ファイル名があれば実体URLに変換
            if title and title.upper() != "NULL":
                url = generate_commons_url_from_title(title)
                if url:
                    image_url = url
                    resolved += 1

            # 出力行を構築（空のときは '' を入れる）
            out = {
                "id": (row.get("id") or row.get("dish") or "").strip(),
                "label_en": (row.get("label_en") or row.get("labelEN") or "").strip(),
                "labels": (row.get("labels") or "{}").strip(),
                "image_url": image_url,
                "origin": (row.get("origin") or "").strip(),
                "cuisine": (row.get("cuisine") or "").strip(),
                "tags": (row.get("tags") or "").strip(),
            }
            writer.writerow(out)

    print(f"✅ Processed {processed} rows, resolved {resolved} image URLs", file=sys.stderr)

if __name__ == "__main__":
    main()
