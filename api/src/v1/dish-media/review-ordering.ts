import { languagePriorityRank } from '../../../../shared/utils/languageCode';

/**
 * #817 【設計】優先言語のレビューを「最も読まれる位置」へ寄せる。
 *
 * フィルタではなく並び替えなので、優先言語が 0 件でも従来どおり reviewLimit 件を返す。
 * これにより `reviewCount` / `averageRating`（全件集計）との整合が崩れない。
 *
 * 【重要】優先言語は配列の *末尾* へ置く。
 *
 * レビュー欄は画面下部に固定され、`DishReviewsSection` が mount 時に `scrollToEnd` する。
 * レビューは `created_at` 昇順（#509「古い→新しい」）で、最新が最下部に来る——
 * つまり **プライム位置は先頭ではなく末尾** である。グラデーションも下ほど濃く、
 * 下端のほうが可読性が高い。
 *
 * ここを「先頭へ寄せる」と、scrollToEnd の着地点である末尾には
 * 最も読めない言語のレビューが並び、優先並び替えの効果が実機で反転する。
 *
 * 選別（どのレビューを残すか）は優先度の高い順で行い、
 * 表示順（並び）だけを反転させる。
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

  const ranked = [...candidates.values()].map((review) => ({
    review,
    rank: languagePriorityRank(
      review.original_language_code,
      preferredLanguageCodes,
    ),
  }));

  // 選別: 優先度の高い順に reviewLimit 件を残す
  const selected = [...ranked]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.review.created_at.getTime() - b.review.created_at.getTime(),
    )
    .slice(0, reviewLimit);

  // 表示順: 優先度の低いものが先頭、高いものが末尾（= scrollToEnd の着地点）。
  // 同一優先度の中では created_at 昇順を保つので、各グループの最新が
  // そのグループの最下部に来る（#509 の並び順を踏襲）。
  return selected
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        a.review.created_at.getTime() - b.review.created_at.getTime(),
    )
    .map(({ review }) => review);
}
