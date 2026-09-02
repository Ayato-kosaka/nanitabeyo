import fs from 'node:fs';
const lines = fs.readFileSync('scripts/20260808T0000_restaurant/1273_instagram_seed_poc/out/infl_captions.jsonl','utf8').split('\n').filter(Boolean);
// re-decl address extractor (verbatim)
const PREF='(?:東京都|北海道|(?:大阪|京都)府|[一-龠々]{2,3}県)';
const BODY=`${PREF}[0-9０-９一-龠々ぁ-んァ-ヶa-zA-Z\\-−ー–‐]{4,60}`;
const LAB=new RegExp(`(?:住所|所在地)\\s*[:：]\\s*(${BODY})`,'g');
const BARE=new RegExp(`(${BODY})`,'g');
const CITY=new RegExp('('+'[一-龠々ヶ]{1,4}[市区町村](?![内外])'+'(?:[一-龠々ヶ]{1,4}区)?'+'[一-龠々ヶァ-ヴ]'+'[0-9０-９一-龠々ヶァ-ヴa-zA-Z\\-−ー–‐丁目番地条ノ]{2,38}'+')','g');
const HC=/[市区町村郡]/,HB=/[0-9０-９]/;
function addr(t){for(const m of t.matchAll(LAB))if(HC.test(m[1]))return m[1];for(const m of t.matchAll(BARE))if(HC.test(m[1]))return m[1];for(const m of t.matchAll(CITY))if(HB.test(m[1]))return m[1];return null;}
// signals
const PIN=/📍[ \t]*([^\n@#]{1,30})/g;                 // pin + venue name
const MENTION=/(?:^|[\s（(])@([A-Za-z0-9_][A-Za-z0-9_.]{1,29})/g; // @handle
const BAREHANDLE=/^[ \t]*([a-z0-9_][a-z0-9_.]{2,29})[ \t]*$/;     // lone handle line (IG tag render)
let hasAddr=0, hasPin=0, hasMention=0, hasBareHandle=0, hasAnyHandle=0, hasPinOrHandle=0, addrMissButHandleOrPin=0;
const handleUniverse=new Set();
for(const ln of lines){let o;try{o=JSON.parse(ln)}catch{continue}
  const cap=o.cap||''; const a=addr(cap); if(a)hasAddr++;
  const pin=[...cap.matchAll(PIN)].length>0; if(pin)hasPin++;
  const men=[...cap.matchAll(MENTION)].map(m=>m[1]);
  let bare=[]; for(const l of cap.split('\n')){const m=l.match(BAREHANDLE); if(m && /[a-z]/.test(m[1]) && m[1]!==(o.h||'')) bare.push(m[1]);}
  if(men.length)hasMention++; if(bare.length)hasBareHandle++;
  const anyH=(men.length+bare.length)>0; if(anyH)hasAnyHandle++;
  for(const h of [...men,...bare]) handleUniverse.add(h.toLowerCase());
  if(pin||anyH)hasPinOrHandle++;
  if(!a && (pin||anyH)) addrMissButHandleOrPin++;
}
const N=lines.length;
const pct=x=>`${x} (${(100*x/N).toFixed(1)}%)`;
console.log('captions',N);
console.log('has street address        ', pct(hasAddr));
console.log('has 📍pin venue           ', pct(hasPin));
console.log('has @mention              ', pct(hasMention));
console.log('has bare-handle line      ', pct(hasBareHandle));
console.log('has ANY tagged handle     ', pct(hasAnyHandle));
console.log('has 📍pin OR tagged handle ', pct(hasPinOrHandle));
console.log('ADDR MISS but pin/handle  ', pct(addrMissButHandleOrPin), '<-- recoverable store signal the pipeline ignores');
console.log('distinct candidate handles in captions', handleUniverse.size);
