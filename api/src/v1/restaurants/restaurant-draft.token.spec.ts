// api/src/v1/restaurants/restaurant-draft.token.spec.ts
//
// #1671 下読みトークンの検証。
// **このトークンが破れると «ユーザーが値を書き換えたか» の検知が丸ごと嘘になる**ので、
// 署名・期限・形の 3 つを個別に落として、それぞれ null になることを確かめる。

import {
  COORDINATE_EQUALITY_EPSILON,
  RESTAURANT_DRAFT_TOKEN_TTL_MS,
  diffConfirmedRestaurantValues,
  signRestaurantDraftToken,
  verifyRestaurantDraftToken,
  type RestaurantDraftTokenPayload,
} from './restaurant-draft.token';

const SECRET = 'test-secret-value-for-restaurant-draft-token';
const NOW = 1_800_000_000_000;

const BASELINE: RestaurantDraftTokenPayload = {
  googlePlaceId: 'ChIJtest123',
  name: '牛たん炭焼 利久 仙台駅店',
  nameLanguageCode: 'ja',
  latitude: 38.26,
  longitude: 140.882,
  addressComponentsJson: '[{"longText":"宮城県"}]',
  plusCodeJson: '{"globalCode":"8RJ4744C+2X"}',
  address: '宮城県仙台市青葉区中央1-1-1',
  countryCode: 'JP',
};

describe('#1671 restaurant draft token', () => {
  describe('署名して復元する', () => {
    it('発行した内容がそのまま戻る', () => {
      const token = signRestaurantDraftToken(BASELINE, SECRET, NOW);
      expect(verifyRestaurantDraftToken(token, SECRET, NOW)).toEqual(BASELINE);
    });

    it('plusCode の無い店（null）も往復できる', () => {
      const payload = { ...BASELINE, plusCodeJson: null };
      const token = signRestaurantDraftToken(payload, SECRET, NOW);
      expect(verifyRestaurantDraftToken(token, SECRET, NOW)).toEqual(payload);
    });

    it('exp は payload に入るが、復元結果には現れない', () => {
      const token = signRestaurantDraftToken(BASELINE, SECRET, NOW);
      const decoded = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
      );
      expect(decoded.exp).toBe(NOW + RESTAURANT_DRAFT_TOKEN_TTL_MS);
      expect(verifyRestaurantDraftToken(token, SECRET, NOW)).not.toHaveProperty(
        'exp',
      );
    });
  });

  describe('受け付けてはいけないもの', () => {
    it('別の鍵で署名されたトークンは通さない', () => {
      const token = signRestaurantDraftToken(BASELINE, 'another-secret', NOW);
      expect(verifyRestaurantDraftToken(token, SECRET, NOW)).toBeNull();
    });

    it('⚠️ payload を差し替えて署名を使い回したトークンは通さない（改ざん検知の要）', () => {
      const token = signRestaurantDraftToken(BASELINE, SECRET, NOW);
      const [prefix, , signature] = token.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          ...BASELINE,
          name: '攻撃者が入れた名前',
          exp: NOW + RESTAURANT_DRAFT_TOKEN_TTL_MS,
        }),
        'utf8',
      ).toString('base64url');

      expect(
        verifyRestaurantDraftToken(
          `${prefix}.${forged}.${signature}`,
          SECRET,
          NOW,
        ),
      ).toBeNull();
    });

    it('期限が切れていたら通さない', () => {
      const token = signRestaurantDraftToken(BASELINE, SECRET, NOW);
      expect(
        verifyRestaurantDraftToken(
          token,
          SECRET,
          NOW + RESTAURANT_DRAFT_TOKEN_TTL_MS,
        ),
      ).toBeNull();
    });

    it('期限ちょうどの 1ms 前なら通る', () => {
      const token = signRestaurantDraftToken(BASELINE, SECRET, NOW);
      expect(
        verifyRestaurantDraftToken(
          token,
          SECRET,
          NOW + RESTAURANT_DRAFT_TOKEN_TTL_MS - 1,
        ),
      ).not.toBeNull();
    });

    it('他用途のトークン（prefix 違い）は通さない', () => {
      const token = signRestaurantDraftToken(BASELINE, SECRET, NOW);
      const [, payloadB64, signature] = token.split('.');
      expect(
        verifyRestaurantDraftToken(
          `met1.${payloadB64}.${signature}`,
          SECRET,
          NOW,
        ),
      ).toBeNull();
    });

    it.each([
      ['形が壊れている', 'not-a-token'],
      ['区切りが足りない', 'rdt1.only-two-parts'],
      ['空文字', ''],
    ])('%s → null', (_label, token) => {
      expect(verifyRestaurantDraftToken(token, SECRET, NOW)).toBeNull();
    });

    it('必須項目が欠けた payload は、正しく署名されていても通さない', () => {
      // 署名は本物にするため、この payload をこの鍵で署名し直す
      const broken = { ...BASELINE, latitude: 'not-a-number' };
      const payloadB64 = Buffer.from(
        JSON.stringify({ ...broken, exp: NOW + 1000 }),
        'utf8',
      ).toString('base64url');
      const { createHmac } = require('node:crypto');
      const signature = createHmac('sha256', SECRET)
        .update(`nanitabeyo.restaurant-draft-token.v1.${payloadB64}`, 'utf8')
        .digest('base64url');

      expect(
        verifyRestaurantDraftToken(
          `rdt1.${payloadB64}.${signature}`,
          SECRET,
          NOW,
        ),
      ).toBeNull();
    });
  });

  describe('既定値と確定値の差分', () => {
    it('そのまま確認しただけなら、何も変わっていない', () => {
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: BASELINE.name,
          latitude: BASELINE.latitude,
          longitude: BASELINE.longitude,
          address: BASELINE.address,
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual([]);
    });

    it('店名を直したら name が挙がる', () => {
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: '牛たん利久 仙台駅店',
          latitude: BASELINE.latitude,
          longitude: BASELINE.longitude,
          address: BASELINE.address,
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual(['name']);
    });

    it('座標を動かしたら latitude / longitude が挙がる', () => {
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: BASELINE.name,
          latitude: BASELINE.latitude + 0.001,
          longitude: BASELINE.longitude - 0.001,
          address: BASELINE.address,
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual(['latitude', 'longitude']);
    });

    it('⚠️ float の往復で出る程度のずれは «書き換え» にしない', () => {
      // ここを 0 にすると、書き換えていない端末まで «書き換えた» と記録され、
      // #1827 で見るべき信号が埋もれる
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: BASELINE.name,
          latitude: BASELINE.latitude + COORDINATE_EQUALITY_EPSILON / 2,
          longitude: BASELINE.longitude,
          address: BASELINE.address,
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual([]);
    });

    it('閾値ちょうどのずれは «書き換え» として拾う', () => {
      // ⚠️ 基準を 0 にしているのは float の都合である。38.26 のような値へ 1e-6 を足すと、
      //    仮数部の丸めで «ちょうど 1e-6» にならず、この境界を素直に書けない
      //    （最初この形で書いて落ちた）。境界の判定そのものは 0 起点で確かめられる。
      const atZero = { ...BASELINE, latitude: 0 };
      expect(
        diffConfirmedRestaurantValues(atZero, {
          name: atZero.name,
          latitude: COORDINATE_EQUALITY_EPSILON,
          longitude: atZero.longitude,
          address: BASELINE.address,
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual(['latitude']);
    });

    it('住所を直したら address が挙がる', () => {
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: BASELINE.name,
          latitude: BASELINE.latitude,
          longitude: BASELINE.longitude,
          address: '宮城県仙台市青葉区中央1-1-2',
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual(['address']);
    });

    it('国を直したら countryCode が挙がる', () => {
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: BASELINE.name,
          latitude: BASELINE.latitude,
          longitude: BASELINE.longitude,
          address: BASELINE.address,
          countryCode: 'US',
        }),
      ).toEqual(['countryCode']);
    });

    it('人が動かした程度（約 1m）のずれは確実に拾う', () => {
      expect(
        diffConfirmedRestaurantValues(BASELINE, {
          name: BASELINE.name,
          latitude: BASELINE.latitude + 1e-5,
          longitude: BASELINE.longitude,
          address: BASELINE.address,
          countryCode: BASELINE.countryCode,
        }),
      ).toEqual(['latitude']);
    });
  });
});
