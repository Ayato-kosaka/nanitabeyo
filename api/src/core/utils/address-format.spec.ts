// api/src/core/utils/address-format.spec.ts
//
// #1196 address の形式判定（クライアント側 app-expo/lib/addressFormat.test.ts と対になる）
//

import {
  findAddressFormatViolation,
  isCanonicalAddress,
} from './address-format';

describe('#1196 isCanonicalAddress', () => {
  describe('正規形式（country: トークンを含む）は true', () => {
    it.each([
      'country:JP, administrative_area_level_1:Osaka, locality:Osaka',
      'country:JP, administrative_area_level_1:大阪府, locality:大阪市',
      'country:JP',
      // 国だけ取れて以降が欠損したケースもゲートは成立する
      'country:US, administrative_area_level_1:CA',
      // 前後の空白は正規化して判定する
      '  country:JP ,  locality:Osaka  ',
    ])('%s', (address) => {
      expect(isCanonicalAddress(address)).toBe(true);
    });
  });

  describe('#1196 本番で観測された壊れた形式（市区町村名単体）は false', () => {
    // BigQuery 実測で 1日 1,445件 / 204ユーザー分を占めていた実例
    it.each([
      '大阪市',
      '名古屋市',
      '広島市',
      '新宿区',
      '横浜市',
      '柏市',
      '京都市',
      '東松山市',
      '中央区',
      '足立区',
      '北九州市',
      '仙台市',
    ])('%s', (address) => {
      expect(isCanonicalAddress(address)).toBe(false);
    });
  });

  describe('その他の非正規形式は false', () => {
    it.each([
      ['空文字', ''],
      ['null', null],
      ['undefined', undefined],
      ['country トークンが値を持たない', 'country:'],
      ['expo フォールバックの表示用文字列', '現在地 (34.6937, 135.5023)'],
      [
        'country が無く地域トークンだけ',
        'administrative_area_level_1:大阪府, locality:大阪市',
      ],
      // "country" で始まるだけの別トークンを誤って通さないこと
      ['country を含む別キー', 'countryside:JP'],
      // #1196 ゲートの照合は Postgres の `=`(大小文字区別あり)で、whitelist は 'region:country:JP'。
      // 小文字のままだと `region:country:jp` になりゲートに当たらないので、正規形式として扱わない。
      // (旧ビルドからこれが届いたら MalformedAddressFormat を鳴らす。サーバ側で救済はしない)
      ['小文字の国コード', 'country:jp, administrative_area_level_1:Osaka'],
      ['先頭だけ大文字の国コード', 'country:Jp'],
      ['alpha-2 でない国名', 'country:Japan'],
    ])('%s', (_label, address) => {
      expect(isCanonicalAddress(address)).toBe(false);
    });
  });
});

describe('#1196 findAddressFormatViolation', () => {
  it('正規形式なら null', () => {
    expect(
      findAddressFormatViolation('country:JP, locality:大阪市'),
    ).toBeNull();
  });

  describe('country トークンが無い場合は missing_country_token', () => {
    it.each([
      ['市区町村名単体', '大阪市'],
      ['空文字', ''],
      ['null', null],
      ['undefined', undefined],
      ['country で始まるだけの別キー', 'countryside:JP'],
    ])('%s', (_label, address) => {
      expect(findAddressFormatViolation(address)).toBe('missing_country_token');
    });
  });

  describe('country トークンはあるが値が大文字 alpha-2 でない場合は malformed_country_code', () => {
    // #1196 原因が別物(前者は組み立てロジック、後者は大小文字の正規化漏れ)なので reason を分ける
    it.each([
      ['小文字', 'country:jp, locality:大阪市'],
      ['先頭だけ大文字', 'country:Jp'],
      ['alpha-2 でない国名', 'country:Japan'],
      ['値が空', 'country:'],
    ])('%s', (_label, address) => {
      expect(findAddressFormatViolation(address)).toBe(
        'malformed_country_code',
      );
    });
  });
});
