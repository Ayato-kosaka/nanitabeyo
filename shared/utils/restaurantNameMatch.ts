/**
 * SNS の投稿テキストと **店舗候補**（`GET /v1/restaurants/search` の結果）を照合する
 * ルールベースの純粋関数（#1399 解くべき問い 4）。
 *
 * ## この関数がやらないこと（意図的な制約）
 *
 * - **API を叩かない。** 候補は `{ id, name }[]` として引数で受ける。取りに行くのは呼び出し側の責務。
 * - **Google Places の Text Search / Autocomplete を使わない**（課金のため。#1399 前提）。
 * - **LLM を使わない。** #1399 の確定事項。
 * - **「確定」を返さない。** 返すのは順位付きの候補と `shouldPrefill` だけ。
 *
 * ## 照合の向きを「店名 → テキスト」にしている理由
 *
 * キャプションから店名を切り出すことは、形態素解析も LLM も無い条件では**できない**
 * （#1399 設計 §5-4 / 詳細コメント §6-1「店舗名: ❌ 取れない」）。
 * 一方で候補側の店名は有限（数百〜数千）なので、**店名が投稿テキストに現れるかを見る**方が堅い。
 * したがって本モジュールは「候補それぞれについて、その名前がテキストに出てくるか」を判定する。
 *
 * 結果として **候補が 0 件のケースが既定**になる。`restaurants` は「誰かが実際にそのエリアを
 * 見た／検索した」ときにしか増えないためで（#1399 設計 §5-2）、これは失敗ではない。
 * 確認画面は「地図から店を選ぶ」を既定にし、候補があるときだけその上にチップを出すこと（§5-3）。
 *
 * ## 表記ゆれの吸収 — 1 店舗につき 4 つの照合キーを作る
 *
 * `restaurants.name` は Google Places 由来の生の表記で、辞書のような正規化を受けていない。
 * そこで**店名側とテキスト側の両方に同じ 4 変換を当て、同じ種類のキーどうしで照合する**。
 * 片側だけ変換すると当たらなくなるので、必ず対で使うこと。
 *
 * | キー種別 | 変換 | 何を吸収するか | 例 |
 * | --- | --- | --- | --- |
 * | `normalized` | NFKC → 空白圧縮 → 小文字化 | 全角半角・大文字小文字・余分な空白 | `ＲＡＭＥＮ 太郎` → `ramen 太郎` |
 * | `kana-folded` | ↑ + カタカナ→ひらがな | かなの書き分け | `ラーメン太郎` ≡ `らーめん太郎` |
 * | `symbol-stripped` | ↑↑ + 記号と空白の除去 | 中黒・スラッシュ・ハイフン・空白 | `カフェ・ド・パリ` ≡ `カフェドパリ` |
 * | `kana-folded-symbol-stripped` | 両方 | 上記の組み合わせ | `らーめん・太郎` ≡ `ラーメン太郎` |
 *
 * `normalized` 以外のキーで当たった場合は **−0.05** する（片側の形を崩して当てているため）。
 * `symbol-stripped` 系は文字数が変わるので、根拠の `start`/`end` は `null` になる。
 *
 * ## 支店名（「○○店」「本店」等）の扱い
 *
 * `restaurants.name` は `一風堂 渋谷店` のような形で入る。投稿は屋号しか書かないことが多いので、
 * 屋号（base）と支店（branch）へ分けて別々に評価する。分け方は #1399 設計 §5-4 の 3 パターン。
 *
 * | パターン | 例 |
 * | --- | --- |
 * | `/^(.+?)\s*([^\s]{1,10}(?:店\|支店\|本店\|営業所))$/` | `一風堂 渋谷店` → `一風堂` / `渋谷店` |
 * | `/^(.+?)\s*[-–—]\s*(.+)$/` | `Blue Bottle - Shibuya` → `Blue Bottle` / `Shibuya` |
 * | `/^(.+?)\s*[（(](.+)[）)]\s*$/` | `丸亀製麺（渋谷店）` → `丸亀製麺` / `渋谷店` |
 *
 * **屋号だけが一致しても 0.70 止まり**にしてある。同じ屋号の別支店が候補に並ぶと拮抗して
 * 両方 0.60 まで落ち、prefill 閾値 0.90 に届かない。これは意図した挙動で、
 * **「一風堂」としか書かれていない投稿から支店を当ててはいけない**（#1273 §23）。
 * 支店名もテキストに出ていれば +0.20 して 0.90 になり、そこで初めて prefill の土俵に乗る。
 * ただし `本店` `支店` `営業所` のような**どの店にも付きうる語は加点しない**（区別する情報が無い）。
 *
 * ## 部分一致の閾値 — なぜこの数字か
 *
 * 数字は `RESTAURANT_NAME_MATCH_TUNING` に**一箇所へ集めてある**。触るときはそこだけを触ること。
 *
 * | 閾値 | 値 | 根拠 |
 * | --- | --- | --- |
 * | `minContainmentLengthLatin` | 4 | #1399 設計 §5-4「店名が 3 文字以下のときは含有判定を適用しない」。`abc` のような 3 文字はキャプションに偶然含まれる |
 * | `minContainmentLengthCjk` | 3 | 漢字・かなの 3 文字は `一風堂` `大戸屋` のような実在の屋号。ラテン 3 文字と違い固有名詞性が高く、落とすと取りこぼしが大きい |
 * | `minFuzzySimilarity` | 0.4 | #1399 設計 §5-4 が `pg_trgm` の `similarity() >= 0.4` を採ったのに合わせた。ここでは 3-gram の Jaccard 係数で計算する（同じ考え方・同じ閾値だが、語分割が違うので値は一致しない） |
 * | `maxFuzzyTokenLength` | 40 | 曖昧一致はトークン（`@mention` / ハッシュタグ / `author_name` / 短いタイトル）にだけ当てる。長いキャプション全体に当てると 3-gram の分母が膨らんで意味のある値にならない |
 * | `prefillMinConfidence` | 0.90 | 料理カテゴリ（0.80）より厳しい。**店の取り違えは料理の取り違えより実害が大きい**（Map と Calendar に嘘の店が出て、しかもユーザーが気づきにくい） |
 * | `prefillMinMargin` | 0.20 | 同上。同じ屋号の別支店が並んだときに必ず落ちる幅にしてある |
 *
 * ## `author_name` は単独で prefill しない
 *
 * 投稿者名が店の公式アカウントであることはあるが、ブランド全体のアカウントだと支店が特定できない
 * （#1273 §23 / #1399 詳細コメント §6-1）。基礎点 0.60 に抑えたうえで、
 * **根拠が `author-name` だけの候補は `shouldPrefill` を立てない**という規則を別に置いてある。
 */

import {
	clampConfidence,
	classifySurfaceScript,
	confidenceMargin,
	extractBracketedNames,
	extractHashtags,
	extractMentions,
	isWordBoundaryMatch,
	katakanaToHiragana,
	normalizeExtractedTexts,
	normalizeMatchText,
	stripMatchSymbols,
	trigramSimilarity,
	type ExtractedText,
	type ExtractedTextFieldKind,
	type NormalizedText,
} from "./textNormalize";

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

/** `GET /v1/restaurants/search` が返す 1 件（照合に必要な列だけ） */
export type RestaurantSearchCandidate = {
	id: string;
	name: string;
};

export type RestaurantNameMatchInput = {
	/** SNS のメタデータから取れたテキスト */
	texts: readonly ExtractedText[] | null | undefined;
	/** 照合する店舗候補。**呼び出し側が API から取って渡す** */
	candidates: readonly RestaurantSearchCandidate[] | null | undefined;
	/** 投稿者名（TikTok / YouTube の `author_name`）。単独では prefill しない */
	authorName?: string | null;
	/**
	 * #1273 キャプション由来の «店名候補»（`📍<店名>` 行から切り出した名前など）。
	 *
	 * 候補店名と **exact 一致**したときだけ、`【】`(bracketed exact) と同じ扱い＝
	 * `exact-name`（1.00 系）の根拠を立てる。含有一致（0.85）止まりで prefill 閾値
	 * 0.90 に届かなかった «店名を丸ごと 📍 行に書く» 投稿を、無人取り込みの土俵へ乗せる。
	 *
	 * 生キャプションから切り出すのは呼び出し側（service）の責務（改行が要るため
	 * `shared/utils/textNormalize.ts` の `extractPinNames` を使う）。ここは渡された
	 * 名前が候補店名と一致するかだけを見る。含有・曖昧一致には使わない（誤爆を増やさない）。
	 */
	nameHints?: readonly string[] | null;
};

// ---------------------------------------------------------------------------
// 調整値（数字はすべてここに集める）
// ---------------------------------------------------------------------------

/**
 * 基礎点・加減点・閾値。**数字を触るときは必ずここだけを触ること。**
 * 各値の根拠はファイル冒頭の表にある。
 */
export const RESTAURANT_NAME_MATCH_TUNING = {
	/** 一致の種別ごとの基礎点 */
	base: {
		/** テキスト（またはトークン）が店名と完全一致 */
		exactName: 1.0,
		/** 店名がテキストに含まれる */
		nameContained: 0.85,
		/** 支店名を落とした屋号がテキストに含まれる */
		baseNameContained: 0.7,
		/** `author_name` が店名（または屋号）と一致 */
		authorName: 0.6,
	},
	adjustment: {
		/** 屋号に加えて支店名もテキストに出ている */
		branchAlsoMatched: 0.2,
		/** `normalized` 以外のキー（かな畳み込み・記号除去）経由で当たった */
		foldedKey: -0.05,
		/** 1 位と 2 位が拮抗しているときに上位 2 件へ */
		contested: -0.1,
	},
	threshold: {
		/** ラテン文字の店名に含有判定を適用してよい最短の長さ */
		minContainmentLengthLatin: 4,
		/** 漢字・かなを含む店名に含有判定を適用してよい最短の長さ */
		minContainmentLengthCjk: 3,
		/** 3-gram Jaccard 係数がこれ未満なら候補にしない */
		minFuzzySimilarity: 0.4,
		/** 曖昧一致を当ててよいトークンの最大長 */
		maxFuzzyTokenLength: 40,
		/** 1 位と 2 位の差がこれ未満なら「拮抗」とみなす */
		contestedMargin: 0.1,
		/** prefill してよい最低信頼度（料理カテゴリの 0.80 より厳しい） */
		prefillMinConfidence: 0.9,
		/** prefill してよい 1 位・2 位の最小差 */
		prefillMinMargin: 0.2,
		/** 返す候補の既定上限 */
		maxCandidates: 5,
	},
} as const;

/**
 * 支店名として切り出しても**加点の根拠にしない**語。
 *
 * どの店にも付きうるので、これがテキストに出ていても「その支店だ」と言えない。
 */
export const GENERIC_BRANCH_WORDS: ReadonlySet<string> = new Set([
	"本店",
	"支店",
	"営業所",
	"店",
	"総本店",
	"本館",
]);

/** 照合する店舗候補の上限（壊れた入力で計算量が跳ねないための保険） */
const MAX_RESTAURANT_CANDIDATES = 200;

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

export type RestaurantMatchKind =
	| "exact-name"
	| "name-contained"
	| "base-name-contained"
	| "fuzzy-token"
	| "author-name";

/** 4 つの照合キーのどれで当たったか */
export type RestaurantMatchKeyKind =
	| "normalized"
	| "kana-folded"
	| "symbol-stripped"
	| "kana-folded-symbol-stripped";

export type RestaurantMatchEvidence = {
	kind: RestaurantMatchKind;
	keyKind: RestaurantMatchKeyKind;
	/** 当たった店名側の文字列（変換後の形） */
	matchedName: string;
	/** 支店名も一緒に見つかったか（`base-name-contained` のときだけ意味を持つ） */
	branchAlsoMatched: boolean;
	/** `normalizedTexts` の添字。`author-name` 由来なら `null` */
	fieldIndex: number | null;
	field: ExtractedTextFieldKind | null;
	/**
	 * `normalizedTexts[fieldIndex].text` 上の範囲。
	 * 記号除去キーで当たったときは文字数が変わっているので `null`。
	 */
	start: number | null;
	end: number | null;
	/** この根拠 1 本だけで得られる点（拮抗調整前） */
	score: number;
};

export type RestaurantCandidateMatch = {
	restaurantId: string;
	/** 入力で渡された生の店名 */
	name: string;
	confidence: number;
	/** 1 始まりの順位 */
	rank: number;
	evidence: RestaurantMatchEvidence[];
};

export type RestaurantNameMatchResult = {
	/** 信頼度の降順 */
	candidates: RestaurantCandidateMatch[];
	/** `true` のときだけ確認画面へ prefill してよい */
	shouldPrefill: boolean;
	/** `shouldPrefill` が `true` のときの `restaurant_id`。それ以外は `null` */
	prefillRestaurantId: string | null;
	/** 根拠のオフセットが指している正規化済みテキスト */
	normalizedTexts: NormalizedText[];
};

export type RestaurantNameMatchOptions = {
	/** 返す候補の上限。既定 5 */
	maxCandidates?: number;
};

// ---------------------------------------------------------------------------
// 照合キー
// ---------------------------------------------------------------------------

type MatchKeys = {
	normalized: string;
	kanaFolded: string;
	symbolStripped: string;
	kanaFoldedSymbolStripped: string;
};

/** 4 つのキーを作る。**店名側とテキスト側の両方に同じものを当てる。** */
export function buildMatchKeys(normalized: string): MatchKeys {
	const kanaFolded = katakanaToHiragana(normalized);
	return {
		normalized,
		kanaFolded,
		symbolStripped: stripMatchSymbols(normalized),
		kanaFoldedSymbolStripped: stripMatchSymbols(kanaFolded),
	};
}

/**
 * #1273 `nameHints`（📍pin 名など）を照合キーへ畳む。空・重複は落とす。
 *
 * 渡ってくる時点で `extractPinNames` が正規化済みだが、由来を問わず素通しできるよう
 * ここでも `normalizeMatchText` を通し直す（二重にかけても結果は変わらない）。
 */
function buildNameHintKeys(hints: readonly string[] | null | undefined): MatchKeys[] {
	if (!Array.isArray(hints)) return [];

	const seen = new Set<string>();
	const keys: MatchKeys[] = [];
	for (const hint of hints) {
		const normalized = normalizeMatchText(hint);
		if (normalized.length === 0 || seen.has(normalized)) continue;
		seen.add(normalized);
		keys.push(buildMatchKeys(normalized));
	}
	return keys;
}

/** キー種別の一覧。強い（＝原形に近い）順に並べてある */
const KEY_KINDS: readonly RestaurantMatchKeyKind[] = [
	"normalized",
	"kana-folded",
	"symbol-stripped",
	"kana-folded-symbol-stripped",
];

function keyOf(keys: MatchKeys, kind: RestaurantMatchKeyKind): string {
	switch (kind) {
		case "normalized":
			return keys.normalized;
		case "kana-folded":
			return keys.kanaFolded;
		case "symbol-stripped":
			return keys.symbolStripped;
		default:
			return keys.kanaFoldedSymbolStripped;
	}
}

/** そのキー種別が文字数を保つか（保たないならオフセットを返せない） */
function keyPreservesOffsets(kind: RestaurantMatchKeyKind): boolean {
	return kind === "normalized" || kind === "kana-folded";
}

// ---------------------------------------------------------------------------
// 支店名の分離
// ---------------------------------------------------------------------------

/** 「○○店」「本店」「営業所」で終わる形 */
const BRANCH_SUFFIX_PATTERN = /^(.+?)\s*([^\s]{1,10}(?:店|支店|本店|営業所))$/;
/** ハイフン・ダッシュで区切られた形 */
const BRANCH_DASH_PATTERN = /^(.+?)\s*[-–—]\s*(.+)$/;
/** 括弧で括られた形 */
const BRANCH_PAREN_PATTERN = /^(.+?)\s*[（(](.+)[）)]\s*$/;

export type SplitRestaurantName = {
	/** 屋号 */
	base: string;
	/** 支店名。分けられなければ `null` */
	branch: string | null;
};

/**
 * 店名を屋号と支店名へ分ける。#1399 設計 §5-4 の 3 パターンを上から順に試す。
 *
 * 分けられないときは `{ base: name, branch: null }` を返す（**例外は投げない**）。
 * 屋号が空になる分け方（`店` だけの名前など）は分けなかったことにする。
 */
export function splitRestaurantName(normalizedName: string): SplitRestaurantName {
	for (const pattern of [BRANCH_SUFFIX_PATTERN, BRANCH_DASH_PATTERN, BRANCH_PAREN_PATTERN]) {
		const matched = pattern.exec(normalizedName);
		if (matched === null) continue;

		const base = matched[1].trim();
		const branch = matched[2].trim();
		if (base.length === 0 || branch.length === 0) continue;

		return { base, branch };
	}
	return { base: normalizedName, branch: null };
}

// ---------------------------------------------------------------------------
// 含有判定
// ---------------------------------------------------------------------------

/**
 * 「含まれているだけ」で候補にしてよい長さか。
 *
 * ラテン文字は 4 文字以上、漢字・かなを含むものは 3 文字以上。根拠は冒頭の表を参照。
 */
export function isContainmentEligible(name: string): boolean {
	const { threshold } = RESTAURANT_NAME_MATCH_TUNING;
	const script = classifySurfaceScript(name);
	const min =
		script === "latin" || script === "other"
			? threshold.minContainmentLengthLatin
			: threshold.minContainmentLengthCjk;
	return name.length >= min;
}

/** `needle` が `haystack` に**語として**含まれる最初の位置。無ければ `-1` */
function indexOfAsWord(haystack: string, needle: string): number {
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		if (isWordBoundaryMatch(haystack, at, at + needle.length, needle)) return at;
		at = haystack.indexOf(needle, at + 1);
	}
	return -1;
}

// ---------------------------------------------------------------------------
// 照合本体
// ---------------------------------------------------------------------------

type TextToken = {
	value: string;
	keys: MatchKeys;
	fieldIndex: number;
	field: ExtractedTextFieldKind;
	start: number;
	end: number;
};

type PreparedText = {
	normalized: NormalizedText;
	keys: MatchKeys;
	/** 完全一致・曖昧一致に使う短いトークン（フィールド全体 / ハッシュタグ / `@mention` / 【店名】） */
	tokens: TextToken[];
};

function prepareTexts(normalizedTexts: NormalizedText[]): PreparedText[] {
	return normalizedTexts.map((normalized) => {
		const tokens: TextToken[] = [
			{
				value: normalized.text,
				keys: buildMatchKeys(normalized.text),
				fieldIndex: normalized.index,
				field: normalized.field,
				start: 0,
				end: normalized.text.length,
			},
		];

		for (const tag of extractHashtags(normalized.text)) {
			tokens.push({
				value: tag.tag,
				keys: buildMatchKeys(tag.tag),
				fieldIndex: normalized.index,
				field: normalized.field,
				start: tag.start,
				end: tag.end,
			});
		}
		for (const mention of extractMentions(normalized.text)) {
			tokens.push({
				value: mention.mention,
				keys: buildMatchKeys(mention.mention),
				fieldIndex: normalized.index,
				field: normalized.field,
				start: mention.start,
				end: mention.end,
			});
		}
		// #1273 `【店名】` の隅付き括弧は、グルメ紹介キャプションでの店名の目印。
		// トークンにすることで、店名が丸ごと括弧内に書かれた投稿が完全一致（1.00）で
		// 当たり、無人取り込みの prefill（0.90 必須）に届くようになる。
		for (const bracket of extractBracketedNames(normalized.text)) {
			tokens.push({
				value: bracket.name,
				keys: buildMatchKeys(bracket.name),
				fieldIndex: normalized.index,
				field: normalized.field,
				start: bracket.start,
				end: bracket.end,
			});
		}

		return { normalized, keys: buildMatchKeys(normalized.text), tokens };
	});
}

function scoreFor(kind: RestaurantMatchKind, keyKind: RestaurantMatchKeyKind, branchAlsoMatched: boolean): number {
	const { base, adjustment } = RESTAURANT_NAME_MATCH_TUNING;

	let score: number;
	switch (kind) {
		case "exact-name":
			score = base.exactName;
			break;
		case "name-contained":
			score = base.nameContained;
			break;
		case "base-name-contained":
			score = base.baseNameContained;
			break;
		case "author-name":
			score = base.authorName;
			break;
		default:
			// `fuzzy-token` は類似度そのものを点にするので、呼び出し側で上書きする
			score = 0;
			break;
	}

	if (branchAlsoMatched) score += adjustment.branchAlsoMatched;
	if (keyKind !== "normalized") score += adjustment.foldedKey;

	return score;
}

/** 支店名がテキストのどこかに出ているか（generic な語は数えない） */
function branchAppears(branch: string | null, prepared: readonly PreparedText[]): boolean {
	if (branch === null || GENERIC_BRANCH_WORDS.has(branch)) return false;

	const branchKeys = buildMatchKeys(branch);
	for (const text of prepared) {
		for (const keyKind of KEY_KINDS) {
			const needle = keyOf(branchKeys, keyKind);
			if (needle.length === 0) continue;
			if (keyOf(text.keys, keyKind).indexOf(needle) !== -1) return true;
		}
	}
	return false;
}

function collectForCandidate(
	candidate: RestaurantSearchCandidate,
	prepared: readonly PreparedText[],
	normalizedAuthorName: string,
	nameHintKeys: readonly MatchKeys[],
): RestaurantMatchEvidence[] {
	const { threshold } = RESTAURANT_NAME_MATCH_TUNING;
	const evidence: RestaurantMatchEvidence[] = [];

	const normalizedName = normalizeMatchText(candidate.name);
	if (normalizedName.length === 0) return evidence;

	const nameKeys = buildMatchKeys(normalizedName);
	const split = splitRestaurantName(normalizedName);
	const baseKeys = buildMatchKeys(split.base);
	const branchMatched = branchAppears(split.branch, prepared);

	// #1273 nameHints（📍pin 名など）と候補店名の完全一致。`【】`(bracketed exact) と
	// 同じく exact-name（1.00 系）として立てる。生キャプションから切り出すのは呼び出し側で、
	// ここは «渡された候補店名» と exact 一致するかだけを見る（含有・曖昧一致には使わない）。
	// 一致は最も強いキー（KEY_KINDS は normalized 優先の順）で 1 本立てれば十分なので break する。
	for (const hintKeys of nameHintKeys) {
		for (const keyKind of KEY_KINDS) {
			const nameKey = keyOf(nameKeys, keyKind);
			if (nameKey.length === 0) continue;
			if (keyOf(hintKeys, keyKind) !== nameKey) continue;
			evidence.push({
				kind: "exact-name",
				keyKind,
				matchedName: nameKey,
				branchAlsoMatched: false,
				// pin 名は正規化でオフセットが原文とずれる（改行の圧縮）ので位置は返さない。
				// author-name と同じく «テキスト上の 1 点» を指せない根拠として null にする
				fieldIndex: null,
				field: null,
				start: null,
				end: null,
				score: scoreFor("exact-name", keyKind, false),
			});
			break;
		}
	}

	for (const text of prepared) {
		for (const keyKind of KEY_KINDS) {
			const nameKey = keyOf(nameKeys, keyKind);
			if (nameKey.length === 0) continue;

			// (1) トークン（フィールド全体 / ハッシュタグ / @mention / 【店名】）との完全一致
			for (const token of text.tokens) {
				if (keyOf(token.keys, keyKind) !== nameKey) continue;
				evidence.push({
					kind: "exact-name",
					keyKind,
					matchedName: nameKey,
					branchAlsoMatched: false,
					fieldIndex: token.fieldIndex,
					field: token.field,
					start: keyPreservesOffsets(keyKind) ? token.start : null,
					end: keyPreservesOffsets(keyKind) ? token.end : null,
					score: scoreFor("exact-name", keyKind, false),
				});
			}

			// (2) 店名まるごとがテキストに含まれる
			if (isContainmentEligible(nameKey)) {
				const at = indexOfAsWord(keyOf(text.keys, keyKind), nameKey);
				if (at !== -1) {
					evidence.push({
						kind: "name-contained",
						keyKind,
						matchedName: nameKey,
						branchAlsoMatched: false,
						fieldIndex: text.normalized.index,
						field: text.normalized.field,
						start: keyPreservesOffsets(keyKind) ? at : null,
						end: keyPreservesOffsets(keyKind) ? at + nameKey.length : null,
						score: scoreFor("name-contained", keyKind, false),
					});
				}
			}

			// (3) 屋号（支店名を落とした形）がテキストに含まれる
			const baseKey = keyOf(baseKeys, keyKind);
			if (split.branch !== null && baseKey.length > 0 && isContainmentEligible(baseKey)) {
				const at = indexOfAsWord(keyOf(text.keys, keyKind), baseKey);
				if (at !== -1) {
					evidence.push({
						kind: "base-name-contained",
						keyKind,
						matchedName: baseKey,
						branchAlsoMatched: branchMatched,
						fieldIndex: text.normalized.index,
						field: text.normalized.field,
						start: keyPreservesOffsets(keyKind) ? at : null,
						end: keyPreservesOffsets(keyKind) ? at + baseKey.length : null,
						score: scoreFor("base-name-contained", keyKind, branchMatched),
					});
				}
			}
		}

		// (4) 短いトークンとの曖昧一致（3-gram Jaccard）
		for (const token of text.tokens) {
			if (token.value.length === 0 || token.value.length > threshold.maxFuzzyTokenLength) continue;

			const similarity = trigramSimilarity(nameKeys.kanaFoldedSymbolStripped, token.keys.kanaFoldedSymbolStripped);
			if (similarity < threshold.minFuzzySimilarity) continue;

			evidence.push({
				kind: "fuzzy-token",
				keyKind: "kana-folded-symbol-stripped",
				matchedName: nameKeys.kanaFoldedSymbolStripped,
				branchAlsoMatched: false,
				fieldIndex: token.fieldIndex,
				field: token.field,
				start: null,
				end: null,
				// 類似度そのものを点にするが、曖昧一致は必ずもっとも畳んだキーの上で行うので
				// `foldedKey` の減点を必ず被せる。これが無いと「記号を落とせば完全一致」なケースが
				// 曖昧一致の側から 1.00 で入ってきて、`normalized` 完全一致と区別できなくなる。
				score: clampConfidence(similarity + RESTAURANT_NAME_MATCH_TUNING.adjustment.foldedKey),
			});
		}
	}

	// (5) author_name との一致。単独では prefill しない（呼び出し側の規則ではなくここで保証する）
	if (normalizedAuthorName.length > 0) {
		const authorKeys = buildMatchKeys(normalizedAuthorName);
		for (const keyKind of KEY_KINDS) {
			const nameKey = keyOf(nameKeys, keyKind);
			const baseKey = keyOf(baseKeys, keyKind);
			const authorKey = keyOf(authorKeys, keyKind);
			if (authorKey.length === 0) continue;
			if (authorKey !== nameKey && authorKey !== baseKey) continue;

			evidence.push({
				kind: "author-name",
				keyKind,
				matchedName: nameKey,
				branchAlsoMatched: false,
				fieldIndex: null,
				field: null,
				start: null,
				end: null,
				score: scoreFor("author-name", keyKind, false),
			});
			break;
		}
	}

	return evidence;
}

function compareEvidence(a: RestaurantMatchEvidence, b: RestaurantMatchEvidence): number {
	if (b.score !== a.score) return b.score - a.score;
	if (b.matchedName.length !== a.matchedName.length) return b.matchedName.length - a.matchedName.length;
	return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}

function sortCandidates(candidates: RestaurantCandidateMatch[]): void {
	candidates.sort((a, b) => {
		if (b.confidence !== a.confidence) return b.confidence - a.confidence;

		// 同点なら長い店名が当たった方を上に（`一風堂 渋谷店` > `一風堂`）
		const aLength = a.evidence[0]?.matchedName.length ?? 0;
		const bLength = b.evidence[0]?.matchedName.length ?? 0;
		if (bLength !== aLength) return bLength - aLength;

		return a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0;
	});
}

/**
 * 抽出テキストと店舗候補を照合し、**順位付きの候補**を返す。
 *
 * 候補が 0 件になるのは想定内（#1399 設計 §5-3）。呼び出し側は「見つかりませんでした」ではなく
 * 「地図から店を選んでください」を既定の導線にすること。
 */
export function matchRestaurantNames(
	input: RestaurantNameMatchInput,
	options?: RestaurantNameMatchOptions,
): RestaurantNameMatchResult {
	const { adjustment, threshold } = RESTAURANT_NAME_MATCH_TUNING;

	const normalizedTexts = normalizeExtractedTexts(input?.texts);
	const prepared = prepareTexts(normalizedTexts);
	const normalizedAuthorName = normalizeMatchText(input?.authorName);
	const nameHintKeys = buildNameHintKeys(input?.nameHints);

	const candidates: RestaurantCandidateMatch[] = [];
	const rawCandidates = Array.isArray(input?.candidates) ? input.candidates : [];

	for (let i = 0; i < rawCandidates.length && i < MAX_RESTAURANT_CANDIDATES; i += 1) {
		const raw = rawCandidates[i];
		if (!raw || typeof raw !== "object") continue;
		if (typeof raw.id !== "string" || raw.id.length === 0) continue;
		if (typeof raw.name !== "string") continue;

		const evidence = collectForCandidate(raw, prepared, normalizedAuthorName, nameHintKeys);
		if (evidence.length === 0) continue;

		evidence.sort(compareEvidence);
		candidates.push({
			restaurantId: raw.id,
			name: raw.name,
			confidence: clampConfidence(evidence[0].score),
			rank: 0,
			evidence: evidence.slice(0, 8),
		});
	}

	sortCandidates(candidates);

	// 拮抗調整。同じ屋号の別支店が並んだときに両方を落とすのがここの主目的。
	if (
		candidates.length >= 2 &&
		confidenceMargin(candidates[0].confidence, candidates[1].confidence) < threshold.contestedMargin
	) {
		candidates[0].confidence = clampConfidence(candidates[0].confidence + adjustment.contested);
		candidates[1].confidence = clampConfidence(candidates[1].confidence + adjustment.contested);
		sortCandidates(candidates);
	}

	// prefill の判断は切り詰める前の全候補で行う
	const margin =
		candidates.length >= 2
			? confidenceMargin(candidates[0].confidence, candidates[1].confidence)
			: Number.POSITIVE_INFINITY;
	const authorNameOnly =
		candidates.length >= 1 && candidates[0].evidence.every((item) => item.kind === "author-name");
	const shouldPrefill =
		candidates.length >= 1 &&
		!authorNameOnly &&
		candidates[0].confidence >= threshold.prefillMinConfidence &&
		margin >= threshold.prefillMinMargin;

	const maxCandidates = options?.maxCandidates ?? threshold.maxCandidates;
	const top = candidates.slice(0, Math.max(0, maxCandidates));
	for (let i = 0; i < top.length; i += 1) top[i].rank = i + 1;

	return {
		candidates: top,
		shouldPrefill,
		prefillRestaurantId: shouldPrefill ? candidates[0].restaurantId : null,
		normalizedTexts,
	};
}
