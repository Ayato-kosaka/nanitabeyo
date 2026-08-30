/**
 * マイページ由来のリストが `useDishMediaEntriesStore` で使う «用途キー»。
 *
 * #1402 【設計】`profileSavedPostsEntriesKey` はもともと features/profile/tabs/SavedPostsTab.tsx
 * （「保存した投稿」グリッド）が持っていた。4 グリッドタブの廃止でそのタブは無くなったが、
 * **キーそのものは残す**。保存/解除の楽観更新（features/dishMedia/components/ActionButtons.tsx）が
 * このキーのリストを書き換えており、`dish_media` に対する save reaction の一覧は
 * 親 #1375 の「食べたい」タブがそのまま引き継ぐ対象だからである。
 *
 * ⚠️ 現時点でこのキーを **読む** 画面は無い（書き込みだけが生きている）。
 * 「食べたい」タブを実装するときは、新しいキーを増やす前にここを使えないか確認すること。
 */
export const profileSavedPostsEntriesKey = "profileSavedPosts";
