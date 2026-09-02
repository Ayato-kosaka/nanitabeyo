import fs from 'node:fs';
// --- verbatim regexes from api/src/v1/dish-media-imports/sns-address.ts ---
const PREFECTURE = '(?:東京都|北海道|(?:大阪|京都)府|[一-龠々]{2,3}県)';
const ADDRESS_BODY = `${PREFECTURE}[0-9０-９一-龠々ぁ-んァ-ヶa-zA-Z\\-−ー–‐]{4,60}`;
const LABELED_ADDRESS = new RegExp(`(?:住所|所在地)\\s*[:：]\\s*(${ADDRESS_BODY})`, 'g');
const BARE_ADDRESS = new RegExp(`(${ADDRESS_BODY})`, 'g');
const CITY_LEAD_ADDRESS = new RegExp(
  '(' + '[一-龠々ヶ]{1,4}[市区町村](?![内外])' + '(?:[一-龠々ヶ]{1,4}区)?' +
  '[一-龠々ヶァ-ヴ]' + '[0-9０-９一-龠々ヶァ-ヴa-zA-Z\\-−ー–‐丁目番地条ノ]{2,38}' + ')', 'g');
const HAS_CITY_LEVEL = /[市区町村郡]/;
const HAS_BANCHI_DIGIT = /[0-9０-９]/;
function extractPostalAddress(texts){
  for (const e of texts){ for (const m of e.text.matchAll(LABELED_ADDRESS)){ if (HAS_CITY_LEVEL.test(m[1])) return m[1]; } }
  for (const e of texts){ for (const m of e.text.matchAll(BARE_ADDRESS)){ if (HAS_CITY_LEVEL.test(m[1])) return m[1]; } }
  for (const e of texts){ for (const m of e.text.matchAll(CITY_LEAD_ADDRESS)){ if (HAS_BANCHI_DIGIT.test(m[1])) return m[1]; } }
  return null;
}
// --- run over captions ---
const lines = fs.readFileSync('scripts/20260808T0000_restaurant/1273_instagram_seed_poc/out/infl_captions.jsonl','utf8').split('\n').filter(Boolean);
let hit=0, miss=0;
const missWithSignal=[]; // miss but caption clearly has an address
const POSTAL = /〒\s*\d{3}-?\d{4}/;             // 〒 postal code
const PREF_ANY = /(東京都|北海道|大阪府|京都府|..県)/;
const ADDR_LABEL = /(住所|所在地|📍|所在)/;
for (const ln of lines){
  let o; try{o=JSON.parse(ln)}catch{continue}
  const cap = o.cap||'';
  const got = extractPostalAddress([{text:cap}]);
  if (got){hit++} else {
    miss++;
    const hasPostal = POSTAL.test(cap);
    const hasPref = PREF_ANY.test(cap);
    const hasLabel = ADDR_LABEL.test(cap);
    if (hasPostal || (hasPref && hasLabel) || (hasPostal)) {
      missWithSignal.push({h:o.h, hasPostal, hasPref, hasLabel, link:o.link, cap});
    }
  }
}
console.log(`captions=${lines.length} addr_hit=${hit} (${(100*hit/lines.length).toFixed(1)}%) miss=${miss}`);
console.log(`miss_but_has_address_signal=${missWithSignal.length}  (〒 or prefecture+label)`);
fs.writeFileSync('scripts/20260808T0000_restaurant/1273_instagram_seed_poc/out/addr_misses_with_signal.json', JSON.stringify(missWithSignal,null,1));
// print 12 samples for eyeballing
for (const m of missWithSignal.slice(0,12)){
  const snip = m.cap.replace(/\n/g,' ').slice(0,260);
  console.log(`\n--- @${m.h} postal=${m.hasPostal} pref=${m.hasPref} label=${m.hasLabel}\n${snip}`);
}
