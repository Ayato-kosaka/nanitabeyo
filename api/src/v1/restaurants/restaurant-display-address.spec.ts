// api/src/v1/restaurants/restaurant-display-address.spec.ts
//
// #1671 確認ページの住所欄の初期値。
// ⚠️ ここが担保するのは «だいたい読める初期値が出る» ことだけである。
// 正しさの担保はユーザーの確認であって、この関数ではない（→ 実装の冒頭コメント）。

import { buildDisplayAddress } from './restaurant-display-address';

const jp = [
  { longText: '1-2-3', types: ['premise'] },
  {
    longText: '神南',
    types: ['sublocality_level_2', 'sublocality', 'political'],
  },
  { longText: '渋谷区', types: ['locality', 'political'] },
  { longText: '東京都', types: ['administrative_area_level_1', 'political'] },
  { longText: '日本', shortText: 'JP', types: ['country', 'political'] },
];

const us = [
  { longText: '1600', types: ['street_number'] },
  { longText: 'Amphitheatre Parkway', types: ['route'] },
  { longText: 'Mountain View', types: ['locality', 'political'] },
  {
    longText: 'California',
    shortText: 'CA',
    types: ['administrative_area_level_1', 'political'],
  },
  {
    longText: 'United States',
    shortText: 'US',
    types: ['country', 'political'],
  },
];

describe('#1671 確認ページの住所欄の初期値', () => {
  it('日本は大 → 小の順で、区切り無しで並ぶ', () => {
    expect(buildDisplayAddress(jp, 'JP')).toBe('東京都渋谷区神南1-2-3');
  });

  it('日本以外は小 → 大の順で、読点区切りで並ぶ', () => {
    expect(buildDisplayAddress(us, 'US')).toBe(
      '1600, Amphitheatre Parkway, Mountain View, California',
    );
  });

  it('国名は住所文字列に入れない（«国» 欄で別に見せるため）', () => {
    expect(buildDisplayAddress(jp, 'JP')).not.toContain('日本');
    expect(buildDisplayAddress(us, 'US')).not.toContain('United States');
  });

  it('longText が無ければ shortText で代用する', () => {
    expect(
      buildDisplayAddress(
        [{ shortText: 'CA', types: ['administrative_area_level_1'] }],
        'US',
      ),
    ).toBe('CA');
  });

  it('political / plus_code «しか» 持たない component は捨てる', () => {
    expect(
      buildDisplayAddress(
        [
          { longText: '捨てる', types: ['political'] },
          { longText: '捨てる2', types: ['plus_code'] },
          { longText: '残す', types: ['locality', 'political'] },
        ],
        'US',
      ),
    ).toBe('残す');
  });

  it.each([
    ['空配列', [] as never[]],
    ['null', null],
    ['undefined', undefined],
    // jsonb NOT NULL は JSON リテラルの null も {} も防がない（locations.service.ts と同じ事情）
    ['配列ですらない値', {} as never],
  ])('%s → 空文字（ユーザーが 1 から書く）', (_label, input) => {
    expect(buildDisplayAddress(input as never, 'JP')).toBe('');
  });

  it('国コードが分からなければ小 → 大で出す（既定側へ倒す）', () => {
    expect(buildDisplayAddress(jp, null)).toBe('1-2-3, 神南, 渋谷区, 東京都');
  });

  it('国名しか無ければ空文字', () => {
    expect(
      buildDisplayAddress(
        [
          {
            longText: '日本',
            shortText: 'JP',
            types: ['country', 'political'],
          },
        ],
        'JP',
      ),
    ).toBe('');
  });
});
