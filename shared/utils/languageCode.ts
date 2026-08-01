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
 * 正規形の言語コードに対して、DB へ実際に保存されうるタグの候補を返す。
 *
 * #817 【設計】正規化は `zh-CN` → `zh-hans` のようにタグを書き換えるため、
 * 正規形をそのまま DB 値へ突き合わせると中国語だけ一致しない。
 * DB を検索する際は、必ずこの候補集合で前方一致すること。
 *
 * 例:
 * - `ja`      → `["ja"]`      （`ja` と `ja-JP` は `ja` / `ja-*` で拾える）
 * - `zh-hans` → `["zh-hans", "zh-cn", "zh-sg"]`
 * - `zh-hant` → `["zh-hant", "zh-tw", "zh-hk", "zh-mo"]`
 *
 * ⚠️ ここに素の `zh` を混ぜてはいけない。呼び出し側は各候補を「完全一致」と
 * 「`候補-` の前方一致」で突き合わせるため、`zh` を含めると `zh-` が
 * **繁体の `zh-TW` にも当たり**、簡体を希望したユーザーに繁体が混ざる。
 * script 不明の実値は `languageWeakExactCandidates()` 側で完全一致だけ拾う。
 */
export function languageMatchCandidates(normalizedCode: string): string[] {
	if (!normalizedCode) return [];

	// 中国語は script 表記と region 表記が同じものを指すため、両方を候補に含める
	if (normalizedCode === "zh-hans" || normalizedCode === "zh-hant") {
		const regions = Object.entries(CHINESE_REGION_TO_SCRIPT)
			.filter(([, script]) => `zh-${script}` === normalizedCode)
			.map(([region]) => `zh-${region}`);

		return [normalizedCode, ...regions];
	}

	return [normalizedCode];
}

/**
 * #1052 完全一致でだけ拾いたい「弱い一致」の候補を返す。
 *
 * Google import は `originalText.languageCode` をそのまま保存するため、中国語のレビューは
 * script を持たない `zh` で入りうる。これを拾わないと、中国語ユーザーの優先対象から
 * Google 由来のレビューが丸ごと落ちる（#817 と同種の症状）。
 *
 * ただし `zh` を前方一致に使うと `zh-` が簡体・繁体の区別を壊すため、
 * **完全一致のみ**で扱う。`zh` という実値は script が判らないだけで、
 * 簡体・繁体どちらの希望者にとっても「読めはする」ので拾う価値がある。
 */
export function languageWeakExactCandidates(normalizedCode: string): string[] {
	if (normalizedCode === "zh-hans" || normalizedCode === "zh-hant") {
		return ["zh"];
	}
	return [];
}

/**
 * 優先言語リストの中で、その言語コードが何番目に優先されるかを返す。
 *
 * 小さいほど優先度が高い。どの優先言語にも当たらない場合は
 * `preferredLanguageCodes.length`（＝最下位）を返す。
 *
 * #1052 script 不明の中国語（`zh`）は「弱い一致」として `rank + 0.5` を返すため、
 * 戻り値は整数とは限らない。完全一致した他言語より下、優先指定なしより上に並ぶ。
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

	const exact = preferredLanguageCodes.findIndex((preferred) => normalizeLanguageCode(preferred) === normalized);
	if (exact !== -1) return exact;

	// #1052 【設計】script 不明の中国語（Google import の素の `zh`）は、
	// 簡体・繁体のどちらを希望するユーザーにとっても「読めはする」ため、
	// 完全一致より 1 段だけ弱い一致として扱う。
	// 完全一致した他言語より下、優先指定なしより上に来るよう rank + 0.5 を返す。
	const isChineseWithoutScript = normalized === "zh";
	const isPreferredChinese = (preferred: string) => normalizeLanguageCode(preferred).startsWith("zh");

	if (isChineseWithoutScript) {
		const weak = preferredLanguageCodes.findIndex(isPreferredChinese);
		if (weak !== -1) return weak + 0.5;
	}

	// 逆向き: 希望が素の `zh` で、レビューが `zh-hans` などの場合も同様に弱い一致とする
	if (normalized.startsWith("zh")) {
		const weak = preferredLanguageCodes.findIndex((preferred) => normalizeLanguageCode(preferred) === "zh");
		if (weak !== -1) return weak + 0.5;
	}

	return preferredLanguageCodes.length;
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
