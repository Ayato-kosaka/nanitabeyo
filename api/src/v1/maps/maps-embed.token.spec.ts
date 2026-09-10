// api/src/v1/maps/maps-embed.token.spec.ts
//
// #1810 PL レビュー 2番: 短命トークンの sign/verify を検証する。
// - 正しいトークンは検証を通る
// - 署名の不一致・期限切れ・形の壊れたトークンは弾く
// - 秘密鍵が違えば検証を通らない（鍵の使い回しではなく、値そのものが検証に効いていることの確認）

import 'reflect-metadata';
import {
  MAPS_EMBED_TOKEN_TTL_MS,
  signMapsEmbedToken,
  verifyMapsEmbedToken,
  type MapsEmbedTokenPayload,
} from './maps-embed.token';

const SECRET = 'test-hmac-secret';
const NOW = 1_700_000_000_000;

const PAYLOAD: MapsEmbedTokenPayload = {
  mode: 'search',
  q: 'ラーメン 渋谷',
  center: '35.6,139.7',
  zoom: 15,
  hl: 'ja',
};

describe('#1810 maps embed token', () => {
  it('正しいトークンは payload をそのまま復元できる', () => {
    const token = signMapsEmbedToken(PAYLOAD, SECRET, NOW);

    const verified = verifyMapsEmbedToken(token, SECRET, NOW);

    expect(verified).toEqual(PAYLOAD);
  });

  it('center/zoom/hl を省略しても発行・検証できる', () => {
    const minimal: MapsEmbedTokenPayload = {
      mode: 'place',
      q: 'place_id:ChIJplace1',
    };
    const token = signMapsEmbedToken(minimal, SECRET, NOW);

    expect(verifyMapsEmbedToken(token, SECRET, NOW)).toEqual(minimal);
  });

  it('有効期限内（TTL 直前）は通る', () => {
    const token = signMapsEmbedToken(PAYLOAD, SECRET, NOW);

    expect(
      verifyMapsEmbedToken(token, SECRET, NOW + MAPS_EMBED_TOKEN_TTL_MS - 1),
    ).not.toBeNull();
  });

  it('有効期限を過ぎたトークンは null', () => {
    const token = signMapsEmbedToken(PAYLOAD, SECRET, NOW);

    expect(
      verifyMapsEmbedToken(token, SECRET, NOW + MAPS_EMBED_TOKEN_TTL_MS),
    ).toBeNull();
    expect(
      verifyMapsEmbedToken(token, SECRET, NOW + MAPS_EMBED_TOKEN_TTL_MS + 1),
    ).toBeNull();
  });

  it('署名を 1 文字でも書き換えたら null', () => {
    const token = signMapsEmbedToken(PAYLOAD, SECRET, NOW);
    const [prefix, payloadB64, signature] = token.split('.');
    const tampered = `${prefix}.${payloadB64}.${signature.slice(0, -1)}${signature.at(-1) === 'a' ? 'b' : 'a'}`;

    expect(verifyMapsEmbedToken(tampered, SECRET, NOW)).toBeNull();
  });

  it('payload を書き換えて署名が追従していなければ null（例: mode を差し替えるなりすまし）', () => {
    const token = signMapsEmbedToken(PAYLOAD, SECRET, NOW);
    const [prefix, payloadB64, signature] = token.split('.');
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );
    const tamperedPayloadB64 = Buffer.from(
      JSON.stringify({ ...decoded, q: 'place_id:ChIJdifferent' }),
      'utf8',
    ).toString('base64url');
    const tampered = `${prefix}.${tamperedPayloadB64}.${signature}`;

    expect(verifyMapsEmbedToken(tampered, SECRET, NOW)).toBeNull();
  });

  it('違う秘密鍵で発行されたトークンは検証を通らない', () => {
    const token = signMapsEmbedToken(PAYLOAD, SECRET, NOW);

    expect(verifyMapsEmbedToken(token, 'different-secret', NOW)).toBeNull();
  });

  it.each([
    ['空文字', ''],
    ['ドット区切りが足りない', 'met1.abc'],
    ['ドット区切りが多すぎる', 'met1.abc.def.ghi'],
    ['prefix が別世代', 'met2.abc.def'],
    ['base64 が JSON にならない', 'met1.###.sig'],
  ])('形が壊れたトークン（%s）は null', (_label, token) => {
    expect(verifyMapsEmbedToken(token, SECRET, NOW)).toBeNull();
  });

  it('必須キー（q）が欠けた payload は、正しい鍵の署名でも shape チェックで弾く', () => {
    const token = signMapsEmbedToken(
      { mode: 'search' } as unknown as MapsEmbedTokenPayload,
      SECRET,
      NOW,
    );

    expect(verifyMapsEmbedToken(token, SECRET, NOW)).toBeNull();
  });

  it('mode が MAPS_EMBED_MODES に無い値なら、正しい鍵の署名でも shape チェックで弾く', () => {
    const token = signMapsEmbedToken(
      { mode: 'directions', q: 'ramen' } as unknown as MapsEmbedTokenPayload,
      SECRET,
      NOW,
    );

    expect(verifyMapsEmbedToken(token, SECRET, NOW)).toBeNull();
  });
});
