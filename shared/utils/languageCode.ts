/**
 * 言語コードの正規化と一致判定を 1 か所へ集約する。
 *
 * #817 【設計】`dish_reviews.original_language_code` には、書き込み経路ごとに
 * 異なる形式の BCP-47 タグが入る。
 *
 * | 経路          | 実際に入る値の例        | 出所                                         |
 * | ------------- | ----------------------- | -------------------------------------------- |
 * | Google import | `ja` / `en`             | Google Places の `originalText.languageCode`  |
 * | ユーザー投稿  | `ja-JP` / `zh-CN`       | app 側の `locale`（`PUBLIC_LOCALES`）        |
 * | 検索地点言語  | `ja` / `zh-Hans`        | `resolveLocalLanguageCode()`                 |
 *
 * これらを素の `===` で比較すると、日本語の UGC レビュー(`ja-JP`)が
 * 検索地点言語(`ja`)に一致せず、Google 由来の英語レビューへ押し出される。
 * 比較の前に必ず `normalizeLanguageCode()` を通すこと。
 */

/**
 * IETF BCP 47 の言語タグ（言語 + 任意の script + 任意の region）。
 *
 * `ja` / `zh-Hant` / `zh-Hant-TW` / `fil` などを受理する。
 * reverse geocoding と app の locale が生成しうる値をすべて通す必要があるため、
 * 個別 DTO でこれより狭い正規表現を書かないこと。
 */
export const BCP47_LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/;

/**
 * 中国語は region から script を復元しないと簡体/繁体の区別が失われる。
 * `zh-CN` と `zh-Hans` は同じもの、`zh-TW` と `zh-Hant` は同じものとして扱う。
 */
const CHINESE_REGION_TO_SCRIPT: Record<string, string> = {
	cn: "hans",
	sg: "hans",
	tw: "hant",
	hk: "hant",
	mo: "hant",
};

/**
 * 比較用の正規形へ揃える。
 *
 * - 小文字化し、`_` 区切りも `-` として扱う
 * - 原則として region サブタグは落とす（`ja-JP` → `ja`）
 * - 中国語だけは script を保持する（`zh-CN` → `zh-hans`、`zh-Hant-TW` → `zh-hant`）
 *
 * 値が空・未定義の場合は空文字を返す。空文字はどの言語とも一致しない。
 */
export function normalizeLanguageCode(value: string | null | undefined): string {
	if (!value) return "";

	const parts = value.trim().toLowerCase().replace(/_/g, "-").split("-").filter(Boolean);
	const language = parts[0];
	if (!language) return "";

	if (language !== "zh") return language;

	// zh は script を復元する。script が明示されていれば優先し、無ければ region から引く。
	const script = parts.find((part) => part === "hans" || part === "hant");
	if (script) return `zh-${script}`;

	const region = parts[1];
	const derived = region ? CHINESE_REGION_TO_SCRIPT[region] : undefined;
	return derived ? `zh-${derived}` : "zh";
}

/**
 * 優先言語リストの中で、その言語コードが何番目に優先されるかを返す。
 *
 * 小さいほど優先度が高い。どの優先言語にも当たらない場合は
 * `preferredLanguageCodes.length`（＝最下位）を返す。
 *
 * #817 【設計】優先順位は「端末言語 → 検索地点の言語 → その他」。
 * 呼び出し側はこの順に並べた配列を渡すこと。
 */
export function languagePriorityRank(
	languageCode: string | null | undefined,
	preferredLanguageCodes: readonly string[],
): number {
	const normalized = normalizeLanguageCode(languageCode);
	if (!normalized) return preferredLanguageCodes.length;

	const rank = preferredLanguageCodes.findIndex((preferred) => normalizeLanguageCode(preferred) === normalized);

	return rank === -1 ? preferredLanguageCodes.length : rank;
}

/**
 * 優先言語リストを正規化しつつ、重複と空値を落として順序を保つ。
 * 空配列が返った場合、呼び出し側は「優先指定なし」として従来動作を維持すること。
 */
export function normalizePreferredLanguageCodes(values: readonly (string | null | undefined)[] = []): string[] {
	const seen = new Set<string>();
	const result: string[] = [];

	for (const value of values) {
		const normalized = normalizeLanguageCode(value);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}

	return result;
}
