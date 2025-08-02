# generate_variants.py
import csv, jaconv, romkan, uuid, sys
w = csv.writer(sys.stdout)
w.writerow(["id","dish_category_id","surface_form","source","created_at","lock_no"])
with open("labels.csv") as f:
    r = csv.DictReader(f)
    for row in r:
        qid = row["dish"]
        label = row["val"]
        ts = "now()"
        w.writerow([uuid.uuid4(), qid, label, "wikidata-label", ts, 0])
        if row["lang"] == "ja":
            w.writerow([uuid.uuid4(), qid, jaconv.kata2hira(label), "kata2hira", ts, 0])
            w.writerow([uuid.uuid4(), qid, romkan.to_roma(jaconv.kata2hira(label)), "romaji", ts, 0])
