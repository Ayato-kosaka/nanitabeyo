// api/src/v1/dish-media-imports/sns-address.spec.ts
//
// キャプション住所の抽出と、国土地理院 AddressSearch 応答の解釈（#1375 4 巡目）。
// 実 URL（DZFdePPzzLI）のキャプションの形をそのままテストに使う。

import {
  extractPostalAddress,
  parseGsiAddressSearchResponse,
} from './sns-address';

const text = (body: string) => [{ field: 'caption' as const, text: body }];

describe('extractPostalAddress', () => {
  it('「📍 住所：…」のラベル付き行から住所を抜く（実キャプションの形）', () => {
    const caption = [
      '炙りチャーシューと刻み玉ねぎの八王子ラーメン！',
      '■店舗情報',
      '🏠 店名：中華そば専門店 八王子ラーメンよしだ',
      '📍 住所：東京都八王子市東町1-3',
      '🚃 アクセス：京王線 京王八王子駅 徒歩1分',
    ].join('\n');
    expect(extractPostalAddress(text(caption))).toBe('東京都八王子市東町1-3');
  });

  it('「所在地：」ラベルも受ける', () => {
    expect(
      extractPostalAddress(text('所在地：大阪府大阪市北区梅田1-1-1')),
    ).toBe('大阪府大阪市北区梅田1-1-1');
  });

  it('ラベルが無くても本文中の住所を拾う', () => {
    expect(
      extractPostalAddress(
        text('神奈川県横浜市西区みなとみらい2-2-1 にあります'),
      ),
    ).toBe('神奈川県横浜市西区みなとみらい2-2-1');
  });

  it('都道府県名だけでは住所と見なさない（都庁の座標で照合しないため）', () => {
    expect(
      extractPostalAddress(text('東京都のおすすめラーメン5選')),
    ).toBeNull();
  });

  it('住所が無ければ null', () => {
    expect(extractPostalAddress(text('美味しいラーメンでした！'))).toBeNull();
    expect(extractPostalAddress([])).toBeNull();
  });

  // 独立レビュー指摘 #1: 先頭の偽陽性（「東京都在住」等）で打ち切らず、後方の本物を拾う
  it('先頭に市区町村を含まない偽陽性があっても、後方の本物の住所を拾う', () => {
    expect(
      extractPostalAddress(
        text('東京都在住のグルメです\n神奈川県横浜市西区みなとみらい2-2-1'),
      ),
    ).toBe('神奈川県横浜市西区みなとみらい2-2-1');
    expect(
      extractPostalAddress(
        text('東京都から電車で1時間！千葉県船橋市本町1-2-3'),
      ),
    ).toBe('千葉県船橋市本町1-2-3');
  });

  it('ラベル付きが後方のテキストにあっても、裸の住所より優先する', () => {
    const texts = [
      { field: 'caption' as const, text: '千葉県千葉市中央区で食べ歩き' },
      { field: 'caption' as const, text: '住所：東京都八王子市東町1-3' },
    ];
    expect(extractPostalAddress(texts)).toBe('東京都八王子市東町1-3');
  });
});

describe('parseGsiAddressSearchResponse', () => {
  // 実 API の応答形（2026-08-23 実測）を最小化したもの
  const realShape = [
    {
      geometry: { coordinates: [139.341049, 35.657646], type: 'Point' },
      type: 'Feature',
      properties: { addressCode: '', title: '東京都八王子市東町１番３号' },
    },
  ];

  it('GeoJSON の [経度, 緯度] を lat/lng へ読み替える', () => {
    expect(parseGsiAddressSearchResponse(realShape)).toEqual({
      lat: 35.657646,
      lng: 139.341049,
      title: '東京都八王子市東町１番３号',
    });
  });

  it('空配列・非配列・座標欠落は null（推測で埋めない）', () => {
    expect(parseGsiAddressSearchResponse([])).toBeNull();
    expect(parseGsiAddressSearchResponse(null)).toBeNull();
    expect(parseGsiAddressSearchResponse({})).toBeNull();
    expect(
      parseGsiAddressSearchResponse([
        { geometry: { coordinates: ['a', 'b'] } },
      ]),
    ).toBeNull();
  });
});
