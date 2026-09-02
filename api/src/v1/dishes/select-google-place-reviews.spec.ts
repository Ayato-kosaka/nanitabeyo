import { protos } from '@googlemaps/places';
import { selectGooglePlaceReviews } from './select-google-place-reviews';

type Review = protos.google.maps.places.v1.IReview;

const review = (text: string, languageCode: string, rating = 5): Review =>
  ({
    authorAttribution: { uri: `https://example.com/${text}` },
    originalText: { text, languageCode },
    rating,
  }) as Review;

const texts = (reviews: Review[]) =>
  reviews.map((r) => r.originalText?.text ?? '');

/**
 * #817 contextual と place の両方を候補にしつつ、保存件数は従来基準へ揃える。
 * ここが崩れると dish_reviews の行数と reviewCount が黙って増える。
 */
describe('selectGooglePlaceReviews', () => {
  it('preferred 言語のレビューを先頭へ寄せる', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [review('en1', 'en'), review('ja1', 'ja')],
      placeReviews: [],
      preferredLanguageCode: 'ja',
    });

    expect(texts(result)).toEqual(['ja1', 'en1']);
  });

  it('保存件数は従来基準（contextual の件数）を超えない', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [review('c1', 'en'), review('c2', 'en')],
      placeReviews: [
        review('p1', 'ja'),
        review('p2', 'ja'),
        review('p3', 'ja'),
      ],
      preferredLanguageCode: 'ja',
    });

    // union すると 5 件になるが、従来は contextual の 2 件しか保存していなかった
    expect(result).toHaveLength(2);
    expect(texts(result)).toEqual(['p1', 'p2']);
  });

  it('contextual が空なら place の件数が基準になる', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [],
      placeReviews: [review('p1', 'en'), review('p2', 'ja')],
      preferredLanguageCode: 'ja',
    });

    expect(result).toHaveLength(2);
    expect(texts(result)).toEqual(['p2', 'p1']);
  });

  it('両方空なら空配列を返す', () => {
    expect(
      selectGooglePlaceReviews({
        contextualReviews: [],
        placeReviews: [],
        preferredLanguageCode: 'ja',
      }),
    ).toEqual([]);
  });

  it('preferred 指定が無ければ contextual を優先する従来動作（#636）', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [review('c1', 'en')],
      placeReviews: [review('p1', 'ja')],
      preferredLanguageCode: undefined,
    });

    expect(texts(result)).toEqual(['c1']);
  });

  it('preferred 指定が無く contextual が空なら place へフォールバックする（#636）', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [],
      placeReviews: [review('p1', 'ja')],
      preferredLanguageCode: undefined,
    });

    expect(texts(result)).toEqual(['p1']);
  });

  it('同一レビューが両集合にあっても重複しない', () => {
    const shared = review('same', 'ja');

    const result = selectGooglePlaceReviews({
      contextualReviews: [shared, review('c2', 'en')],
      placeReviews: [shared, review('p1', 'ja')],
      preferredLanguageCode: 'ja',
    });

    expect(texts(result)).toEqual(['same', 'p1']);
  });

  it('UGC 形式の ja-JP も preferred として扱う', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [review('en1', 'en'), review('ja1', 'ja-JP')],
      placeReviews: [],
      preferredLanguageCode: 'ja',
    });

    expect(texts(result)).toEqual(['ja1', 'en1']);
  });

  it('中国語は簡体と繁体を混同しない', () => {
    const result = selectGooglePlaceReviews({
      contextualReviews: [review('hant', 'zh-TW'), review('hans', 'zh-CN')],
      placeReviews: [],
      preferredLanguageCode: 'zh-Hans',
    });

    expect(texts(result)).toEqual(['hans', 'hant']);
  });

  it('originalText が欠けたレビューでも例外を投げない', () => {
    const broken = { authorAttribution: { uri: 'x' }, rating: 4 } as Review;

    const result = selectGooglePlaceReviews({
      contextualReviews: [broken, review('ja1', 'ja')],
      placeReviews: [],
      preferredLanguageCode: 'ja',
    });

    expect(texts(result)).toEqual(['ja1', '']);
  });
});
