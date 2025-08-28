#!/usr/bin/env python3
"""
resolve_commons_url.py

Wikimedia Commons の Special:FilePath から実体 URL (upload.wikimedia.org) への変換

使用方法:
  python3 resolve_commons_url.py input.csv output.csv

入力 CSV の image_title 列からファイル名を読み取り、
MD5 ハッシュを用いて upload.wikimedia.org の実体 URL を生成し、
image_url 列に設定して出力する。
"""

import sys
import csv
import hashlib
import urllib.parse
from typing import Optional


def generate_commons_url(filename: str) -> Optional[str]:
    """
    Wikimedia Commons のファイル名から実体 URL を生成
    
    Args:
        filename: ファイル名 (例: "Sushi.jpg")
        
    Returns:
        実体 URL (例: "https://upload.wikimedia.org/wikipedia/commons/4/4f/Sushi.jpg")
        ファイル名が空の場合は None
    """
    if not filename or filename.strip() == "":
        return None
    
    # URL デコード（%20 -> スペースなど）
    filename = urllib.parse.unquote(filename.strip())
    
    # MD5 ハッシュ計算
    md5_hash = hashlib.md5(filename.encode('utf-8')).hexdigest()
    
    # MD5 の最初の2文字で2層のディレクトリ構造を作る
    dir1 = md5_hash[0]
    dir2 = md5_hash[0:2]
    
    # URL エンコード（スペース -> %20など）
    encoded_filename = urllib.parse.quote(filename)
    
    # 実体 URL を組み立て
    url = f"https://upload.wikimedia.org/wikipedia/commons/{dir1}/{dir2}/{encoded_filename}"
    
    return url


def main():
    if len(sys.argv) != 3:
        print("usage: resolve_commons_url.py input.csv output.csv", file=sys.stderr)
        sys.exit(1)
    
    input_csv = sys.argv[1]
    output_csv = sys.argv[2]
    
    processed_count = 0
    resolved_count = 0
    
    with open(input_csv, 'r', newline='', encoding='utf-8') as infile, \
         open(output_csv, 'w', newline='', encoding='utf-8') as outfile:
        
        reader = csv.DictReader(infile)
        
        # 入力CSV のヘッダーをベースに、image_url 列を追加
        fieldnames = list(reader.fieldnames)
        if 'image_url' not in fieldnames:
            fieldnames.append('image_url')
        
        writer = csv.DictWriter(outfile, fieldnames=fieldnames)
        writer.writeheader()
        
        for row in reader:
            processed_count += 1
            
            # image_title から実体 URL を生成
            image_title = row.get('image_title', '').strip()
            
            if image_title and image_title not in ['', 'NULL']:
                image_url = generate_commons_url(image_title)
                row['image_url'] = image_url or ''
                if image_url:
                    resolved_count += 1
            else:
                row['image_url'] = ''
            
            writer.writerow(row)
    
    print(f"✅ Processed {processed_count} rows, resolved {resolved_count} image URLs", file=sys.stderr)


if __name__ == '__main__':
    main()