"""seed CSV から決定的に一様標本を取る。

seed_id のハッシュ上位16bitがしきい値未満の行だけ拾う。CSV の並び順に依存しない
ので、Overture と IFAS が seed_id 順に固まっていても偏らない。母集団の件数が
分かっていればしきい値は一意に決まるので、2パス読む。
"""
import argparse, csv, hashlib, sys
from pathlib import Path
csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

p = argparse.ArgumentParser()
p.add_argument("--seeds", type=Path, required=True)
p.add_argument("--output", type=Path, required=True)
p.add_argument("--size", type=int, default=2500)
p.add_argument("--prefix", default="")
p.add_argument("--exclude-prefix", default="")
a = p.parse_args()

def keep(sid):
    if a.prefix and not sid.startswith(a.prefix): return False
    if a.exclude_prefix and sid.startswith(a.exclude_prefix): return False
    return True

def score(sid):
    return int(hashlib.sha256(sid.encode()).hexdigest()[:12], 16)

MAX = 16 ** 12
population = 0
with a.seeds.open(encoding="utf-8", newline="") as s:
    for row in csv.DictReader(s):
        population += keep(row["seed_id"])
# 少し多めに取ってから切る。ハッシュの揺らぎで size を下回らないようにする。
threshold = min(MAX, int(MAX * a.size / max(population, 1) * 1.15) + 1)

rows = []
with a.seeds.open(encoding="utf-8", newline="") as s:
    reader = csv.DictReader(s)
    fields = reader.fieldnames
    for row in reader:
        if keep(row["seed_id"]) and score(row["seed_id"]) < threshold:
            rows.append(row)
rows.sort(key=lambda r: score(r["seed_id"]))
rows = rows[: a.size]
a.output.parent.mkdir(parents=True, exist_ok=True)
with a.output.open("w", encoding="utf-8", newline="") as s:
    w = csv.DictWriter(s, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)
print(f"母集団={population} 標本={len(rows)} -> {a.output}")
