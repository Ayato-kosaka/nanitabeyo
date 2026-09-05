/**
 * 照合辞書（`dish_category_variants`）に **アプリのカテゴリ側から別名を足し戻す**純関数。
 *
 * `dishCategoryMatch.ts` が «与えられた辞書で照合する» 側なのに対し、ここは
 * «その辞書に何を載せるか» 側を持つ。DB もネットワークも触らない。
 *
 * ## なぜ `api/` ではなく `shared/` に置くか（#1273）
 *
 * もとは `api/src/v1/dish-media-imports/dish-category-variant-dictionary.service.ts` の中に
 * NestJS の Service と同居していた。そのため **この純関数だけを呼びたい側**（辞書の当たり方を
 * オフラインで測り直す再判定など）が `@nestjs/common` と Prisma クライアントごと読み込む羽目になり、
 * 実際には «同じ表を手元へ書き写す» 方向へ逃げやすい。表記ゆれの表を 2 か所に持った時点で、
 * 本番だけを直したときに測定側が古い表のまま緑になる（CLAUDE.md「本番のロジックをテストへ
 * 写経しない」）。照合規則が `shared/utils/dishCategoryMatch.ts` にあるのと同じ理由で、
 * **辞書の作り方も 1 か所に置く**。
 */

import type { DishCategoryVariantEntry } from "./dishCategoryMatch";
import { normalizeMatchText } from "./textNormalize";

/**
 * #1273 日本語の表記ゆれ・略称の追い足し（キーは各カテゴリの `labels.ja` の**正規化前の値**）。
 *
 * ## なぜ QID ではなくラベルをキーにするか
 *
 * QID をキーにすると「アプリに存在しない QID を指す幽霊エントリ」が混ざりうる。
 * `labels.ja` をキーにすれば、`buildJapaneseLabelVariants` が **実在するカテゴリにしか**
 * 別名を足せない（キーが一致した行にだけ足す）ので、アプリのカテゴリ集合が変わっても腐らない。
 *
 * ## 収録の基準（precision を落とさないもの «だけ»）
 *
 * ここに入れてよいのは「その料理を**別の綴りで書いただけ**」の表記ゆれと、
 * 誤解の余地がない略称に限る（`焼き鳥`↔`焼鳥`、`唐揚げ`↔`から揚げ`、`牛タン焼き`→`牛タン`）。
 * `カツ` `丼` `鍋` のような **他カテゴリと衝突する断片は入れない**（本文走査で誤爆するため）。
 * 本文走査に載る長さは文字種で決まる（`DISH_CATEGORY_MATCH_TUNING.bodyScanMinLength`:
 * 漢字 2 / カタカナ 2 / ひらがなを含むかな 3 / ラテン 4）。`すし` `鮨` のようにひらがな 2 文字・
 * 漢字 1 文字のものは本文走査に載らず、完全一致（ハッシュタグ等）でしか当たらない。
 * ⚠️ **カタカナ 2 文字の別名を足すときは本文走査に載る**ことに注意する（語境界は効くが、
 * 長さでは落ちない）。
 *
 * ## ⚠️ 新しい行は «実データで落ちた語» からしか足さない
 *
 * 思いついた表記を足すのは禁止。`skipped_no_category` のキャプションを実際に読み、
 * **その表記が何件で落ちているか**を数えてから足すこと。件数の根拠が書けない行は入れない。
 */
export const DISH_CATEGORY_JA_LABEL_SYNONYMS: Record<
	string,
	readonly string[]
> = {
	焼き鳥: ["焼鳥", "やきとり"],
	そば: ["蕎麦"],
	唐揚げ: ["から揚げ", "からあげ", "唐揚"],
	お好み焼き: ["お好み焼"],
	たこ焼き: ["たこ焼", "タコ焼き", "タコ焼"],
	とんかつ: ["トンカツ", "豚カツ"],
	牛タン焼き: ["牛タン", "牛たん"],
	餃子: ["ぎょうざ", "ギョーザ", "ギョウザ"],
	ウナギ: ["うなぎ", "鰻"],
	寿司: ["すし", "鮨"],
	担担麺: ["担々麺", "タンタンメン"],
};

/**
 * #1273 各カテゴリの `labels.ja`（＋表記ゆれ）を照合辞書のエントリへ変換する純関数。
 *
 * `dish_category_variants` はグローバル一意化で自分の日本語ラベルを失っているカテゴリがある
 * （`DishCategoryVariantsRepository.findAllCategoryLabelsForMatching` の doc 参照）。
 * 表示名の正である `labels.ja` を辞書へ足し戻すことで、キャプションに料理名が明記されていれば
 * 必ず候補が出るようにする。
 *
 * - `labels` が Json（`{ [lang]: string }`）でないもの、`ja` が空・非文字列のものは黙って捨てる
 * - `source` は `wikidata-label` 相当（本文走査の減点なし）。`labels.ja` は Wikidata の ja ラベルそのもの
 * - 表記ゆれは `DISH_CATEGORY_JA_LABEL_SYNONYMS` を **正規化前の ja ラベル**で引いて足す
 */
export function buildJapaneseLabelVariants(
	categories: readonly { id: string; labels: unknown }[] | null | undefined,
): DishCategoryVariantEntry[] {
	const out: DishCategoryVariantEntry[] = [];
	for (const category of categories ?? []) {
		if (!category || typeof category.id !== "string" || category.id.length === 0) continue;

		const labels = category.labels;
		if (labels === null || typeof labels !== "object" || Array.isArray(labels)) continue;

		const ja = (labels as Record<string, unknown>).ja;
		if (typeof ja !== "string" || normalizeMatchText(ja).length === 0) continue;

		out.push({
			dishCategoryId: category.id,
			surfaceForm: ja,
			source: "wikidata-label",
		});

		for (const synonym of DISH_CATEGORY_JA_LABEL_SYNONYMS[ja] ?? []) {
			out.push({
				dishCategoryId: category.id,
				surfaceForm: synonym,
				source: "wikidata-label",
			});
		}
	}
	return out;
}
