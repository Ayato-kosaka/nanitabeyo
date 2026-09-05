import json, os, re
from collections import Counter
from pillar1_site_extract import (PLATFORM_HANDLES, corroborated, domain_token)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
R = json.load(open(f"{OUT}/pillar1_site_extract.json"))
N = len(R)

# arm frequencies
old_freq, new_freq = Counter(), Counter()
for r in R:
    for h in set(r.get("old_handles", [])): old_freq[h]+=1
    for h in set((r.get("new_handles") or {}).keys()): new_freq[h]+=1

# 1) what @handle text added that ig_url did not
at_only_stores = 0
at_handles = set()
src_counter = Counter()
new_not_in_old = 0
old_not_in_new = 0
for r in R:
    oh = set(r.get("old_handles", []))
    nh = r.get("new_handles") or {}
    for h, tags in nh.items():
        for t in tags: src_counter[t]+=1
    only_at = {h for h,t in nh.items() if set(t)=={"at_text"}}
    if only_at and not (set(nh)-only_at) and not oh:
        at_only_stores += 1
        at_handles |= only_at
    if set(nh) - oh: new_not_in_old += 1
    if oh - set(nh): old_not_in_new += 1

# 2) reachability breakdown
status = Counter(r.get("status") for r in R)

# 3) aggregator vs own-site yield (store_specific)
def ss(r, handles, freq):
    host=r.get("host",""); name=r.get("name",""); agg=r.get("aggregator_host",False)
    out=set()
    for h in handles:
        if h in PLATFORM_HANDLES: continue
        if freq.get(h,0)>=2: continue
        if agg and not corroborated(h,host,name,allow_domain=False): continue
        out.add(h)
    return out

def ss_strict(r, handles, freq):
    host=r.get("host",""); name=r.get("name",""); agg=r.get("aggregator_host",False)
    out=set()
    for h in handles:
        if h in PLATFORM_HANDLES: continue
        if freq.get(h,0)>=2: continue
        # strict: require corroboration for ALL (domain allowed only on own-site)
        if not corroborated(h,host,name,allow_domain=(not agg)): continue
        out.add(h)
    return out

union=ssc=ssc_strict=0
own_union=own_ss=agg_union=agg_ss=0
dropped_generic = Counter()
for r in R:
    nh=set((r.get("new_handles") or {}).keys())
    agg=r.get("aggregator_host",False)
    if nh: union+=1
    s=ss(r,nh,new_freq); st=ss_strict(r,nh,new_freq)
    if s: ssc+=1
    if st: ssc_strict+=1
    if agg:
        if nh: agg_union+=1
        if s: agg_ss+=1
    else:
        if nh: own_union+=1
        if s: own_ss+=1
    # what got dropped from union
    for h in nh - s:
        if h in PLATFORM_HANDLES: dropped_generic["platform_blocklist"]+=1
        elif new_freq.get(h,0)>=2: dropped_generic["chain_multi_store"]+=1
        elif agg: dropped_generic["aggregator_uncorroborated"]+=1

# chain handles (appear >=2 stores)
chains = {h:c for h,c in new_freq.items() if c>=2}

print(f"N={N}")
print("status:", dict(status))
print(f"reachable(ok+website_is_ig)={status['ok']+status['website_is_ig']}  unreachable(fetch_failed+robots)={status['fetch_failed']+status['robots_blocked']}")
print("new_handle source tag counts:", dict(src_counter))
print(f"@handle-text-only stores (net new via at_text): {at_only_stores}  handles={sorted(at_handles)}")
print(f"stores where NEW has a handle OLD lacked: {new_not_in_old}; OLD has handle NEW lacked: {old_not_in_new}")
print(f"union={union} ({100*union/N:.2f}%)  store_specific_lenient={ssc} ({100*ssc/N:.2f}%)  store_specific_strict={ssc_strict} ({100*ssc_strict/N:.2f}%)")
print(f"own-site: union={own_union} ss={own_ss}   aggregator-site: union={agg_union} ss={agg_ss}")
print("union->store_specific drops by reason:", dict(dropped_generic))
print("chain handles (>=2 stores):", dict(sorted(chains.items(), key=lambda x:-x[1])))
# denominators for rate on reachable-only
reach = status['ok']+status['website_is_ig']
print(f"store_specific_lenient / reachable = {ssc}/{reach} = {100*ssc/reach:.2f}%")
print(f"store_specific_strict  / reachable = {ssc_strict}/{reach} = {100*ssc_strict/reach:.2f}%")
