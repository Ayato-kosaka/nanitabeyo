/**
 * #1397 (PR4/5) my-dishes の全画面 Feed 用の `entriesKey`（設計 (2/2) §9-2 / (1/2) §4）。
 *
 * 様式は `features/map/constants.ts` の `mapReviewsKey` と揃える。
 *
 * ⚠️ **`mapReviews-<uuid>`（店舗フィード = 全ユーザーのメディア）とは別名であること。**
 * 同じ名前にすると、my-dishes の Feed を閉じたときの `clearByKey` が店舗フィードの
 * キャッシュを消し、店舗詳細のレビュータブが取り直しになる。名前を分けているので
 * 店舗フィードのキャッシュには一切触れない（`clearByKey` の GC は他キーから参照されている
 * エントリを残す実装なので、両方が同じメディアを持っていても消し合わない）。
 */
export const myDishesFeedKey = (restaurantId: string) => `myDishesFeed-${restaurantId}`;
