// api/src/v1/dish-media-imports/sns-address.spec.ts
//
// キャプション住所の抽出と、国土地理院 AddressSearch 応答の解釈（#1375 4 巡目）。
// 実 URL（DZFdePPzzLI）のキャプションの形をそのままテストに使う。

import {
  extractPostalAddress,
  extractCoarseArea,
  extractStoreName,
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

  // #1273 都道府県が省略され市区町村から始まる住所（政令市・県庁所在地に多い）。
  // 実キャプション（out/infl_captions.jsonl）で取りこぼしの 22.8% を占めていた形。
  it('都道府県が省略された市区町村始まりの住所を拾う（名古屋・金沢など）', () => {
    expect(
      extractPostalAddress(text('📍名古屋市東区葵3-12-18の【おかげ庵】さん')),
    ).toBe('名古屋市東区葵3-12-18');
    expect(
      extractPostalAddress(text('名古屋市中区栄３丁目５−１ 三越')),
    ).toBe('名古屋市中区栄３丁目５−１');
    expect(
      extractPostalAddress(text('金沢市東山1丁目12-7 のカフェ')),
    ).toBe('金沢市東山1丁目12-7');
  });

  it('都道府県付きの住所は、市区町村始まりより優先される（既存挙動を壊さない）', () => {
    // 都道府県起点の抽出が先に走るので、市区町村始まりのフォールバックは «追加» に留まる
    expect(
      extractPostalAddress(text('愛知県名古屋市東区葵3-12-18')),
    ).toBe('愛知県名古屋市東区葵3-12-18');
  });

  it('市区町村の直後が助詞・地番なしのときは住所と見なさない（誤ジオコーディングを防ぐ）', () => {
    // 「◯◯市の3店」のような助詞混じり（町名の 1 文字目がひらがな）は弾く
    expect(extractPostalAddress(text('名古屋市の3店舗を紹介します'))).toBeNull();
    // 施設名だけ（地番の数字が無い）も採らない
    expect(extractPostalAddress(text('名古屋市役所の近くのカフェ'))).toBeNull();
    // 「市内」「区内」は市区町村トークンにしない
    expect(extractPostalAddress(text('市内3店を食べ歩いた'))).toBeNull();
  });
});

// #1273 loop B: フル住所が無い «店名 + 市区町村» 型を地域スコープで引くための抽出。
describe('extractCoarseArea', () => {
  it('都道府県 + 市区町村を最優先で返す', () => {
    expect(extractCoarseArea(text('和歌山県和歌山市の【KORI庵】へ'))).toBe(
      '和歌山県和歌山市',
    );
  });

  it('政令市の行政区まで含める', () => {
    expect(extractCoarseArea(text('宮城県仙台市若林区のあの店'))).toBe(
      '宮城県仙台市若林区',
    );
  });

  it('都道府県が省略されていれば市区町村単独を返す', () => {
    expect(extractCoarseArea(text('帯広市で見つけた焼肉屋さん'))).toBe('帯広市');
  });

  it('「市場」等の非地名複合を市区町村と誤認しない', () => {
    // 「楽天市場」→「楽天市」のような偽陽性を弾く（実測）
    expect(extractCoarseArea(text('楽天市場で買える名店の味'))).toBeNull();
  });

  it('地域語が無ければ null', () => {
    expect(extractCoarseArea(text('美味しかった！また行きたい'))).toBeNull();
    expect(extractCoarseArea([])).toBeNull();
  });
});

describe('extractStoreName', () => {
  it('「店名：X」ラベルを最優先で抜く', () => {
    const caption = [
      '🏠 店名：中華そば専門店 八王子ラーメンよしだ',
      '📍 住所：東京都八王子市東町1-3',
    ].join('\n');
    expect(extractStoreName(text(caption))).toBe(
      '中華そば専門店 八王子ラーメンよしだ',
    );
  });

  it('📍 の店名を抜き、末尾のふりがな括弧を落とす', () => {
    expect(extractStoreName(text('📍遊美館（ゆうびかん）\n最高でした'))).toBe(
      '遊美館',
    );
  });

  it('「📍 住所：」「📍 アクセス：」は店名として扱わない', () => {
    // 住所/経路の📍しか無いときは（店名ラベルも括弧名も無ければ）null
    expect(
      extractStoreName(text('📍 住所：東京都八王子市東町1-3\n📍 アクセス：徒歩1分')),
    ).toBeNull();
  });

  it('【】「」『』で囲われた店名を拾う', () => {
    expect(extractStoreName(text('今日は【満寿屋商店】でランチ🥪'))).toBe(
      '満寿屋商店',
    );
  });

  it('店名が取れなければ null', () => {
    expect(extractStoreName(text('美味しいラーメンでした'))).toBeNull();
    expect(extractStoreName([])).toBeNull();
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
