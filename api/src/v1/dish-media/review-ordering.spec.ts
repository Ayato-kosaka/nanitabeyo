import { prioritizeReviewsByLanguage } from './review-ordering';

type TestReview = {
  id: string;
  original_language_code: string;
  created_at: Date;
};

/** created_at は id の順に 1 分ずつ古い→新しいで並ぶようにする */
const review = (id: string, lang: string, minute: number): TestReview => ({
  id,
  original_language_code: lang,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, minute)),
});

const ids = (reviews: TestReview[]) => reviews.map((r) => r.id);

// #817 レビュー欄は scrollToEnd で末尾へ着地するため、**配列の末尾が最も読まれる位置**。
// 期待値はすべて「優先度の低いものが先頭、高いものが末尾」で書く。

describe('prioritizeReviewsByLanguage', () => {
  const REVIEW_LIMIT = 6;

  it('優先指定が無ければ既定分をそのまま返す（従来動作の維持）', () => {
    const base = [review('a', 'en', 0), review('b', 'ja', 1)];

    expect(prioritizeReviewsByLanguage(base, [], [], REVIEW_LIMIT)).toEqual(
      base,
    );
  });

  it('優先言語のレビューを末尾（scrollToEnd の着地点）へ寄せる', () => {
    const base = [
      review('en1', 'en', 0),
      review('en2', 'en', 1),
      review('ja1', 'ja', 2),
      review('ja2', 'ja', 3),
    ];

    const result = prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT);

    expect(ids(result)).toEqual(['en1', 'en2', 'ja1', 'ja2']);
  });

  it('#817 UGC の ja-JP が端末言語 ja として優先される（回帰防止）', () => {
    // Google import の英語レビューが先に、ユーザーの日本語レビューが後に入っている状況
    const base = [
      review('google-en1', 'en', 0),
      review('google-en2', 'en', 1),
      review('ugc-ja1', 'ja-JP', 2),
      review('ugc-ja2', 'ja-JP', 3),
    ];

    const result = prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT);

    expect(ids(result)).toEqual([
      'google-en1',
      'google-en2',
      'ugc-ja1',
      'ugc-ja2',
    ]);
  });

  it('#817 UGC の ja-JP と Google の ja が同じ優先度になり created_at 順を保つ', () => {
    const base = [
      review('ugc-ja', 'ja-JP', 0),
      review('google-ja', 'ja', 1),
      review('google-en', 'en', 2),
    ];

    const result = prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT);

    expect(ids(result)).toEqual(['google-en', 'ugc-ja', 'google-ja']);
  });

  it('端末言語 → 検索地点言語 → その他 の3段優先が効く', () => {
    const base = [
      review('fr', 'fr', 0),
      review('ja', 'ja', 1),
      review('en', 'en', 2),
    ];

    // 端末が英語、検索地点が日本
    const result = prioritizeReviewsByLanguage(
      base,
      [],
      ['en', 'ja'],
      REVIEW_LIMIT,
    );

    expect(ids(result)).toEqual(['fr', 'ja', 'en']);
  });

  it('reviewLimit の外に埋もれた優先言語を先読み分から補充する', () => {
    // 既定クエリは created_at 昇順で 6 件しか取れず、日本語が入っていない
    const base = [
      review('en1', 'en', 0),
      review('en2', 'en', 1),
      review('en3', 'en', 2),
      review('en4', 'en', 3),
      review('en5', 'en', 4),
      review('en6', 'en', 5),
    ];
    // 優先言語の先読みクエリが 7 件目以降の日本語を拾ってくる
    const preferred = [review('ja1', 'ja', 100), review('ja2', 'ja', 101)];

    const result = prioritizeReviewsByLanguage(
      base,
      preferred,
      ['ja'],
      REVIEW_LIMIT,
    );

    expect(ids(result)).toEqual(['en1', 'en2', 'en3', 'en4', 'ja1', 'ja2']);
    expect(result).toHaveLength(REVIEW_LIMIT);
  });

  it('先読み分と既定分が重複しても二重表示しない', () => {
    const shared = review('ja1', 'ja', 0);
    const base = [shared, review('en1', 'en', 1)];
    const preferred = [shared];

    const result = prioritizeReviewsByLanguage(
      base,
      preferred,
      ['ja'],
      REVIEW_LIMIT,
    );

    expect(ids(result)).toEqual(['en1', 'ja1']);
  });

  it('優先言語が 0 件なら created_at 昇順のまま（#509 の並び順を維持）', () => {
    const base = [
      review('a', 'en', 0),
      review('b', 'en', 1),
      review('c', 'en', 2),
    ];

    const result = prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT);

    expect(ids(result)).toEqual(['a', 'b', 'c']);
  });

  it('全件が優先言語でも created_at 昇順が保たれる', () => {
    const base = [
      review('a', 'ja', 0),
      review('b', 'ja', 1),
      review('c', 'ja', 2),
    ];

    const result = prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT);

    expect(ids(result)).toEqual(['a', 'b', 'c']);
  });

  it('original_language_code が空文字なら最下位（＝先頭）へ落ちる', () => {
    const base = [review('unknown', '', 0), review('ja', 'ja', 1)];

    const result = prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT);

    expect(ids(result)).toEqual(['unknown', 'ja']);
  });

  it('reviewLimit より件数が少なくても切り詰めない', () => {
    const base = [review('a', 'ja', 0), review('b', 'en', 1)];

    expect(
      prioritizeReviewsByLanguage(base, [], ['ja'], REVIEW_LIMIT),
    ).toHaveLength(2);
  });

  it('返却件数は常に reviewLimit を超えない', () => {
    const base = Array.from({ length: 6 }, (_, i) => review(`en${i}`, 'en', i));
    const preferred = Array.from({ length: 6 }, (_, i) =>
      review(`ja${i}`, 'ja', 100 + i),
    );

    const result = prioritizeReviewsByLanguage(
      base,
      preferred,
      ['ja'],
      REVIEW_LIMIT,
    );

    expect(result).toHaveLength(REVIEW_LIMIT);
    expect(ids(result)).toEqual(['ja0', 'ja1', 'ja2', 'ja3', 'ja4', 'ja5']);
  });

  // #817 【回帰防止】並び順は UI の scrollToEnd と対になっている。
  // どちらか片方だけを反転させると、優先並び替えの効果が実機で消える。
  it('末尾が最優先・先頭が最下位という向きを固定する', () => {
    const base = [
      review('other', 'fr', 0),
      review('local', 'ja', 1),
      review('device', 'en', 2),
    ];

    // 端末が英語、検索地点が日本
    const result = prioritizeReviewsByLanguage(
      base,
      [],
      ['en', 'ja'],
      REVIEW_LIMIT,
    );

    // DishReviewsSection は mount 時に scrollToEnd するので、
    // 末尾（= 最初に目に入る位置）へ端末言語が来ていなければならない
    expect(result[result.length - 1].id).toBe('device');
    expect(result[0].id).toBe('other');
  });

  it('簡体と繁体を混同しない', () => {
    const base = [review('hant', 'zh-TW', 0), review('hans', 'zh-CN', 1)];

    const result = prioritizeReviewsByLanguage(
      base,
      [],
      ['zh-Hans'],
      REVIEW_LIMIT,
    );

    expect(ids(result)).toEqual(['hant', 'hans']);
  });
});
