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

    labels[言語] → labels["en"] → （出さない）

## #1629 `dishes.name` へは落とさない（オーナー確定）

> dishes.name を使うのではなく、dish_categories から locale で引いて欲しい。
> dishes.name は廃止にしても良いカラムだと思っています。

以前は最後に `dishes.name` へ落としていた。«何も出ないより店での呼び名» という判断だったが、
実際には次の 2 つを生んでいた。

- 取り込み由来の行で «udon» のようなローマ字が日本語 UI に出る
- `dishes.name` が **空**の行では «空文字» が «表示名» として下流へ流れ、
  料理カテゴリー欄が空欄のまま投稿ボタンが押せなくなる（#1629 の行き止まり）

料理カテゴリーの表記は `dish_categories` が正であり、`dishes.name` は «その店での呼び名» と
いう別物である。**表示名の解決に混ぜない。** 表記が 1 つも無ければ `null` を返し、
呼び出し側が «出さない / 候補にしない» を選ぶ。

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
 * ⚠️ **`dishes.name` を渡さないこと**（引数にも無い）。理由はファイル冒頭の #1629 の節。
 *
 * @param labels `dish_categories.labels`（言語コード → 表記）
 * @param locale `"ja-JP"` のようなロケール
 * @returns 表記が 1 つも無ければ `null`（呼び出し側が «出さない» を選ぶ）
 */
export function resolveDishCategoryLabel(
	labels: Record<string, string> | null | undefined,
	locale: string | null | undefined,
): string | null {
	const lang = toLanguageCode(locale);
	const localized = labels?.[lang];
	if (localized) return localized;
	const english = labels?.en;
	if (english) return english;
	return null;
}

/** `MyDishItem` から直接引くための薄い包み */
export const dishCategoryLabelOf = (
	item: Pick<MyDishItem, "dish">,
	locale: string | null | undefined,
): string | null => resolveDishCategoryLabel(item.dish.categoryLabels, locale);
