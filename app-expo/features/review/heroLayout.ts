// #1087 【設計】レビュータブのヒーロー画像の「表示レイアウト」を、画面本体（review/index.tsx）と
// 先読み側（ReviewHeroPreload）の両方から参照できる形で切り出す。
//
// なぜ共有するのか:
//   先読みの狙いは「表示時とまったく同じ要求サイズでデコードさせ、キャッシュを共有させる」こと。
//   Android(Glide) はデコード要求サイズがメモリキャッシュキー(EngineKey)に入るため、
//   先読み側と表示側で要求サイズがズレると別エントリになりデコードし直しになる。
//   ヒーローの表示サイズは flex 配分（title:hero:cta = 1:2:1）と画面サイズだけで決まるので、
//   この比率と画像そのもの・contentFit をここに集約し、片方だけ変わって静かにズレるのを防ぐ。
//
// また contentFit はキャッシュキーには入らない（expo-image の CustomDownsampleStrategy は
// hashCode/equals を固定値にしている）が、デコード後のビットマップ解像度は contentFit で変わる。
// 先読み側と表示側で contentFit が食い違うと「キーは一致するが解像度が違う絵」を掴んでしまうため、
// ここを共有して必ず一致させる。

export const REVIEW_HERO_IMAGE = require("./assets/review-hero.webp");

export const REVIEW_HERO_CONTENT_FIT = "contain" as const;

/** レビュータブのルート（SafeAreaView の内側）を縦に分け合う flex 配分 */
export const REVIEW_HERO_FLEX = {
	title: 1,
	hero: 2,
	cta: 1,
} as const;
