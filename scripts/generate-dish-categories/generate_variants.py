# generate_variants.py
import csv, uuid, sys, datetime, unicodedata
import jaconv
from pykakasi import kakasi
from collections import defaultdict

# ---------- utils ----------
def now_utc_iso() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")

def norm_key(s: str) -> str:
    """NFKC -> 空白圧縮 -> casefold（小文字）"""
    s = unicodedata.normalize("NFKC", s)
    s = " ".join(s.split())
    return s.lower()

def is_bad(s: str) -> bool:
    """空/無意味な文字列は True（出力しない）"""
    return (s is None) or (s == "") or (s in {"null", "\\n", "\\N"})

def qid_num(qid: str) -> int:
    try:
        return int(qid.rsplit("Q", 1)[1])
    except Exception:
        return 10**12

_kks = kakasi()  # 共有
def to_romaji(text: str) -> str:
    parts = _kks.convert(text)
    return "".join(p.get("hepburn", "") for p in parts).replace(" ", "")

def load_final_ids(path: str) -> dict:
    """dishes_final.csv: id,label_en -> {qid: label_en}"""
    m = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m[row["id"]] = row.get("label_en", "") or ""
    return m

# ---------- main ----------
def main():
    if len(sys.argv) < 2:
        print("usage: generate_variants.py labels.csv dishes_final.csv", file=sys.stderr)
        sys.exit(1)

    labels_csv  = sys.argv[1]
    final_csv   = sys.argv[2]

    id2label  = load_final_ids(final_csv)
    valid_ids = set(id2label.keys())

    ts = now_utc_iso()
    candidates = []  # {qid, surface(=normalized lower), source, canonical: bool}
    seen_per_qid = set()
    stats = {"added": 0, "skipped_empty": 0, "skipped_not_in_final": 0}

    # 1) 全 dish に canonical を付与（空は除外）
    for qid, label in id2label.items():
        s = norm_key(label)
        if is_bad(s):
            stats["skipped_empty"] += 1
            continue
        key = (qid, s)
        if key not in seen_per_qid:
            seen_per_qid.add(key)
            candidates.append({"qid": qid, "surface": s, "source": "canonical-label-en", "canonical": True})
            stats["added"] += 1

    # 2) labels.csv から候補追加（同一QID内重複抑止、空は除外）
    with open(labels_csv, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            qid = row["dish"].split("/")[-1]  # "https://www.wikidata.org/wiki/Q12345" -> "Q12345"
            if qid not in valid_ids:
                stats["skipped_not_in_final"] += 1
                continue
            val, lang = row["val"], row.get("lang")

            def add(raw: str, source: str):
                s = norm_key(raw)
                if is_bad(s):
                    stats["skipped_empty"] += 1
                    return
                key = (qid, s)
                if key in seen_per_qid:
                    return
                seen_per_qid.add(key)
                candidates.append({"qid": qid, "surface": s, "source": source, "canonical": False})
                stats["added"] += 1

            add(val, "wikidata-label")
            if lang == "ja":
                hira = jaconv.kata2hira(val)
                add(hira, "kata2hira")
                add(to_romaji(hira), "romaji")

    # 3) グローバル一意化（canonical 優先→非canonicalは空いていれば採用）
    source_priority = {"wikidata-label": 0, "kata2hira": 1, "romaji": 2, "canonical-label-en": -1}
    winners = {}  # surface -> index

    # まず canonical を確定
    for i, c in enumerate(candidates):
        if c["canonical"]:
            winners[c["surface"]] = i

    # 非canonical は surface ごとに競合解決
    by_surface = defaultdict(list)
    for i, c in enumerate(candidates):
        if not c["canonical"]:
            by_surface[c["surface"]].append(i)

    def rank(idx: int):
        c = candidates[idx]
        return (source_priority.get(c["source"], 9), qid_num(c["qid"]))  # 低い方が優先

    collide_skipped = 0
    for surf, idxs in by_surface.items():
        if surf in winners:
            collide_skipped += len(idxs)
            continue
        winners[surf] = min(idxs, key=rank)
        collide_skipped += (len(idxs) - 1)

    # 4) 出力（surface は正規化済み小文字）
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow(["id", "dish_category_id", "surface_form", "source", "created_at"])
    kept = 0
    for surf, idx in winners.items():
        c = candidates[idx]
        # 念のため最終防衛（空が紛れていたら捨てる）
        if is_bad(c["surface"]):
            continue
        w.writerow([uuid.uuid4(), c["qid"], c["surface"], c["source"], ts])
        kept += 1

    # 5) レポート（STDERR）
    print(
        f"[variants] candidates={len(candidates)} kept={kept} added={stats['added']} "
        f"skipped_empty={stats['skipped_empty']} skipped_not_in_final={stats['skipped_not_in_final']} "
        f"collide_skipped={collide_skipped}",
        file=sys.stderr
    )

if __name__ == "__main__":
    main()
