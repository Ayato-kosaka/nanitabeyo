/**
 * 🎠 候補カルーセルの見せ方（`react-native-reanimated-carousel` の `layout`）。
 *
 * #1156 v5 で `mode` / `modeConfig` から `layout` へ移った値をそのまま持つ。
 *
 * ## なぜ画面から出してあるのか（#1785）
 *
 * `parallax` は **アクティブなカードにも `scale` を掛ける**。つまり中央のカードの実測幅は
 * «中央カラム幅（native では画面幅）× scale» になり、左右にその差の半分ずつが空く。
 * これは #1629 で **オーナーが «直す必要はない» と確定した挙動**である
 * （`scale: 1` にした変更は差し戻し済み。commit 18df368e）。
 *
 * e2e（web / native の 2 本）はカードの実測幅を見るので、この値を知らないと期待値を書けない。
 * spec へ `0.9` を写経すると、値を変えたときに **テストだけが古い数字を守り続ける**。
 * そうならないよう、ここを唯一の正としてテストからも引く。
 *
 * ⚠️ **このファイルへ react / expo に依存するものを足さないこと。**
 * e2e-web / e2e-mobile が `@app-expo/*` で直接読む（それぞれの tsconfig の paths を参照）。
 */
export const DISH_CATEGORY_CAROUSEL_LAYOUT = {
	type: "parallax",
	scale: 0.9,
	offset: 100,
} as const;

/**
 * アクティブなカードの左右に空く余白の、**カード実測幅に対する比**。
 *
 * カードは `contentWidth` いっぱいに作られ（`useDishCategoryCardSize({ fullBleed: true })`）、
 * `parallax` が描画時に `scale` 倍する。したがって
 *
 *     余白（片側） = (contentWidth - contentWidth * scale) / 2
 *     実測幅       = contentWidth * scale
 *     比           = (1 - scale) / (2 * scale)
 *
 * #1212 が消したのは «カードの寸法そのものに入っていた左右 16px» であって、この比ではない。
 * 16px が戻ると比はこれより明確に大きくなるので、e2e はその差で再発を見分ける。
 */
export const DISH_CATEGORY_CARD_GUTTER_RATIO =
	(1 - DISH_CATEGORY_CAROUSEL_LAYOUT.scale) / (2 * DISH_CATEGORY_CAROUSEL_LAYOUT.scale);
