import type { MyDishItem } from "@shared/api/v1/res";

/*
#1375（オーナー実機指摘）**「うどんで絞ったら `udon` が出る」への対処。**

## 何が起きていたか

料理の表示名に `dish.name` だけを使っていた。これは **«その店でのその料理の呼び名»** で、
`dishes` テーブルに店ごとに入る値である。SNS 取り込み経由で作られた行では、
取り込み元のキャプションから拾った語がそのまま入るため、`udon` のように
ローマ字や英語になることがある。日本語 UI の中にそれが混ざって出ていた。

## どう直すか

`dish_categories.labels`（言語コード → 表記）を API が一緒に返すようにし、
**ユーザーの言語の表記を優先**する。

    labels[言語] → labels["en"] → name

`name` を最後に残すのは、カテゴリに表記が 1 つも無いとき（新しく作られた直後など）に
**何も出ないより店での呼び名が出た方がよい**ためである。
逆に `name` を先に見ると、正式表記があるのにローマ字が優先されて元の症状へ戻る。

⚠️ **`labels` を «無ければ QID» に落とさないこと。** カテゴリ id は Wikidata の QID で、
ユーザーに見せる文字列ではない（`MyDishesFeedChips` / `categoryFacets` と同じ規則）。
*/

/**
 * `"ja-JP"` → `"ja"`。API の labels は言語コード（地域なし）で入っている。
 *
 * ⚠️ **`locale` が未設定でも投げないこと。** ここは描画中に呼ばれるので、
 * 投げると画面ごと落ちる（`i18n.locale` がまだ入っていない瞬間が実在する）。
 */
export const toLanguageCode = (locale: string | null | undefined): string =>
	typeof locale === "string" && locale.length > 0 ? locale.split("-")[0] : "";

/**
 * 料理カテゴリの表示名を決める。
 *
 * @param labels `dish_categories.labels`（言語コード → 表記）
 * @param fallbackName その店でのその料理の呼び名（`dishes.name`）
 * @param locale `"ja-JP"` のようなロケール
 */
export function resolveDishCategoryLabel(
	labels: Record<string, string> | null | undefined,
	fallbackName: string | null | undefined,
	locale: string | null | undefined,
): string | null {
	const lang = toLanguageCode(locale);
	const localized = labels?.[lang];
	if (localized) return localized;
	const english = labels?.en;
	if (english) return english;
	return fallbackName || null;
}

/** `MyDishItem` から直接引くための薄い包み */
export const dishCategoryLabelOf = (
	item: Pick<MyDishItem, "dish">,
	locale: string | null | undefined,
): string | null =>
	resolveDishCategoryLabel(item.dish.categoryLabels, item.dish.name, locale);
