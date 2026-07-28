import { languagePriorityRank } from '../../../../shared/utils/languageCode';

/**
 * #817 【設計】優先言語のレビューを上位へ寄せる。
 *
 * フィルタではなく並び替えなので、優先言語が 0 件でも従来どおり reviewLimit 件を返す。
 * これにより `reviewCount` / `averageRating`（全件集計）との整合が崩れない。
 *
 * 優先順位は `preferredLanguageCodes` の並び順（端末言語 → 検索地点の言語 → その他）。
 * 同一優先度の中では `created_at` 昇順を維持する（#509）。
 *
 * @param baseReviews        既定クエリで取得した最古 reviewLimit 件
 * @param preferredReviews   優先言語で先読みした最大 reviewLimit 件（重複可）
 */
export function prioritizeReviewsByLanguage<
  T extends { id: string; original_language_code: string; created_at: Date },
>(
  baseReviews: T[],
  preferredReviews: T[],
  preferredLanguageCodes: string[],
  reviewLimit: number,
): T[] {
  if (preferredLanguageCodes.length === 0) {
    return baseReviews.slice(0, reviewLimit);
  }

  // 既定分と優先言語分を id で重複排除して 1 つの候補集合にする
  const candidates = new Map<string, T>();
  for (const review of [...preferredReviews, ...baseReviews]) {
    if (!candidates.has(review.id)) candidates.set(review.id, review);
  }

  return [...candidates.values()]
    .map((review) => ({
      review,
      rank: languagePriorityRank(
        review.original_language_code,
        preferredLanguageCodes,
      ),
    }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.review.created_at.getTime() - b.review.created_at.getTime(),
    )
    .slice(0, reviewLimit)
    .map(({ review }) => review);
}
