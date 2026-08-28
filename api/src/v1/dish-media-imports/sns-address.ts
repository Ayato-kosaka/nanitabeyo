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
 * 「市区町村まで含んでいるか」の確認。都道府県名だけ（「東京都のラーメン」等）を
 * ジオコーディングすると都庁の座標が返ってしまい、誤った地点で照合してしまう。
 */
const HAS_CITY_LEVEL = /[市区町村郡]/;

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
