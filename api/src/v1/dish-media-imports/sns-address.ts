// api/src/v1/dish-media-imports/sns-address.ts
//
// #1375 4 巡目: キャプションに書かれた住所から店舗を探すための純粋関数群。
//
// ## なぜ要るのか
//
// 店舗候補の照合は「ユーザーの現在地の周辺」でしか行っていなかった。グルメ紹介系の
// 投稿は「📍 住所：東京都八王子市東町1-3」のように住所をキャプションに書いており、
// 現在地が店から離れていると（家で取り込むのが普通の使い方）、DB に店が居ても
// 候補ゼロになる（実 URL DZFdePPzzLI で実際に起きた）。
//
// キャプションから住所をルールベースで抜き、国土地理院のジオコーディング API
// （無料・キー不要）で座標化し、その地点の周辺も照合対象へ加える。
// Google Places / Geocoding は**課金になるので使わない**（オーナー方針）。
//
// ## 抽出は「日本の住所」に限る
//
// 国土地理院 API が日本国内専用なので、抽出パターンも都道府県から始まる形に限る。
// 海外住所は従来どおり「現在地の周辺 + 地図から選ぶ」へ縮退する。

import type { ExtractedText } from '../../../../shared/utils/textNormalize';

/**
 * 都道府県から始まる住所らしき並び。
 *
 * 「県」は 2〜3 文字の漢字 + 県（神奈川県 / 千葉県）。ひらがな・カタカナの偽陽性
 * （「いい感じの県」等）は続く市区町村の判定で落ちるので、ここでは緩くてよい。
 */
const PREFECTURE = '(?:東京都|北海道|(?:大阪|京都)府|[一-龠々]{2,3}県)';

/**
 * 住所の本体。都道府県に続けて、市区町村〜丁目・番地・号あたりまでを貪欲に取る。
 *
 * - 使う文字を明示的に許可する（漢字・ひらがな・カタカナ・英数・丁目番地の記号）。
 *   改行や「🚃」など次の行の絵文字を巻き込まないため
 * - ハイフンは全半角・長音・ダッシュの揺れを全部受ける（SNS の手打ちで揺れる）
 */
const ADDRESS_BODY = `${PREFECTURE}[0-9０-９一-龠々ぁ-んァ-ヶa-zA-Z\\-−ー–‐]{4,60}`;

/**
 * 「住所：」「所在地：」のようなラベル付き行。ラベルの直前の絵文字（📍 等）は
 * 「行のどこかにラベルがある」ことしか見ないので自然に無視される。
 *
 * ⚠️ `g` 付きで全マッチを走査すること（独立レビュー指摘 #1）。非 global の
 * `match()` は最初の 1 件しか返さず、その 1 件が「東京都在住のグルメです」の
 * ような偽陽性で市区町村チェックに落ちると、後方にある本物の住所が
 * 一度も評価されないまま null になる。
 */
const LABELED_ADDRESS = new RegExp(
  `(?:住所|所在地)\\s*[:：]\\s*(${ADDRESS_BODY})`,
  'g',
);

/** ラベルが無いときに本文から拾う保険。市区町村を含む最初のマッチを使う */
const BARE_ADDRESS = new RegExp(`(${ADDRESS_BODY})`, 'g');

/**
 * #1273 都道府県が省略され、市区町村から始まる住所（「名古屋市東区葵３丁目１２−１８」等）。
 *
 * グルメ紹介の実キャプション（`out/infl_captions.jsonl`）では、名古屋・金沢・広島など
 * **政令市／県庁所在地の投稿は都道府県を省いて市区町村から書く**ことが非常に多い。
 * 上の PREFECTURE 起点の 2 本ではこれを取りこぼし、住所抽出率が 53% で頭打ちになっていた
 * （標本 1,800 の実測: この形が 192 件＝取りこぼしの 22.8%）。
 *
 * 国土地理院 AddressSearch は都道府県が無くても市区町村から地番まで解決する
 * （実測: 「名古屋市東区葵3-12-18」→「愛知県名古屋市東区葵三丁目１２番１８号」。
 * 上記 192 件のうち先頭 30 件を叩いて 30/30 が入力の市区町村と一致する地点を返した）。
 *
 * 偽陽性（「名古屋市の3店」等の助詞混じり）を避けるため、市区町村の直後の町名は
 * **漢字・カタカナに限る**（助詞のひらがなを弾く）。さらに `HAS_BANCHI_DIGIT` で
 * 地番の数字を必須にし、施設名だけ（「◯◯市役所」等）を落とす。
 */
const CITY_LEAD_ADDRESS = new RegExp(
  '(' +
    '[一-龠々ヶ]{1,4}[市区町村](?![内外])' + // 市区町村（例: 名古屋市）
    '(?:[一-龠々ヶ]{1,4}区)?' + // 政令市の行政区（例: 東区。任意）
    '[一-龠々ヶァ-ヴ]' + // 町名の 1 文字目は漢字／カタカナ（助詞のひらがなを弾く）
    '[0-9０-９一-龠々ヶァ-ヴa-zA-Z\\-−ー–‐丁目番地条ノ]{2,38}' +
    ')',
  'g',
);

/**
 * 「市区町村まで含んでいるか」の確認。都道府県名だけ（「東京都のラーメン」等）を
 * ジオコーディングすると都庁の座標が返ってしまい、誤った地点で照合してしまう。
 */
const HAS_CITY_LEVEL = /[市区町村郡]/;

/**
 * 市区町村始まりの住所に地番の数字が含まれているかの確認。数字が無いものは
 * 施設名・「市内」等のノイズなので採らない（#1273）。
 */
const HAS_BANCHI_DIGIT = /[0-9０-９]/;

/**
 * キャプション群から住所らしき文字列を 1 つ抜く。見つからなければ `null`。
 *
 * ラベル付き（「住所：…」）を全テキストから優先して探し、無ければ裸の住所を拾う。
 * 抜いた住所はそのまま国土地理院 API の `q` に渡す想定（前方一致で解釈されるので、
 * 末尾にビル名等が混ざっていても地番までで解決される）。
 */
export function extractPostalAddress(texts: ExtractedText[]): string | null {
  // キャプションは 1 エントリに全文が入る形で来るので、全マッチを走査して
  // 市区町村チェックを通す最初のものを採る（先頭の偽陽性で打ち切らない）
  for (const entry of texts) {
    for (const labeled of entry.text.matchAll(LABELED_ADDRESS)) {
      if (HAS_CITY_LEVEL.test(labeled[1])) return labeled[1];
    }
  }
  for (const entry of texts) {
    for (const bare of entry.text.matchAll(BARE_ADDRESS)) {
      if (HAS_CITY_LEVEL.test(bare[1])) return bare[1];
    }
  }
  // #1273 都道府県が省略された市区町村始まりの住所（政令市・県庁所在地に多い）。
  // 上の 2 本（都道府県起点）で拾えたものはそこで返っているので、ここは純粋な «追加» で、
  // 都道府県付き住所の抽出結果を一切変えない。
  for (const entry of texts) {
    for (const cityLead of entry.text.matchAll(CITY_LEAD_ADDRESS)) {
      if (HAS_BANCHI_DIGIT.test(cityLead[1])) return cityLead[1];
    }
  }
  return null;
}

/**
 * #1273 loop B: «市区町村» までの粗い地域トークンを抜く（フル住所が取れないとき用）。
 *
 * ## なぜ要るのか（実測 2026-09-01）
 *
 * 実キャプション 1,798 本に対する resolve の実 regex 計測で、住所が抜けたのは 64%。
 * 抜けなかった 647 本の大半は «住所そのものが書かれていない»（📍店名だけ・bio の地域署名）。
 * ただしそのうち **139 本は «店名 + 地域語（都道府県 or 市区町村）» を併記**しており、
 * 地域を粗く座標化できれば «その地域内で店名一致» を引ける（name-first。地域スコープが付くので
 * 621k 全件 ILIKE を避けられる＝DB 安全）。
 *
 * ここは «都道府県 + 市区町村»（例: 「和歌山県和歌山市」）か、都道府県が省略されていれば
 * «市区町村» 単独（例: 「帯広市」）を返す。地番までは要らない（地域中心が取れれば十分）。
 * フル住所（`extractPostalAddress` が拾う地番つき）が取れるならそちらが優先なので、
 * ここは **フル住所が取れなかったときのフォールバック**として呼ぶ。
 */
const PREF_PLUS_CITY = new RegExp(
  `(${PREFECTURE}[一-龠々ヶ]{1,4}[市区町村](?:[一-龠々ヶ]{1,4}区)?)`,
);
// `[内外]` は「市内・区内」、`場` は「楽天市場」等の非地名複合を弾く（実測の偽陽性）。
const CITY_ONLY = /([一-龠々ヶ]{2,4}[市区町村](?![内外場])(?:[一-龠々ヶ]{1,4}区)?)/;

export function extractCoarseArea(texts: ExtractedText[]): string | null {
  // «都道府県 + 市区町村» を最優先（曖昧さが最も少ない）
  for (const entry of texts) {
    const m = PREF_PLUS_CITY.exec(entry.text);
    if (m) return m[1];
  }
  // 都道府県が省略された «市区町村» 単独（政令市・県庁所在地に多い）
  for (const entry of texts) {
    const m = CITY_ONLY.exec(entry.text);
    if (m) return m[1];
  }
  return null;
}

/**
 * #1273 loop B: キャプションから **店名** を抜く（📍 / 「店名：」 / 【】「」『』）。
 *
 * 住所が地番まで書かれていない «店名 + 地域» 型の投稿（実測 139/1798）から店へ辿るために使う。
 * 返した店名は `restaurants.name ILIKE '%店名%'` の `q` として、**地域スコープ付きの近傍検索**へ
 * 渡す（`extractCoarseArea` で得た地域中心の周辺だけを引く。全件走査はしない）。
 *
 * ## 抽出の優先順位（曖昧さの少ない順）
 *
 *  1. **「店名：X」「店舗名：X」** … 明示ラベル。最も確実
 *  2. **📍X** … ただし «📍 住所：» «📍 アクセス：» のような **住所/経路の📍は店名ではない**ので除く
 *  3. **【X】「X」『X』** … まとめ系が店名を囲う定番（`parse_captions` の find_store と同じ向き）
 *
 * ## 汚れの除去
 *
 * - 末尾のふりがな（「遊美館（ゆうびかん）」の «（ゆうびかん）»）は落とす（本体だけ q に使う）
 * - 行内の IG ハンドル（半角英数 + _ の連なり）や絵文字の巻き込みは、改行・記号で切って避ける
 * - 2 文字未満は捨てる（`restaurants.name ILIKE '%x%'` が実質全件に当たるため。q の下限と同じ規律）
 */
const STORE_NAME_MIN_LENGTH = 2;
const STORE_NAME_MAX_LENGTH = 40;
/** 「店名：」ラベル。🏠 等の直前絵文字は行内のどこかにラベルがある形なので自然に無視される */
const LABELED_STORE_NAME = /(?:店名|店舗名)\s*[:：]\s*([^\n:：]{1,40})/;
/** 📍 に続く行。住所・アクセス系のラベルが続くものは店名ではないので弾く */
const PIN_LINE = /📍\s*([^\n]{1,40})/;
const PIN_IS_ADDRESS = /^(?:住所|所在地|アクセス|場所|地図|map)/i;
/** 【】「」『』 で囲われた最初のトークン */
const BRACKETED_NAME = /[【「『]([^】」』\n]{1,40})[】」』]/;

/** 抽出した店名の汚れを落とす。空になったら null */
function cleanStoreName(raw: string): string | null {
  let s = raw.trim();
  // 末尾のふりがな・補足の括弧（（ゆうびかん） / (Yubikan) 等）を落とす
  s = s.replace(/[（(][^）)]*[）)]\s*$/u, '').trim();
  // IG ハンドル（@handle）や URL が続く場合は手前で切る
  s = s.split(/[@\n]/)[0].trim();
  // 前後の記号・空白を整える
  s = s.replace(/^[\s:：・|｜/-]+|[\s:：・|｜/-]+$/gu, '').trim();
  if (s.length < STORE_NAME_MIN_LENGTH || s.length > STORE_NAME_MAX_LENGTH) {
    return null;
  }
  return s;
}

export function extractStoreName(texts: ExtractedText[]): string | null {
  for (const entry of texts) {
    const labeled = LABELED_STORE_NAME.exec(entry.text);
    if (labeled) {
      const cleaned = cleanStoreName(labeled[1]);
      if (cleaned) return cleaned;
    }
  }
  for (const entry of texts) {
    for (const pin of entry.text.matchAll(new RegExp(PIN_LINE, 'g'))) {
      const body = pin[1].trim();
      if (PIN_IS_ADDRESS.test(body)) continue; // «📍 住所：» 等は店名ではない
      const cleaned = cleanStoreName(body);
      if (cleaned) return cleaned;
    }
  }
  for (const entry of texts) {
    const bracket = BRACKETED_NAME.exec(entry.text);
    if (bracket) {
      const cleaned = cleanStoreName(bracket[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** 国土地理院 AddressSearch の応答から取り出した 1 地点 */
export type GeocodedPoint = {
  lat: number;
  lng: number;
  /** API が解釈した住所表記。ログでの突き合わせ用 */
  title: string;
};

/**
 * 国土地理院 AddressSearch の応答（GeoJSON Feature の配列）を解釈する。
 *
 * 形が想定と違うときは推測で埋めず `null`（= 住所からは探さない、へ縮退）。
 * 先頭の 1 件だけを使う。複数返るのは住所が曖昧なときで、2 件目以降を使う根拠が無い。
 */
export function parseGsiAddressSearchResponse(
  body: unknown,
): GeocodedPoint | null {
  if (!Array.isArray(body) || body.length === 0) return null;

  const first = body[0] as {
    geometry?: { coordinates?: unknown };
    properties?: { title?: unknown };
  };
  const coordinates = first?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  // GeoJSON なので [経度, 緯度] の順
  const lng: unknown = coordinates[0];
  const lat: unknown = coordinates[1];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat,
    lng,
    title:
      typeof first.properties?.title === 'string' ? first.properties.title : '',
  };
}
