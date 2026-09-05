#!/usr/bin/env python3
"""
Extract candidate Instagram handles mentioned inside captions (NOT the posting
handle "h") from infl_captions.jsonl.

Two extraction forms:
  A. explicit @mentions:  @([A-Za-z0-9_.]{2,30})
  B. bare handle lines:   a line whose trimmed content is a single token matching
     ^[A-Za-z0-9_][A-Za-z0-9_.]{1,29}$ , contains a letter, is not a hashtag/URL.

Deterministic, local-only. No network.

Usage:  python3 extract_caption_handles.py
"""
import json
import re
import sys
from collections import defaultdict

IN_PATH = "infl_captions.jsonl"
OUT_PATH = "caption_mentioned_handles.json"

# --- regexes -------------------------------------------------------------
MENTION_RE = re.compile(r"@([A-Za-z0-9_.]{2,30})")
BARE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.]{1,29}$")
LETTER_RE = re.compile(r"[A-Za-z]")
DIGIT_US_DOT_RE = re.compile(r"[0-9_.]")

# Venue / address cues -> a nearby handle is likely a tagged store/venue.
VENUE_CUES = ["〒", "住所", "店名", "📍", "アクセス", "営業時間", "定休日", "map", "Map", "MAP"]
# Japanese prefecture names (kanji) as venue cues.
PREFECTURES = [
    "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬",
    "埼玉", "千葉", "東京", "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野",
    "岐阜", "静岡", "愛知", "三重", "滋賀", "京都", "大阪", "兵庫", "奈良", "和歌山",
    "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
]
VENUE_CUES_ALL = VENUE_CUES + PREFECTURES

# Follow-cue words -> a nearby handle is likely an influencer / aggregator.
FOLLOW_CUES = [
    "フォロー", "follow", "Follow", "FOLLOW", "グルメ", "gourmet", "Gourmet",
    "旅", "巡り", "系列アカウント", "アカウントも",
]

# Non-account stopwords / noise to exclude outright (lowercased, dots stripped).
STOP = {
    "http", "https", "www", "com", "co", "jp", "ne", "instagram", "reel",
    "line", "tiktok", "youtube", "twitter", "facebook", "x", "note", "google",
    "gmail", "tel", "fax", "open", "close", "menu", "cafe", "bar", "shop",
    "point", "map", "maps", "and", "the", "in", "at", "of", "to", "by",
    "pr", "ad", "id", "url", "dm", "ok", "go", "no", "on",
}

# Generic English words: allowed only if they carry a digit/underscore/dot,
# or appear >= 2 times. We treat a token as "generic word" when it is a pure
# lowercase alpha token with no digit/underscore/dot. The >=2 / has-marker
# rule is applied globally in the filtering pass below.


def strip_trailing_dots(s: str) -> str:
    return s.rstrip(".")


def normalize(tok: str) -> str:
    return strip_trailing_dots(tok.strip().lower())


def extract_from_caption(cap: str, poster: str):
    """Return list of (handle, has_venue_cue, has_follow_cue) occurrences."""
    lines = cap.split("\n")
    n = len(lines)
    # Precompute per-line cue presence for context window (+/- 3 lines).
    line_venue = [any(c in ln for c in VENUE_CUES_ALL) for ln in lines]
    line_follow = [any(c in ln for c in FOLLOW_CUES) for ln in lines]

    def ctx(i, arr, w=3):
        lo = max(0, i - w)
        hi = min(n, i + w + 1)
        return any(arr[lo:hi])

    results = []

    for i, raw in enumerate(lines):
        # Form A: @mentions anywhere on the line.
        for m in MENTION_RE.finditer(raw):
            tok = normalize(m.group(1))
            if not tok:
                continue
            results.append((tok, ctx(i, line_venue), ctx(i, line_follow)))

        # Form B: bare handle line (trimmed content is a single token).
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith("#") or stripped.startswith("@"):
            continue
        if "http" in stripped.lower() or "/" in stripped or " " in stripped:
            continue
        if BARE_TOKEN_RE.match(stripped) and LETTER_RE.search(stripped):
            tok = normalize(stripped)
            if tok:
                results.append((tok, ctx(i, line_venue), ctx(i, line_follow)))

    return results


def main():
    posters_all = set()
    # Per handle aggregation.
    handle_posts = defaultdict(int)              # total occurrences (posts) counting each line-caption once per handle
    handle_posters = defaultdict(set)            # distinct posting influencers that mention it
    handle_venue_hits = defaultdict(int)         # occurrences near venue cue
    handle_follow_hits = defaultdict(int)        # occurrences near follow cue
    handle_has_marker = {}                       # has digit/underscore/dot
    handle_total_count = defaultdict(int)        # raw occurrence count across all captions

    total_captions = 0

    with open(IN_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            o = json.loads(line)
            poster = o.get("h", "").strip().lower()
            posters_all.add(poster)
            cap = o.get("cap", "") or ""
            total_captions += 1

            occs = extract_from_caption(cap, poster)
            # Dedup handles within a single caption for post/poster counting,
            # but keep cue signal if ANY occurrence had it.
            per_caption = {}
            for tok, venue, follow in occs:
                if tok == poster:
                    continue  # exclude the posting handle of the same line
                handle_total_count[tok] += 1
                v, fol = per_caption.get(tok, (False, False))
                per_caption[tok] = (v or venue, fol or follow)

            for tok, (venue, follow) in per_caption.items():
                handle_posts[tok] += 1
                handle_posters[tok].add(poster)
                if venue:
                    handle_venue_hits[tok] += 1
                if follow:
                    handle_follow_hits[tok] += 1
                if tok not in handle_has_marker:
                    handle_has_marker[tok] = bool(DIGIT_US_DOT_RE.search(tok))

    # --- filtering pass ---------------------------------------------------
    # Exclude stopwords/noise. Exclude generic pure-alpha words unless they
    # carry a digit/underscore/dot OR appear >= 2 times (posts).
    candidates = {}
    for tok, posts in handle_posts.items():
        if tok in STOP:
            continue
        if len(tok) < 2:
            continue
        has_marker = handle_has_marker.get(tok, False)
        if not has_marker and posts < 2:
            # generic-looking single-occurrence word -> drop
            continue
        candidates[tok] = posts

    # Bucketing.
    # Store/venue: mentioned by only 1-2 distinct posters AND near venue cues.
    # Influencer/aggregator: many distinct posters OR follow-cue nearby.
    likely_store = []
    likely_influencer = []
    for tok in candidates:
        n_posters = len(handle_posters[tok])
        n_posts = handle_posts[tok]
        venue = handle_venue_hits[tok] > 0
        follow = handle_follow_hits[tok] > 0

        is_infl = (n_posters >= 3) or (follow and n_posters >= 2)
        is_store = (n_posters <= 2) and venue and not is_infl

        rec_store = {"handle": tok, "n_posts": n_posts, "n_distinct_posters": n_posters}
        rec_infl = {"handle": tok, "n_distinct_posters": n_posters, "n_posts": n_posts}
        if is_infl:
            likely_influencer.append(rec_infl)
        elif is_store:
            likely_store.append(rec_store)
        else:
            # Not clearly either: default by dominant signal.
            if venue and not follow:
                likely_store.append(rec_store)
            else:
                # fall back to store bucket if low spread, else influencer
                if n_posters <= 2:
                    likely_store.append(rec_store)
                else:
                    likely_influencer.append(rec_infl)

    # New vs posting handles.
    new_handles = [t for t in candidates if t not in posters_all]

    # Sorting (deterministic tie-break by handle).
    likely_store.sort(key=lambda r: (-r["n_posts"], -r["n_distinct_posters"], r["handle"]))
    likely_influencer.sort(key=lambda r: (-r["n_distinct_posters"], -r["n_posts"], r["handle"]))

    out = {
        "total_captions": total_captions,
        "distinct_candidate_handles": len(candidates),
        "new_vs_posting_handles": len(new_handles),
        "distinct_posting_handles": len(posters_all),
        "likely_store": likely_store[:200],
        "likely_influencer": likely_influencer[:100],
        "method_notes": (
            "Extraction: (A) @mention regex @([A-Za-z0-9_.]{2,30}) anywhere on a line; "
            "(B) bare-handle line = trimmed content is a single token ^[A-Za-z0-9_][A-Za-z0-9_.]{1,29}$ "
            "containing a letter, not a #hashtag/@mention/URL/multi-token line. "
            "Normalize = lowercase + strip trailing dots. Excluded: the posting handle of the same line, "
            "a stopword/noise list (http/www/com/jp/instagram/cafe/etc.), tokens <2 chars, and generic "
            "pure-alpha words (no digit/underscore/dot) that appear only once. Handles are deduped within "
            "a caption for post/poster counts. Buckets: LIKELY_INFLUENCER = mentioned by >=3 distinct "
            "posters, or a follow-cue (フォロー/Follow/グルメ/gourmet/旅/巡り/系列アカウント) within +/-3 lines "
            "and >=2 posters; LIKELY_STORE = mentioned by <=2 distinct posters with a venue cue "
            "(〒/住所/店名/📍/アクセス/営業時間/定休日/prefecture kanji) within +/-3 lines. Ambiguous tokens "
            "fall to store when low-spread + venue-cued, else influencer. Fully deterministic."
        ),
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # --- stdout summary ---------------------------------------------------
    print(f"total_captions            : {total_captions}")
    print(f"distinct_posting_handles  : {len(posters_all)}")
    print(f"distinct_candidate_handles: {len(candidates)}")
    print(f"new_vs_posting_handles    : {len(new_handles)}")
    print(f"likely_store   count      : {len(likely_store)}")
    print(f"likely_influencer count   : {len(likely_influencer)}")
    print()
    print("=== TOP 20 LIKELY STORE/VENUE (by n_posts) ===")
    for r in likely_store[:20]:
        print(f"  {r['handle']:<30} n_posts={r['n_posts']:<4} posters={r['n_distinct_posters']}")
    print()
    print("=== TOP 20 LIKELY INFLUENCER/AGGREGATOR (by distinct posters) ===")
    for r in likely_influencer[:20]:
        print(f"  {r['handle']:<30} posters={r['n_distinct_posters']:<4} n_posts={r['n_posts']}")


if __name__ == "__main__":
    main()
