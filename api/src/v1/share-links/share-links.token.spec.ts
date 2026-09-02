// api/src/v1/share-links/share-links.token.spec.ts
//
// #721 共有トークンが「推測できないこと」と「DB に生で残らないこと」を固定する。

import { createHash } from 'node:crypto';
import {
  generateShareToken,
  isValidShareTokenShape,
  toShareTokenDigest,
} from './share-links.token';
import {
  SHARE_LINK_TOKEN_PREFIX,
  SHARE_LINK_TOKEN_RANDOM_BYTES,
} from '@shared/v1/constants/shareLinks';

describe('#721 共有トークン', () => {
  it('生成したトークンは s1_ 始まりで、形の検証を通る', () => {
    const token = generateShareToken();

    expect(token.startsWith(SHARE_LINK_TOKEN_PREFIX)).toBe(true);
    expect(isValidShareTokenShape(token)).toBe(true);
  });

  it('ランダム部が 128bit ある（base64url なので 22 文字）', () => {
    const body = generateShareToken().slice(SHARE_LINK_TOKEN_PREFIX.length);

    // 16 bytes を base64url にすると padding 無しで 22 文字。
    // ここが短くなる変更が入ると総当たりの前提が崩れるので、桁で固定する
    expect(body).toHaveLength(Math.ceil((SHARE_LINK_TOKEN_RANDOM_BYTES * 8) / 6));
    // base64url の文字種のみ（`+` `/` `=` が混ざると URL で壊れる）
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  // 「ランダムに見える」ではなく「重複しない」を見る。
  // 実装が固定値やカウンタへ退化したら、この件数で必ず落ちる
  it('1000 本生成しても 1 本も重複しない', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateShareToken()));

    expect(tokens.size).toBe(1000);
  });

  it('digest は生トークンを含まない sha256 で、同じ入力には同じ値を返す', () => {
    const token = generateShareToken();

    const digest = toShareTokenDigest(token);

    expect(digest).toEqual(createHash('sha256').update(token, 'utf8').digest());
    expect(digest).toHaveLength(32);
    // DB へ保存されるのはこの値。生トークンが復元できないことが要件
    expect(digest.toString('utf8')).not.toContain(token);
  });

  // ⚠️ server secret を混ぜると、ローテーション時に SNS 上の共有リンクが全滅する。
  // 「環境変数に依存せず、同じ token なら常に同じ digest」であることを固定しておく
  it('digest は環境変数に依存しない（secret を混ぜていない）', () => {
    const token = 's1_0123456789abcdefghijkl';

    expect(toShareTokenDigest(token).toString('hex')).toBe(
      createHash('sha256').update(token, 'utf8').digest('hex'),
    );
  });

  describe('形の検証', () => {
    it.each([
      ['prefix が無い', '0123456789abcdefghijkl'],
      ['別世代の prefix', 's2_0123456789abcdefghijkl'],
      ['短すぎる', 's1_abc'],
      ['base64url に無い文字', 's1_0123456789abcdefghij+/'],
      ['空', ''],
      ['パス区切りを含む', 's1_0123456789abcdef/../x'],
    ])('%s → 弾く', (_label, token) => {
      expect(isValidShareTokenShape(token)).toBe(false);
    });
  });
});
