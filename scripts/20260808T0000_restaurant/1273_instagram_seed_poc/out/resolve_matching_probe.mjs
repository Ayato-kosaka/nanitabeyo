// resolve_matching_probe.mjs — #1273 resolve 店舗照合の深掘り (analysis only, no network/DB).
//
// 実キャプション infl_captions.jsonl に対して、
//   (1) 現行 extractPostalAddress（sns-address.ts の正規表現を verbatim 移植）
//   (2) 現行の店名トークン抽出（extractBracketedNames / extractMentions / extractHashtags 相当）
//   (3) 提案する新抽出（extractPinNames / extractBareHandles / splitDescriptorName）
// を流し、「店名候補トークンを1つ以上生むキャプションの割合」を before/after で実測する。
//
// 分母はすべて 1800（infl_captions.jsonl の全行）。分子は各条件を満たす «キャプション» 数。
import fs from 'node:fs';

const LINES = fs
  .readFileSync(new URL('./infl_captions.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0);
const ROWS = LINES.map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// sns-address.ts の正規表現（verbatim）
// ---------------------------------------------------------------------------
const PREFECTURE = '(?:東京都|北海道|(?:大阪|京都)府|[一-龠々]{2,3}県)';
const ADDRESS_BODY = `${PREFECTURE}[0-9０-９一-龠々ぁ-んァ-ヶa-zA-Z\\-−ー–‐]{4,60}`;
const LABELED_ADDRESS = new RegExp(`(?:住所|所在地)\\s*[:：]\\s*(${ADDRESS_BODY})`, 'g');
const BARE_ADDRESS = new RegExp(`(${ADDRESS_BODY})`, 'g');
const CITY_LEAD_ADDRESS = new RegExp(
  '(' +
    '[一-龠々ヶ]{1,4}[市区町村](?![内外])' +
    '(?:[一-龠々ヶ]{1,4}区)?' +
    '[一-龠々ヶァ-ヴ]' +
    '[0-9０-９一-龠々ヶァ-ヴa-zA-Z\\-−ー–‐丁目番地条ノ]{2,38}' +
    ')',
  'g',
);
const HAS_CITY_LEVEL = /[市区町村郡]/;
const HAS_BANCHI_DIGIT = /[0-9０-９]/;

function extractPostalAddress(text) {
  for (const m of text.matchAll(LABELED_ADDRESS)) if (HAS_CITY_LEVEL.test(m[1])) return m[1];
  for (const m of text.matchAll(BARE_ADDRESS)) if (HAS_CITY_LEVEL.test(m[1])) return m[1];
  for (const m of text.matchAll(CITY_LEAD_ADDRESS)) if (HAS_BANCHI_DIGIT.test(m[1])) return m[1];
  return null;
}

// ---------------------------------------------------------------------------
// textNormalize.ts の現行トークナイザ（verbatim regex）
// ---------------------------------------------------------------------------
const BRACKETED_NAME_PATTERN = /【([^【】]{1,40})】/g;
const BRACKET_LABEL_WORDS = new Set([
  '店名','住所','所在地','場所','営業時間','営業日','定休日','アクセス','電話','電話番号',
  'メニュー','価格','料金','予約','駐車場','時間','最寄り駅',
]);
const MENTION_PATTERN = /@([a-z0-9._]{1,30})/g;
const HASHTAG_PATTERN = /#([^\s#、。,.!?！？「」『』（）()【】[\]]+)/g;

function nfkcLower(s) {
  return s.normalize('NFKC').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

function extractBracketedNames(cap) {
  const out = [];
  const norm = nfkcLower(cap);
  for (const m of norm.matchAll(BRACKETED_NAME_PATTERN)) {
    const body = m[1].trim();
    if (body.length > 0 && !BRACKET_LABEL_WORDS.has(body)) out.push(body);
  }
  return out;
}
function extractMentions(cap) {
  const norm = nfkcLower(cap);
  return [...norm.matchAll(MENTION_PATTERN)].map((m) => m[1].replace(/[._]+$/, '')).filter(Boolean);
}
function extractHashtags(cap) {
  const norm = nfkcLower(cap);
  return [...norm.matchAll(HASHTAG_PATTERN)].map((m) => m[1]).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 提案する新抽出
// ---------------------------------------------------------------------------

// 📍 直後の «店名». 住所ピン（📍：住所 / 📍 東京都… / 📍住所：…）は名前ではないので除外。
// 名前のあとに「住所：」「〒」「TEL」等が続く行は、そこで切って名前だけ取る。
const PIN = '📍';
const ADDR_LEAD = /^(?:住所|所在地|場所|アクセス|〒|tel|電話|address)/i;
const PREF_LEAD = /^(?:東京都|北海道|大阪府|京都府|[一-龥]{2,3}県)/;
// 行内で店名を打ち切る境界（このどれかが現れたら、その手前までが店名）
const NAME_CUTOFF = /(?:\s住所|住所[:：]|〒|\stel|tel[:：]|☎|営業時間|定休日|アクセス|\s{2,})/i;

function extractPinNames(cap) {
  const out = [];
  for (const rawLine of cap.split(/\r?\n/)) {
    const line = rawLine.trim();
    const idx = line.lastIndexOf(PIN);
    if (idx === -1) continue;
    let after = line.slice(idx + PIN.length);
    // 先頭の区切り記号（： ・ 空白）を除去
    after = after.replace(/^[\s：:・|｜]+/, '').trim();
    if (after.length === 0) continue;
    // 住所ピンは名前ではない
    if (ADDR_LEAD.test(after) || PREF_LEAD.test(after)) continue;
    // 名前のあとに住所/TEL等が続く行は、そこで切る
    const cut = after.search(NAME_CUTOFF);
    if (cut > 0) after = after.slice(0, cut).trim();
    // 末尾のカッコ読み仮名は残す（CRESCENT（クレセント）はそのまま候補に）
    after = after.replace(/[｜|].*$/, '').trim(); // 「CRESCENT｜松前カフェ」→ CRESCENT
    if (after.length >= 2 && after.length <= 40) out.push(nfkcLower(after));
  }
  return out;
}

// 行まるごとが IG ハンドル（英小文字始まり・[a-z0-9._]・2〜30）である «裸ハンドル».
// 影響: extractMentions は @ 必須なのでこれを取りこぼす（実測 @mention は 0.2%）。
const BARE_HANDLE = /^[a-z0-9][a-z0-9._]{1,29}$/;
function extractBareHandles(cap, ownHandle) {
  const out = [];
  for (const rawLine of cap.split(/\r?\n/)) {
    const line = nfkcLower(rawLine).trim();
    if (!BARE_HANDLE.test(line)) continue;
    if (!/[a-z]/.test(line)) continue; // 数字だけは弾く
    if (ownHandle && line === ownHandle.toLowerCase()) continue; // 投稿者自身
    out.push(line);
  }
  return out;
}

// 「descriptor + 店名」の 【】/📍 名を、屋号側へ寄せる分割。
// 業態語（カフェ/タイ料理/一汁三菜/…の descriptor）が先頭にあれば、末尾トークンを屋号候補に足す。
const DESCRIPTOR_HEAD = /^(?:カフェ|cafe|カフェ・?ダイニング|ダイニング|レストラン|居酒屋|焼肉|ラーメン|そば|寿司|鮨|バル|bar|ビストロ|食堂|定食|タイ料理|中華|イタリアン|フレンチ|韓国料理|パン|ベーカリー|bakery|一汁三菜|銘庭の宿|温泉旅館|旅館|ホテル)[\s　]/i;
function splitDescriptorName(name) {
  const n = name.trim();
  // 空白/&/・ で割れる複合名は、末尾トークンも屋号候補として返す
  const parts = n.split(/[\s　]+/).filter(Boolean);
  const variants = [n];
  if (parts.length >= 2 && DESCRIPTOR_HEAD.test(n)) {
    variants.push(parts[parts.length - 1]); // 末尾＝屋号候補
  }
  return variants;
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------
const N = ROWS.length;
let addr = 0;
let curNameTok = 0; // 現行トークナイザが「店名候補」を1つ以上出す（bracket/mention。hashtagは料理名ノイズが多いので別掲）
let curBracket = 0, curMention = 0, curHashtag = 0;
let pinName = 0, bareHandle = 0;
let addr_and_curName = 0, addr_and_anyName = 0, addr_no_curName_but_new = 0;
let noaddr = 0, noaddr_handle_or_pin = 0, noaddr_none = 0;

for (const r of ROWS) {
  const cap = r.cap;
  const a = extractPostalAddress(nfkcLower(cap)) !== null;
  const br = extractBracketedNames(cap);
  const me = extractMentions(cap);
  const ht = extractHashtags(cap);
  const pn = extractPinNames(cap);
  const bh = extractBareHandles(cap, r.h);

  if (a) addr++;
  const curName = br.length > 0 || me.length > 0; // 現行の「店名らしいトークン」
  if (br.length) curBracket++;
  if (me.length) curMention++;
  if (ht.length) curHashtag++;
  if (curName) curNameTok++;
  if (pn.length) pinName++;
  if (bh.length) bareHandle++;

  const anyName = curName || pn.length > 0 || bh.length > 0;

  if (a) {
    if (curName) addr_and_curName++;
    if (anyName) addr_and_anyName++;
    if (!curName && (pn.length > 0 || bh.length > 0)) addr_no_curName_but_new++;
  } else {
    noaddr++;
    if (bh.length > 0 || pn.length > 0) noaddr_handle_or_pin++;
    else noaddr_none++;
  }
}

const pct = (x) => `${x} (${((x / N) * 100).toFixed(1)}%)`;
console.log(`分母 N = ${N} キャプション\n`);
console.log('=== 抽出カバレッジ（分子＝その抽出が1件以上ヒットしたキャプション数 / 分母1800）===');
console.log(`住所抽出 extractPostalAddress   : ${pct(addr)}`);
console.log(`現行 店名トークン(bracket∪mention): ${pct(curNameTok)}`);
console.log(`  └ 【】bracket                  : ${pct(curBracket)}`);
console.log(`  └ @mention                     : ${pct(curMention)}`);
console.log(`  └ (参考)#hashtag               : ${pct(curHashtag)}`);
console.log(`[新] 📍pin-name                  : ${pct(pinName)}`);
console.log(`[新] bare-handle                 : ${pct(bareHandle)}`);
console.log('');
console.log('=== バケット1: 住所は取れた population ===');
console.log(`住所あり                         : ${pct(addr)}`);
console.log(`  ├ 現行トークンで店名候補あり   : ${addr_and_curName} (${(addr_and_curName/addr*100).toFixed(1)}% of 住所あり)`);
console.log(`  ├ 新抽出も足すと店名候補あり   : ${addr_and_anyName} (${(addr_and_anyName/addr*100).toFixed(1)}% of 住所あり)`);
console.log(`  └ 現行×→新抽出で新規に候補獲得 : ${addr_no_curName_but_new} キャプション（＝bucket1で救えるうわ乗せ）`);
console.log('');
console.log('=== バケット2: 住所なし population ===');
console.log(`住所なし                         : ${pct(noaddr)}`);
console.log(`  ├ 📍pin名 or bare-handle あり  : ${noaddr_handle_or_pin} (${(noaddr_handle_or_pin/noaddr*100).toFixed(1)}% of 住所なし) ← 辞書解決で救える上限`);
console.log(`  └ 何のシグナルも無い           : ${noaddr_none} (${(noaddr_none/noaddr*100).toFixed(1)}% of 住所なし)`);

// ---------------------------------------------------------------------------
// 追加分析: 表示名（pin-name / descriptor-split）に限った bucket1 うわ乗せ
// ---------------------------------------------------------------------------
console.log('\n=== 追加: 表示名シグナルに限定した内訳（handle は辞書専用なので除く）===');
let pinSample = [];
let addr_disp_cur = 0, addr_disp_pin_new = 0, addr_pin_not_bracket = 0;
for (const r of ROWS) {
  const cap = r.cap;
  const a = extractPostalAddress(nfkcLower(cap)) !== null;
  const br = extractBracketedNames(cap);
  const me = extractMentions(cap);
  const pn = extractPinNames(cap);
  if (pinSample.length < 20 && pn.length) pinSample.push(pn[0]);
  if (!a) continue;
  const curDisp = br.length > 0 || me.length > 0;
  if (curDisp) addr_disp_cur++;
  // pin-name が bracket 集合に無い «新規表示名»
  const brSet = new Set(br.map((x) => x.replace(/\s/g, '')));
  const pinNew = pn.some((p) => !brSet.has(p.replace(/\s/g, '')));
  if (pinNew) addr_pin_not_bracket++;
  if (!curDisp && pn.length) addr_disp_pin_new++;
}
console.log(`住所あり×現行表示名トークンあり           : ${addr_disp_cur}`);
console.log(`住所あり×📍pin名がbracketに無い新規表示名 : ${addr_pin_not_bracket}（exact化でprefill土俵へ乗る候補）`);
console.log(`住所あり×現行表示名ゼロ→📍pinで新規獲得    : ${addr_disp_pin_new}`);
console.log('--- 抽出された 📍pin-name サンプル ---');
for (const s of pinSample) console.log('   ', JSON.stringify(s));
