# generate_variants.py
import csv, uuid, sys, datetime, unicodedata
import jaconv
from pykakasi import kakasi
from collections import defaultdict

def now_utc_iso():
    return datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")

def norm_key(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = " ".join(s.split())
    return s.casefold()  # 小文字比較用

def qid_num(qid: str) -> int:
    try: return int(qid.rsplit("Q",1)[1])
    except: return 10**12

def to_romaji(text: str) -> str:
    parts = kakasi().convert(text)
    return "".join(p.get("hepburn","") for p in parts).replace(" ","")

def load_final_ids(path: str):
    # dishes_final.csv: id,label_en
    m = {}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            m[row["id"]] = row.get("label_en","")
    return m  # {qid: label_en}

def main():
    if len(sys.argv) < 3:
        print("usage: generate_variants.py labels.csv dishes_final.csv", file=sys.stderr)
        sys.exit(1)

    labels_csv  = sys.argv[1]
    final_csv   = sys.argv[2]
    id2label    = load_final_ids(final_csv)
    valid_ids   = set(id2label.keys())

    candidates = []  # {qid,surface,source,canonical:bool}
    seen_per_qid = set()
    ts = now_utc_iso()

    # 1) まず canonical を全dishに追加
    for qid, label in id2label.items():
        surf = norm_key(label)  # 小文字 + NFKC + 空白正規化
        candidates.append({"qid": qid, "surface": surf, "source": "canonical-label-en", "canonical": True})

    # 2) labels.csv から候補追加（同一QIDの重複は除去）
    with open(labels_csv, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            qid = row["dish"]
            if qid not in valid_ids:
                continue
            val, lang = row["val"], row.get("lang")
            def add(s, src):
                key = (qid, norm_key(s))
                if key not in seen_per_qid:
                    seen_per_qid.add(key)
                    candidates.append({"qid": qid, "surface": norm_key(s), "source": src, "canonical": False})
            add(val, "wikidata-label")
            if lang == "ja":
                hira = jaconv.kata2hira(val)
                add(hira, "kata2hira")
                add(to_romaji(hira), "romaji")

    # 3) surface（小文字正規化済み）でクラスタリング → canonical を最優先採用
    by_surf = defaultdict(list)
    for i,c in enumerate(candidates):
        by_surf[c["surface"]].append(i)

    keep = [False]*len(candidates)
    for key, idxs in by_surf.items():
        canon = [i for i in idxs if candidates[i]["canonical"]]
        if canon:
            # canonical は必ず1件のはず（dish_categories 側で一意）
            keep[canon[0]] = True
            continue
        # 無ければ「surface==そのQIDの label_en（小文字）」を優先
        matches = [i for i in idxs if key == norm_key(id2label[candidates[i]["qid"]])]
        if len(matches) == 1:
            keep[matches[0]] = True
        elif len(matches) >= 2:
            keep[min(matches, key=lambda i: qid_num(candidates[i]["qid"]))] = True
        # どれも一致しなければ全捨て（グローバル一意を維持）

    # 4) 出力（surface はすでに小文字正規化済み）
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow(["id","dish_category_id","surface_form","source","created_at"])
    for i,c in enumerate(candidates):
        if keep[i]:
            w.writerow([uuid.uuid4(), c["qid"], c["surface"], c["source"], ts])

if __name__ == "__main__":
    main()
