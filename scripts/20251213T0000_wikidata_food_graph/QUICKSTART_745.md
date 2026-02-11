# Quick Start Guide for #745 Changes

## What Changed

The Wikidata food nodes extraction has been refactored from a single-stage property path approach to a 2-stage design:

**Before:** `?item (wdt:P31|wdt:P279)* ?root` (heavy, incomplete)
**After:** Stage 1: P279* class closure → Stage 2: P31-only node fetch (lighter, complete)

## How to Use

### First Time Setup (or after root changes)

```bash
# 1. Create/update tables
cd /home/runner/work/nanitabeyo/nanitabeyo/scripts/20251213T0000_wikidata_food_graph
python3 1_1_create_tables.py

# 2. Fetch class closure (NEW - takes ~5-10 minutes)
python3 1_1_5_fetch_and_load_classes.py

# Expected output:
# - Fetches P279* closure for each root
# - Validates that cake, ice cream, wine, etc. are found
# - Loads to food_class_closure table
```

### Regular Data Updates

```bash
# 3. Fetch nodes with new 2-stage logic
python3 1_2_fetch_and_load_nodes.py

# Expected output:
# - Reads classes from food_class_closure
# - Uses P31-only SPARQL queries
# - Logs 🎯 WATCH_QID found: Q13233 (page X) for tracked items
# - Summary shows: WATCH_QIDS found: 14/14

# 4. Generate paths (unchanged)
python3 1_3_generate_paths_and_summary.py
```

## What to Check

### ✅ Success Indicators

1. **Class closure populated:**
   ```sql
   SELECT COUNT(DISTINCT class_qid) FROM food_class_closure
   -- Should show hundreds to thousands of classes
   ```

2. **WATCH_QIDS all found:**
   ```
   🎯 WATCH_QID found: Q13233 (page 5)
   🎯 WATCH_QID found: Q13276 (page 12)
   ...
   WATCH_QIDS found: 14/14
   ```

3. **All representative items in raw:**
   ```sql
   SELECT item_qid, label_en FROM food_nodes_raw
   WHERE item_qid IN ('Q13233', 'Q13276', 'Q282', 'Q13290', 'Q375', 
                      'Q44541', 'Q20129', 'Q58263', 'Q6128', 'Q6663',
                      'Q8486', 'Q9266', 'Q41415', 'Q6137769')
   -- Should return 14 rows
   ```

### ⚠️ Warning Signs

- Class closure is empty → Re-run `1_1_5_fetch_and_load_classes.py`
- WATCH_QIDS found: 0/14 → Check class closure is populated
- Missing: [Q13233, ...] → Investigation needed

## Troubleshooting

### "No class QIDs found in food_class_closure"

**Cause:** Step 1.5 not executed or failed
**Fix:** Run `python3 1_1_5_fetch_and_load_classes.py`

### WATCH_QIDS still missing after execution

**Possible causes:**
1. Class closure incomplete → Check `food_class_closure` table
2. WDQS still returning partial results → Retry with delay
3. QID is not actually reachable via P31 → Verify in Wikidata directly

### Performance issues

- Class closure should take 5-10 minutes (not hours)
- Node fetch performance should be similar or better than before
- If slower, check WDQS status or reduce `page_size`

## When to Re-run Class Closure

- ✅ When adding/removing roots in `food_roots` table
- ✅ When Wikidata structure changes significantly (rare)
- ✅ Monthly/quarterly as preventive maintenance
- ❌ Not needed for regular node updates

## Files Reference

- **Migration:** `infra/big-query/migration/20260211T0000_create_food_class_closure.sql`
- **Class fetch:** `scripts/.../1_1_5_fetch_and_load_classes.py`
- **Node fetch:** `scripts/.../1_2_fetch_and_load_nodes.py` (modified)
- **Documentation:** `scripts/.../IMPLEMENTATION_745.md`

## Support

If issues persist:
1. Check logs for specific SPARQL errors
2. Verify BigQuery table schemas match migration
3. Test with `--limit 100` for faster debugging
4. Review `IMPLEMENTATION_745.md` for technical details
