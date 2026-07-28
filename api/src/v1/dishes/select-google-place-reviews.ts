import { protos } from '@googlemaps/places';
import {
  languagePriorityRank,
  normalizePreferredLanguageCodes,
} from '../../../../shared/utils/languageCode';

/**
 * #817 【設計】Google Places の contextualContents.reviews と place.reviews の両方を候補にし、
 * preferred language のレビューを先頭へ寄せる。
 *
 * 保存件数は従来と同じ「どちらか一方の件数」に揃える。両集合を union して全件保存すると
 * dish_reviews の行数と reviewCount が従来より増えてしまうため、並び替えの効果だけを取る。
 */
export function selectGooglePlaceReviews(params: {
  contextualReviews: protos.google.maps.places.v1.IReview[];
  placeReviews: protos.google.maps.places.v1.IReview[];
  preferredLanguageCode?: string;
}): protos.google.maps.places.v1.IReview[] {
  const preferredCodes = normalizePreferredLanguageCodes([
    params.preferredLanguageCode,
  ]);
  const contextualReviews = params.contextualReviews ?? [];
  const placeReviews = params.placeReviews ?? [];

  // #636 【設計】contextual を優先し、空なら place にフォールバックする件数基準は維持する
  const baseCount =
    contextualReviews.length > 0
      ? contextualReviews.length
      : placeReviews.length;

  if (preferredCodes.length === 0 || baseCount === 0) {
    return contextualReviews.length > 0 ? contextualReviews : placeReviews;
  }

  // publishTime は field mask で要求していないため、キーには使えない。
  // 投稿者 uri + 本文 + rating で同一レビューを一意に識別する。
  const reviewKey = (review: protos.google.maps.places.v1.IReview) =>
    [
      review.authorAttribution?.uri ?? '',
      review.originalText?.languageCode ?? '',
      review.originalText?.text ?? '',
      review.rating ?? '',
    ].join('|');

  const merged = new Map<string, protos.google.maps.places.v1.IReview>();
  for (const review of [...contextualReviews, ...placeReviews]) {
    // Map は初回挿入順を保つので contextual 優先の並びが維持される
    if (!merged.has(reviewKey(review))) merged.set(reviewKey(review), review);
  }

  const ordered = Array.from(merged.values());
  const preferred = ordered.filter(
    (review) =>
      languagePriorityRank(review.originalText?.languageCode, preferredCodes) <
      preferredCodes.length,
  );
  const fallback = ordered.filter(
    (review) =>
      languagePriorityRank(review.originalText?.languageCode, preferredCodes) >=
      preferredCodes.length,
  );

  return [...preferred, ...fallback].slice(0, baseCount);
}
