import fs from 'node:fs';
const lines=fs.readFileSync('scripts/20260808T0000_restaurant/1273_instagram_seed_poc/out/infl_captions.jsonl','utf8').split('\n').filter(Boolean);
// address extractor (verbatim, to find the "no address" subset)
const PREF='(?:東京都|北海道|(?:大阪|京都)府|[一-龠々]{2,3}県)';
const BODY=`${PREF}[0-9０-９一-龠々ぁ-んァ-ヶa-zA-Z\\-−ー–‐]{4,60}`;
const LAB=new RegExp(`(?:住所|所在地)\\s*[:：]\\s*(${BODY})`,'g');
const BARE=new RegExp(`(${BODY})`,'g');
const CITY=new RegExp('('+'[一-龠々ヶ]{1,4}[市区町村](?![内外])'+'(?:[一-龠々ヶ]{1,4}区)?'+'[一-龠々ヶァ-ヴ]'+'[0-9０-９一-龠々ヶァ-ヴa-zA-Z\\-−ー–‐丁目番地条ノ]{2,38}'+')','g');
const HC=/[市区町村郡]/,HB=/[0-9０-９]/;
function addr(t){for(const m of t.matchAll(LAB))if(HC.test(m[1]))return m[1];for(const m of t.matchAll(BARE))if(HC.test(m[1]))return m[1];for(const m of t.matchAll(CITY))if(HB.test(m[1]))return m[1];return null;}
// area recovery: prefecture name OR "◯◯市/区/町" token anywhere (hashtag or text), no banchi needed
const PREFS='北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄';
const PREF_TOKEN=new RegExp(`(?:${PREFS})`);
const CITY_TOKEN=new RegExp('[一-龠々ヶ]{1,5}[市区町]');
const PIN=/📍[ \t]*([^\n@#]{1,30})/;
let noaddr=0, rec_pref=0, rec_city=0, rec_any=0, rec_any_and_pin=0;
for(const ln of lines){let o;try{o=JSON.parse(ln)}catch{continue}
  const cap=o.cap||''; if(addr(cap)) continue; noaddr++;
  const p=PREF_TOKEN.test(cap), c=CITY_TOKEN.test(cap), pin=PIN.test(cap);
  if(p)rec_pref++; if(c)rec_city++;
  const any=p||c; if(any)rec_any++;
  if(any&&pin)rec_any_and_pin++;
}
const pc=x=>`${x} (${(100*x/noaddr).toFixed(1)}% of no-addr)`;
console.log('no-address captions',noaddr);
console.log('  has prefecture token   ',pc(rec_pref));
console.log('  has 市区町 token        ',pc(rec_city));
console.log('  has ANY area token      ',pc(rec_any));
console.log('  area token AND 📍pin     ',pc(rec_any_and_pin),'<- area→geocode + 📍name match candidate');
