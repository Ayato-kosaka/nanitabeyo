/*
#1273 画像フォールバックの «次の候補へ落ちるかどうか» を 1 箇所で決める。

## 何が起きていたか

サムネイルは «自前 → provider → 料理カテゴリの絵 → 店の絵» と順に落ちる。どの実装も
`??` で書かれていたが、**この列の材料は «無ければ空文字» で来る**。

| 列 | 定義 | «無い» の表し方 |
| --- | --- | --- |
| `dish_categories.image_url` | `20250802T0258_create_dish_categories.sql:6` **NOT NULL** | `''`（`9_1_sync_dish_categories.py` の `COALESCE(rep.image_url, '')`） |
| `restaurants.image_url` | `20250802T0300_create_restaurants.sql:14` **NOT NULL** | `''`（#1793 以降は全件。BigQuery 実測 620,428/620,428） |

`??` は `null` / `undefined` しか拾わないので、**空文字はそのまま «候補が見つかった» と
して先へ通る**。結果、次の候補があっても落ちずに «空の URL» が画面まで届く。

実測（dev / 2026-09-05。`scripts/db-checks/measure_delivered_but_invisible.py`）:
usable な dish_media 145,392 行のうち **3,119 行（2.15%）** が 3 段とも空で、
そのまま全画面フィードの真っ黒なセルになっていた。

## 使い方

    firstNonEmptyUrl(stored, providerUrl, categoryImage, restaurantImage) // → string | null

⚠️ **判定をここに 1 本だけ置く。** 呼び出し側で `??` に戻すと、直したはずの画面だけが
   また空文字を通す（#1782 と同じ «同じ判定を 2 箇所に書いた» 事故になる）。
*/

/** 空文字・空白だけの文字列を «無い» と見なす。それ以外はそのまま返す。 */
export const nonEmptyUrl = (value: string | null | undefined): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

/**
 * 候補を先頭から見て、最初の «空でない» ものを返す。1 つも無ければ null。
 *
 * 返すのは `null` であって空文字ではない。呼び出し側は «絵が 1 枚も無い» を
 * `null` 判定 1 つで扱える（空文字が混ざると `url ? ... : ...` と
 * `url !== null` で結果が食い違う）。
 */
export const firstNonEmptyUrl = (
	...candidates: (string | null | undefined)[]
): string | null => {
	for (const candidate of candidates) {
		const value = nonEmptyUrl(candidate);
		if (value !== null) return value;
	}
	return null;
};
