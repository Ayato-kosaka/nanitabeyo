import {
  buildGoogleImportDishMediaId,
  buildGoogleImportDishReviewId,
  uuidV5,
} from './deterministic-id';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * #829 【回帰防止】bulk-import を跨いだ dish_reviews の重複。
 *
 * preflight lookup は DB を読むが、その行を書くのは非同期の Cloud Tasks handler。
 * 1本目の handler が commit する前に2本目の bulk-import が走ると、どちらも
 * 「既存なし」と判定する。ID がリクエストごとに変わると、この窓で
 * dish_reviews が二重登録され reviewCount / averageRating が水増しされる。
 *
 * ここが壊れると、その事故が静かに再発する。
 */
describe('Google import の決定論的 ID', () => {
  const PLACE_ID = 'ChIJSzZlDRONGGARkKzJf-PF4m4';
  const CATEGORY_ID = 'ramen';

  describe('uuidV5', () => {
    it('RFC 4122 の v5 形式になる', () => {
      expect(uuidV5('name', '8f2b1c94-4d7e-5a13-9c60-2e4f8a1b3d57')).toMatch(
        UUID_RE,
      );
    });

    it('同じ入力からは常に同じ値が出る', () => {
      const ns = '8f2b1c94-4d7e-5a13-9c60-2e4f8a1b3d57';

      expect(uuidV5('a', ns)).toBe(uuidV5('a', ns));
    });

    it('名前が違えば別の値になる', () => {
      const ns = '8f2b1c94-4d7e-5a13-9c60-2e4f8a1b3d57';

      expect(uuidV5('a', ns)).not.toBe(uuidV5('b', ns));
    });

    it('名前空間が違えば別の値になる', () => {
      expect(uuidV5('a', '8f2b1c94-4d7e-5a13-9c60-2e4f8a1b3d57')).not.toBe(
        uuidV5('a', 'b41d7e26-9a83-5f04-8d15-6c9e2b7a4f80'),
      );
    });
  });

  describe('uuidV5 の名前空間検証', () => {
    it.each([
      'not-a-uuid',
      '',
      '8f2b1c94',
      'zzzzzzzz-4d7e-5a13-9c60-2e4f8a1b3d57',
    ])('不正な名前空間 %p は例外になる（黙って短いハッシュにしない）', (ns) => {
      expect(() => uuidV5('name', ns)).toThrow(/Invalid UUID namespace/);
    });
  });

  describe('buildGoogleImportDishMediaId', () => {
    it('同じ place + category なら、別リクエストでも同じ ID になる', () => {
      // これが等しくないと、レースした2本の bulk-import が別 row を作る
      expect(buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID)).toBe(
        buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID),
      );
    });

    it('category が違えば別 ID になる', () => {
      expect(buildGoogleImportDishMediaId(PLACE_ID, 'ramen')).not.toBe(
        buildGoogleImportDishMediaId(PLACE_ID, 'sushi'),
      );
    });

    it('place が違えば別 ID になる', () => {
      expect(buildGoogleImportDishMediaId('place-a', CATEGORY_ID)).not.toBe(
        buildGoogleImportDishMediaId('place-b', CATEGORY_ID),
      );
    });

    it('UUID として妥当な形式になる', () => {
      expect(buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID)).toMatch(
        UUID_RE,
      );
    });

    it('区切り文字の取り違えで衝突しない', () => {
      // "a:b" + "c" と "a" + "b:c" が同じにならないこと
      expect(buildGoogleImportDishMediaId('a:b', 'c')).not.toBe(
        buildGoogleImportDishMediaId('a', 'b:c'),
      );
    });
  });

  describe('buildGoogleImportDishReviewId', () => {
    const build = (
      comment: string,
      author = 'https://example.com/u1',
      rating = 5,
    ) =>
      buildGoogleImportDishReviewId(
        PLACE_ID,
        CATEGORY_ID,
        comment,
        author,
        rating,
      );

    it('同じレビューは、別リクエストでも同じ ID になる', () => {
      expect(build('美味しかった')).toBe(build('美味しかった'));
    });

    it('本文が違えば別 ID になる', () => {
      expect(build('美味しかった')).not.toBe(build('普通だった'));
    });

    it('投稿者が違えば別 ID になる（同じ本文でも別レビュー）', () => {
      expect(build('美味しい', 'https://example.com/u1')).not.toBe(
        build('美味しい', 'https://example.com/u2'),
      );
    });

    it('Google が返す並び順が変わっても ID は変わらない', () => {
      // index ベースだとここで破綻する
      const reviews = ['一番目', '二番目', '三番目'];
      const shuffled = ['三番目', '一番目', '二番目'];

      expect(new Set(reviews.map((r) => build(r)))).toEqual(
        new Set(shuffled.map((r) => build(r))),
      );
    });

    it('dish_media の名前空間と衝突しない', () => {
      expect(
        buildGoogleImportDishReviewId(PLACE_ID, CATEGORY_ID, '', '', 0),
      ).not.toBe(buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID));
    });

    it('本文も投稿者も空な「評価のみ」のレビューを rating で区別する', () => {
      // rating がキーに無いと、この 2 件が同一 ID に潰れて件数がズレる
      expect(build('', '', 5)).not.toBe(build('', '', 1));
    });

    it('本文が空でも UUID として妥当', () => {
      expect(build('')).toMatch(UUID_RE);
    });
  });

  describe('レース時の重複防止（#829 の本質）', () => {
    it('DB を読めていない2本の bulk-import が同じ ID 集合を生成する', () => {
      const googleReviews = [
        { text: 'レビュー1', author: 'https://example.com/a', rating: 5 },
        { text: 'レビュー2', author: 'https://example.com/b', rating: 4 },
      ];

      const buildIds = () => ({
        mediaId: buildGoogleImportDishMediaId(PLACE_ID, CATEGORY_ID),
        reviewIds: googleReviews.map((r) =>
          buildGoogleImportDishReviewId(
            PLACE_ID,
            CATEGORY_ID,
            r.text,
            r.author,
            r.rating,
          ),
        ),
      });

      // 1本目: preflight lookup は「既存なし」
      const first = buildIds();
      // 2本目: 1本目の handler がまだ commit していないので、やはり「既存なし」
      const second = buildIds();

      // ID が一致するので upsert / skipDuplicates がクロスリクエストでも効く
      expect(second.mediaId).toBe(first.mediaId);
      expect(second.reviewIds).toEqual(first.reviewIds);
    });
  });
});
