/**
 * SNS の投稿テキストから **料理カテゴリ候補**を出すルールベースの純粋関数（#1399 解くべき問い 3）。
 *
 * ## この関数がやらないこと（意図的な制約）
 *
 * - **DB を引かない。** `dish_category_variants` の中身は `{ dishCategoryId, surfaceForm }[]` として
 *   引数で受ける。引くのは呼び出し側の責務（#1399 リーダー確定 §5「F-8」で、既存の前方一致検索は
 *   この用途に使えないことが確定している）。
 * - **LLM を使わない。** #1399 の確定事項。判定は文字列一致と Unicode の文字種だけで閉じている。
 * - **「確定」を返さない。** 返すのは**順位付きの候補**と、`prefill` してよいかどうかの判断材料だけ。
 *   #1399 本文の「完全自動確定を前提にしない」に対応する。
 * - **外部ライブラリを使わない。**
 *
 * ## 信頼度（0〜1）の出し方 — 数字の根拠
 *
 * **基礎点は「その一致がどれだけ『投稿者の意図』に近いか」の順**で並べてある。
 * すべて #1399 設計コメント §4-4-5 の表をそのまま採用し、独立レビュー（M-4）が実データで
 * 示した誤爆に対して**上限と足切りを足した**もの。
 *
 * | 種別 | 基礎点 | なぜその順位か |
 * | --- | --- | --- |
 * | `exact-text` フィールド全体が `surface_form` と一致 | 0.95 | title が丸ごと料理名。投稿者が明示している |
 * | `exact-hashtag` ハッシュタグが `surface_form` と一致 | 0.85 | 投稿者が自分でタグとして選んだ語。ただし本文より文脈が薄い |
 * | `hashtag-suffix-stripped` 接尾辞を剥がして一致 | 0.70 | `#ラーメン部` → `ラーメン`。剥がした時点で 1 段推測が入る |
 * | `body-scan` 本文に含まれていた | 0.55 | 「言及した」だけ。「その料理を食べた」根拠にはならない |
 *
 * 加減点（すべて加算。最後に 0〜1 へ丸める）:
 *
 * | 加減点 | 値 | 根拠 |
 * | --- | --- | --- |
 * | `surface_form` が 6 文字以上 | +0.10 | 長い別名は偶然一致しにくい。`味噌ラーメン` が `ラーメン` より上に来る |
 * | 同一カテゴリが 2 箇所以上で一致 | +0.10（1 回まで） | title と hashtag の両方に出れば独立した 2 つの証拠 |
 * | `surface_form` がラテン文字 3 文字以下 | −0.20 | 3 文字の英字は偶然一致する。本文走査では長さで既に落ちるが、ハッシュタグでは残る |
 * | 記号除去キー経由で一致 | −0.05 | `#ラーメン_太郎` のような形を救う代わりに、片側だけ形が変わっている |
 * | `source='kata2hira'` の本文一致 | −0.10 | ひらがな化した別名は日本語の頻出語と衝突しやすい |
 * | `source='romaji'` の本文一致 | −0.20 | ローマ字は一般英単語と衝突する（実測: `papa` `glass` `kaka` などが辞書に実在する） |
 * | 1 位と 2 位の差が 0.10 未満（拮抗） | 上位 2 件とも −0.10 | 拮抗しているものを prefill してはいけない |
 *
 * ### 不変条件: **本文走査だけで得た候補は prefill 閾値に到達しない**
 *
 * 本文走査の到達しうる最大値は `0.55 + 0.10 + 0.10 = 0.75`（`DISH_CATEGORY_MATCH_TUNING.threshold.bodyScanCeiling`）で、
 * prefill 閾値 0.80 に **構造的に届かない**。独立レビュー M-4 はこれを「設計の欠陥」として挙げたが、
 * ここでは**意図した性質として固定する**。理由は、多言語ラベルが 1 つの辞書に混ざっている以上
 * （実測 5,028 行中 2,727 行がキリル・アラビア・ハングル等）、本文走査の誤爆は原理的に消せないためで、
 * 消せないなら **「誤爆しても候補チップ止まりで、勝手に入力されることは無い」**という上限を
 * 保証する方が実装として正直である。この不変条件はテストで固定してある。
 *
 * ## 短い `surface_form` の誤爆への対処（⚠️ 本モジュールの中心）
 *
 * 独立レビューが実データで再現した誤爆は次の 4 つ。**すべて回帰テストにしてある。**
 *
 * | キャプション | 誤爆 | どう止めたか |
 * | --- | --- | --- |
 * | `お腹いっぱい食べました` | `ぱい` → パイ | かなのみは**本文走査 3 文字以上**。`ぱい` は 2 文字で対象外 |
 * | `パイナップルジュース` | `パイ` → パイ | 同上に加え、**カタカナの並びの境界**（`パイ` の直後が `ナ`）で不一致 |
 * | `a glass of wine` | `glass` → アイスクリーム（スウェーデン語ラベル） | 止められない。ただし本文走査なので**上限 0.75** で候補チップ止まり |
 * | `papa took me here` | `papa` → ポリッジ | 同上。加えて `source='romaji'` なら −0.20 |
 *
 * 具体的な規則は 2 段構えである。
 *
 * **(1) 本文走査に載せる最小長**（`DISH_CATEGORY_MATCH_TUNING.bodyScanMinLength`）。文字種で変える。
 *
 * | `surface_form` の文字種 | 最小長 | 根拠 |
 * | --- | --- | --- |
 * | 漢字を含む | 2 | `寿司` `豆腐` のような 2 文字が主力。漢字 2 文字が無関係な語に埋もれる頻度は低い |
 * | かなのみ | 3 | 実測 111 件ある CJK 2 文字以下がここで全部落ちる（`ぱい` `パイ` `もち` …） |
 * | ラテン文字のみ | 4 | 実測でラテン 3 文字以下は 28 件。落としても損失が小さく、誤爆の削減が大きい |
 * | その他の文字体系 | 4 | 実測 2,727 件。日本語・英語のキャプションに紛れ込む理由が無いので厳しくしてよい |
 *
 * **(2) 語境界**（`isWordBoundaryMatch`）。文字種ごとの規則は `textNormalize.ts` の表を参照。
 * 要点は「ラテン文字は語の途中に埋もれない」「カタカナはカタカナの並びの途中に埋もれない」で、
 * **ひらがなと漢字には境界を課さない**（課すと `おいしいうどん` `絶品味噌ラーメン` を落とすため）。
 *
 * **一般語ストップリストは同梱しない。** 設計 §4-4 は英語の一般語リストを提案したが、独立レビューが
 * 示したとおり誤爆源は「他言語のラベルがたまたま別言語の普通の語と一致する」ケースで、
 * 人間の直感で列挙する方針は多言語辞書に対して原理的に破綻する。**実データを計測してから足せる
 * ように `options.bodyScanStopList` を口として開けてあるだけ**にしてある（既定は空）。
 */

import {
	clampConfidence,
	classifySurfaceScript,
	confidenceMargin,
	extractHashtags,
	isWordBoundaryMatch,
	normalizeExtractedTexts,
	normalizeMatchText,
	stripMatchSymbols,
	type ExtractedText,
	type ExtractedTextFieldKind,
	type NormalizedText,
} from "./textNormalize";

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

/** `dish_category_variants.source` の値域（`4_1_generate_variants.py` が作る 4 種のみ） */
export const DISH_CATEGORY_VARIANT_SOURCES = [
	"canonical-label-en",
	"wikidata-label",
	"kata2hira",
	"romaji",
] as const;

export type DishCategoryVariantSource = (typeof DISH_CATEGORY_VARIANT_SOURCES)[number];

/**
 * `dish_category_variants` の 1 行。**呼び出し側が DB から引いて渡す。**
 *
 * `source` は任意。渡されないときは `wikidata-label` と同じ扱い（減点なし）にする。
 * 「分からないから最悪を仮定して落とす」ではなく「分からないなら中庸」に倒すのは、
 * `source` を渡さない呼び出し側でも取りこぼしが増えないようにするため。
 */
export type DishCategoryVariantEntry = {
	dishCategoryId: string;
	surfaceForm: string;
	source?: DishCategoryVariantSource | string | null;
};

// ---------------------------------------------------------------------------
// 調整値（信頼度の数字はすべてここに集める）
// ---------------------------------------------------------------------------

/**
 * 信頼度の基礎点・加減点・閾値。**数字を触るときは必ずここだけを触ること。**
 * 各値の根拠はファイル冒頭の表にある。
 */
export const DISH_CATEGORY_MATCH_TUNING = {
	/** 一致の種別ごとの基礎点 */
	base: {
		exactText: 0.95,
		exactHashtag: 0.85,
		hashtagSuffixStripped: 0.7,
		bodyScan: 0.55,
	},
	/** 加減点 */
	adjustment: {
		/** `surface_form` が `longSurfaceFormMinLength` 以上 */
		longSurfaceForm: 0.1,
		/** 同一カテゴリが 2 箇所以上で一致（1 回まで） */
		repeatedMatch: 0.1,
		/** ラテン文字 3 文字以下の `surface_form` */
		shortLatinSurfaceForm: -0.2,
		/** 記号除去キー経由の一致 */
		symbolStrippedKey: -0.05,
		/** 本文走査 かつ `source='kata2hira'` */
		bodyScanKata2hira: -0.1,
		/** 本文走査 かつ `source='romaji'` */
		bodyScanRomaji: -0.2,
		/** 1 位と 2 位が拮抗しているときに上位 2 件へ */
		contested: -0.1,
	},
	threshold: {
		/** これ以上の長さの `surface_form` に `longSurfaceForm` 加点を与える */
		longSurfaceFormMinLength: 6,
		/** ラテン文字がこの長さ以下なら `shortLatinSurfaceForm` 減点 */
		shortLatinMaxLength: 3,
		/** 1 位と 2 位の差がこれ未満なら「拮抗」とみなす */
		contestedMargin: 0.1,
		/** 本文走査だけで得た候補の信頼度上限。**prefill 閾値より必ず小さいこと** */
		bodyScanCeiling: 0.75,
		/** prefill してよい最低信頼度 */
		prefillMinConfidence: 0.8,
		/** prefill してよい 1 位・2 位の最小差 */
		prefillMinMargin: 0.15,
		/** 返す候補の既定上限 */
		maxCandidates: 5,
	},
	/** 本文走査に載せる最小長（`surface_form` の文字種別） */
	bodyScanMinLength: {
		han: 2,
		kana: 3,
		latin: 4,
		other: 4,
	},
} as const;

/**
 * ハッシュタグから 1 つだけ剥がしてよい接尾辞（#1399 設計 §4-4-2）。
 *
 * 長いものから試す。剥がした残りが 2 文字未満になる剥がし方はしない
 * （`#朝活` → `朝` のような 1 文字を辞書に当てにいくと、当たったときに必ず誤りになる）。
 */
export const HASHTAG_STRIPPABLE_SUFFIXES = [
	"スタグラム",
	"倶楽部",
	"巡り",
	"好き",
	"gram",
	"_jp",
	"部",
	"活",
] as const;

/** 接尾辞を剥がしたあとに残っていなければならない最小長 */
const HASHTAG_SUFFIX_STRIPPED_MIN_LENGTH = 2;

/** 1 つの `surface_form` について本文走査で拾う一致の上限（同じ語の連呼で加点が伸びないように） */
const MAX_EVIDENCE_PER_SURFACE_FORM = 4;

/** 1 回の照合で作る根拠の総数上限（壊れた入力で計算量が跳ねないための保険） */
const MAX_TOTAL_EVIDENCE = 400;

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

/** 何をもって当たったとみなしたか */
export type DishCategoryMatchKind = "exact-text" | "exact-hashtag" | "hashtag-suffix-stripped" | "body-scan";

/**
 * 「どの `surface_form` のどこに当たったか」。
 *
 * `start` / `end` は **`normalizedTexts[fieldIndex].text` に対するオフセット**であって、
 * 呼び出し側が渡した生テキストのオフセットではない。NFKC は文字数を変えることがある
 * （`㍑` 1 文字 → `リットル` 4 文字）ので、原文へ機械的に写せない。ハイライトしたい呼び出し側は
 * 戻り値の `normalizedTexts` の方を表示に使うこと。
 */
export type DishCategoryMatchEvidence = {
	kind: DishCategoryMatchKind;
	/** 当たった辞書側の表記 */
	surfaceForm: string;
	source?: DishCategoryVariantSource | string | null;
	/** `normalizedTexts` の添字 */
	fieldIndex: number;
	field: ExtractedTextFieldKind;
	start: number;
	end: number;
	/** 記号除去キー経由で当たったか（`start`/`end` は元テキスト上の近似範囲になる） */
	viaSymbolStrippedKey: boolean;
	/** この根拠 1 本だけで得られる点（加減点込み・拮抗調整前） */
	score: number;
};

export type DishCategoryCandidate = {
	dishCategoryId: string;
	/** 0〜1。出し方はファイル冒頭の表を参照 */
	confidence: number;
	/** 1 始まりの順位 */
	rank: number;
	/** 強い順。最大 8 本まで */
	evidence: DishCategoryMatchEvidence[];
};

export type DishCategoryMatchResult = {
	/** 信頼度の降順。同点なら長い `surface_form` が当たった方が上 */
	candidates: DishCategoryCandidate[];
	/** `true` のときだけ確認画面へ prefill してよい。**それでもユーザーが直せる状態で見せること** */
	shouldPrefill: boolean;
	/** `shouldPrefill` が `true` のときの `dish_category_id`。それ以外は `null` */
	prefillDishCategoryId: string | null;
	/** 根拠のオフセットが指している正規化済みテキスト */
	normalizedTexts: NormalizedText[];
};

export type DishCategoryMatchOptions = {
	/**
	 * 本文走査から外す `surface_form`（正規化済みの形で渡す）。
	 *
	 * **既定は空。** 一般語ストップリストを想像で作らないという #1399 設計 §4-4 の指示に従い、
	 * 実データ（`SELECT surface_form FROM dish_category_variants WHERE char_length(surface_form) <= 3`）を
	 * 計測したうえで呼び出し側が渡す口としてだけ開けてある。
	 */
	bodyScanStopList?: readonly string[];
	/** 返す候補の上限。既定 5 */
	maxCandidates?: number;
};

// ---------------------------------------------------------------------------
// 辞書の索引
// ---------------------------------------------------------------------------

type ScannableEntry = {
	entry: DishCategoryVariantEntry;
	surfaceForm: string;
};

/**
 * 辞書を照合用に組み直したもの。**呼び出しをまたいで使い回してよい**（純粋な値）。
 *
 * 5,000 行規模なら組み直しは数ミリ秒なので `matchDishCategories` が毎回作っても実害は無いが、
 * import がバースト的に来る経路では `buildDishCategoryVariantIndex` の結果を持ち回ること。
 */
export type DishCategoryVariantIndex = {
	/** 正規化済み `surface_form` → 行。曖昧（同じ表記で複数カテゴリ）なものは含まない */
	exact: Map<string, DishCategoryVariantEntry>;
	/** 記号除去キー → 行。曖昧なものは含まない */
	symbolStripped: Map<string, DishCategoryVariantEntry>;
	/** 本文走査の対象になった行 */
	scannable: ScannableEntry[];
	/** 同じ表記に複数カテゴリがぶら下がっていて落とした件数（診断用） */
	ambiguousCount: number;
};

/**
 * 索引に載せてよい行か。`surface_form` が空・非文字列のものは黙って落とす。
 */
function normalizeEntry(entry: DishCategoryVariantEntry | null | undefined): ScannableEntry | null {
	if (!entry || typeof entry !== "object") return null;
	if (typeof entry.dishCategoryId !== "string" || entry.dishCategoryId.length === 0) return null;

	const surfaceForm = normalizeMatchText(entry.surfaceForm);
	if (surfaceForm.length === 0) return null;

	return { entry, surfaceForm };
}

/**
 * 完全一致用の Map へ入れる。**同じキーに別カテゴリが来たら両方落とす。**
 *
 * `dish_category_variants.surface_form` には DB 側でグローバル UNIQUE があるので通常は起きないが、
 * 記号除去キーは衝突しうる（`ab-c` と `a bc` が同じ `abc` になる）。
 * 衝突したまま片方を採ると「どちらか一方は必ず誤り」な候補を高信頼で出すことになるので、
 * **推測せずに落とす**（`snsUrl.ts` の「推測で補完しない」と同じ方針）。
 */
function putUnique(
	map: Map<string, DishCategoryVariantEntry>,
	ambiguous: Set<string>,
	key: string,
	entry: DishCategoryVariantEntry,
): void {
	if (key.length === 0 || ambiguous.has(key)) return;

	const existing = map.get(key);
	if (existing === undefined) {
		map.set(key, entry);
		return;
	}
	if (existing.dishCategoryId === entry.dishCategoryId) return;

	map.delete(key);
	ambiguous.add(key);
}

export function buildDishCategoryVariantIndex(
	entries: readonly DishCategoryVariantEntry[] | null | undefined,
	options?: DishCategoryMatchOptions,
): DishCategoryVariantIndex {
	const exact = new Map<string, DishCategoryVariantEntry>();
	const symbolStripped = new Map<string, DishCategoryVariantEntry>();
	const ambiguousExact = new Set<string>();
	const ambiguousStripped = new Set<string>();
	const scannable: ScannableEntry[] = [];

	const stopList = new Set<string>();
	for (const raw of options?.bodyScanStopList ?? []) {
		const normalized = normalizeMatchText(raw);
		if (normalized.length > 0) stopList.add(normalized);
	}

	for (const raw of entries ?? []) {
		const normalized = normalizeEntry(raw);
		if (normalized === null) continue;

		const { entry, surfaceForm } = normalized;
		putUnique(exact, ambiguousExact, surfaceForm, entry);

		const stripped = stripMatchSymbols(surfaceForm);
		if (stripped !== surfaceForm) {
			putUnique(symbolStripped, ambiguousStripped, stripped, entry);
		}

		if (!stopList.has(surfaceForm) && isBodyScanEligible(surfaceForm)) {
			scannable.push({ entry, surfaceForm });
		}
	}

	return {
		exact,
		symbolStripped,
		scannable,
		ambiguousCount: ambiguousExact.size + ambiguousStripped.size,
	};
}

/** 本文走査に載せてよい長さか（文字種別の最小長。冒頭の表を参照） */
export function isBodyScanEligible(normalizedSurfaceForm: string): boolean {
	const script = classifySurfaceScript(normalizedSurfaceForm);
	return normalizedSurfaceForm.length >= DISH_CATEGORY_MATCH_TUNING.bodyScanMinLength[script];
}

// ---------------------------------------------------------------------------
// 一致の点数
// ---------------------------------------------------------------------------

function baseScoreOf(kind: DishCategoryMatchKind): number {
	const { base } = DISH_CATEGORY_MATCH_TUNING;
	switch (kind) {
		case "exact-text":
			return base.exactText;
		case "exact-hashtag":
			return base.exactHashtag;
		case "hashtag-suffix-stripped":
			return base.hashtagSuffixStripped;
		default:
			return base.bodyScan;
	}
}

/**
 * 根拠 1 本の点。**`source` による減点は本文走査にだけ効かせる。**
 *
 * ハッシュタグでローマ字の別名（`#ramen`）に当たったのは投稿者が自分でそう書いたということで、
 * 「ローマ字は一般英単語と衝突する」という減点の理由が当てはまらないためである。
 */
function scoreEvidence(
	kind: DishCategoryMatchKind,
	surfaceForm: string,
	source: DishCategoryVariantSource | string | null | undefined,
	viaSymbolStrippedKey: boolean,
): number {
	const { adjustment, threshold } = DISH_CATEGORY_MATCH_TUNING;
	let score = baseScoreOf(kind);

	if (surfaceForm.length >= threshold.longSurfaceFormMinLength) {
		score += adjustment.longSurfaceForm;
	}
	if (
		classifySurfaceScript(surfaceForm) === "latin" &&
		surfaceForm.length <= threshold.shortLatinMaxLength
	) {
		score += adjustment.shortLatinSurfaceForm;
	}
	if (viaSymbolStrippedKey) {
		score += adjustment.symbolStrippedKey;
	}
	if (kind === "body-scan") {
		if (source === "kata2hira") score += adjustment.bodyScanKata2hira;
		else if (source === "romaji") score += adjustment.bodyScanRomaji;
	}

	return score;
}

// ---------------------------------------------------------------------------
// 照合本体
// ---------------------------------------------------------------------------

/** 根拠と、それが指す `dish_category_id`。**カテゴリは拾った時点のものを持ち回る**（あとで引き直さない） */
type CollectedEvidence = {
	dishCategoryId: string;
	evidence: DishCategoryMatchEvidence;
};

type EvidenceCollector = {
	items: CollectedEvidence[];
	seen: Set<string>;
};

function pushEvidence(
	collector: EvidenceCollector,
	dishCategoryId: string,
	evidence: DishCategoryMatchEvidence,
): void {
	if (collector.items.length >= MAX_TOTAL_EVIDENCE) return;

	const key = `${dishCategoryId}\u0000${evidence.kind}\u0000${evidence.fieldIndex}\u0000${evidence.start}\u0000${evidence.surfaceForm}`;
	if (collector.seen.has(key)) return;

	collector.seen.add(key);
	collector.items.push({ dishCategoryId, evidence });
}

/** 完全一致（正規表記 → 記号除去キーの順）で辞書を引く */
function lookupExact(
	index: DishCategoryVariantIndex,
	token: string,
): { entry: DishCategoryVariantEntry; viaSymbolStrippedKey: boolean } | null {
	const direct = index.exact.get(token);
	if (direct !== undefined) return { entry: direct, viaSymbolStrippedKey: false };

	const stripped = stripMatchSymbols(token);
	if (stripped.length === 0) return null;

	const byStripped = index.symbolStripped.get(stripped) ?? index.exact.get(stripped);
	if (byStripped !== undefined) return { entry: byStripped, viaSymbolStrippedKey: true };

	return null;
}

/** 末尾の接尾辞を 1 つだけ剥がす。剥がせなければ `null` */
function stripHashtagSuffix(tag: string): string | null {
	for (const suffix of HASHTAG_STRIPPABLE_SUFFIXES) {
		if (tag.length > suffix.length && tag.slice(tag.length - suffix.length) === suffix) {
			const rest = tag.slice(0, tag.length - suffix.length);
			if (rest.length >= HASHTAG_SUFFIX_STRIPPED_MIN_LENGTH) return rest;
			return null;
		}
	}
	return null;
}

function collectExactTextMatches(
	index: DishCategoryVariantIndex,
	normalized: NormalizedText,
	collector: EvidenceCollector,
): void {
	// `hashtag` フィールドは「本文がまるごと料理名」ではなく「タグが料理名」なので 1 段弱い扱いにする
	const kind: DishCategoryMatchKind = normalized.field === "hashtag" ? "exact-hashtag" : "exact-text";
	const token = normalized.field === "hashtag" ? normalized.text.replace(/^#/, "") : normalized.text;
	if (token.length === 0) return;

	const hit = lookupExact(index, token);
	if (hit === null) return;

	pushEvidence(collector, hit.entry.dishCategoryId, {
		kind,
		surfaceForm: normalizeMatchText(hit.entry.surfaceForm),
		source: hit.entry.source,
		fieldIndex: normalized.index,
		field: normalized.field,
		start: normalized.field === "hashtag" && normalized.text.charAt(0) === "#" ? 1 : 0,
		end: normalized.text.length,
		viaSymbolStrippedKey: hit.viaSymbolStrippedKey,
		score: scoreEvidence(
			kind,
			normalizeMatchText(hit.entry.surfaceForm),
			hit.entry.source,
			hit.viaSymbolStrippedKey,
		),
	});
}

function collectHashtagMatches(
	index: DishCategoryVariantIndex,
	normalized: NormalizedText,
	collector: EvidenceCollector,
): void {
	for (const token of extractHashtags(normalized.text)) {
		const direct = lookupExact(index, token.tag);
		if (direct !== null) {
			const surfaceForm = normalizeMatchText(direct.entry.surfaceForm);
			pushEvidence(collector, direct.entry.dishCategoryId, {
				kind: "exact-hashtag",
				surfaceForm,
				source: direct.entry.source,
				fieldIndex: normalized.index,
				field: normalized.field,
				start: token.start,
				end: token.end,
				viaSymbolStrippedKey: direct.viaSymbolStrippedKey,
				score: scoreEvidence("exact-hashtag", surfaceForm, direct.entry.source, direct.viaSymbolStrippedKey),
			});
			continue;
		}

		const stripped = stripHashtagSuffix(token.tag);
		if (stripped === null) continue;

		const viaSuffix = lookupExact(index, stripped);
		if (viaSuffix === null) continue;

		const surfaceForm = normalizeMatchText(viaSuffix.entry.surfaceForm);
		pushEvidence(collector, viaSuffix.entry.dishCategoryId, {
			kind: "hashtag-suffix-stripped",
			surfaceForm,
			source: viaSuffix.entry.source,
			fieldIndex: normalized.index,
			field: normalized.field,
			start: token.start,
			end: token.end,
			viaSymbolStrippedKey: viaSuffix.viaSymbolStrippedKey,
			score: scoreEvidence(
				"hashtag-suffix-stripped",
				surfaceForm,
				viaSuffix.entry.source,
				viaSuffix.viaSymbolStrippedKey,
			),
		});
	}
}

function collectBodyScanMatches(
	index: DishCategoryVariantIndex,
	normalized: NormalizedText,
	collector: EvidenceCollector,
): void {
	for (const { entry, surfaceForm } of index.scannable) {
		let found = 0;
		let at = normalized.text.indexOf(surfaceForm);

		while (at !== -1 && found < MAX_EVIDENCE_PER_SURFACE_FORM) {
			const end = at + surfaceForm.length;
			if (isWordBoundaryMatch(normalized.text, at, end, surfaceForm)) {
				pushEvidence(collector, entry.dishCategoryId, {
					kind: "body-scan",
					surfaceForm,
					source: entry.source,
					fieldIndex: normalized.index,
					field: normalized.field,
					start: at,
					end,
					viaSymbolStrippedKey: false,
					score: scoreEvidence("body-scan", surfaceForm, entry.source, false),
				});
				found += 1;
			}
			at = normalized.text.indexOf(surfaceForm, at + 1);
		}
	}
}

/**
 * 「何箇所で当たったか」を **重なり合わない範囲の数**で数える。
 *
 * 単純に `(fieldIndex, start, end)` の異なり数で数えると、`#ラーメン部` の 1 か所が
 * 「ハッシュタグ接尾辞剥がしの一致（6..11）」と「本文走査の一致（6..10）」の 2 箇所に見え、
 * **同じ 1 回の言及で「2 箇所以上」の加点が付いてしまう**。加点の意図は
 * 「独立した言及が 2 回あった」なので、重なっているものは 1 箇所として数える。
 */
function countDisjointSites(evidenceList: readonly DishCategoryMatchEvidence[]): number {
	const sites = evidenceList
		.map((evidence) => ({ field: evidence.fieldIndex, start: evidence.start, end: evidence.end }))
		.sort((a, b) => (a.field !== b.field ? a.field - b.field : a.start - b.start));

	let count = 0;
	let currentField = -1;
	let currentEnd = -1;

	for (const site of sites) {
		if (site.field !== currentField || site.start >= currentEnd) {
			count += 1;
			currentField = site.field;
			currentEnd = site.end;
		} else if (site.end > currentEnd) {
			currentEnd = site.end;
		}
	}
	return count;
}

/** 強い順（点 → 長い `surface_form` → 表記の辞書順）。同点でも並びが決まるようにする */
function compareEvidence(a: DishCategoryMatchEvidence, b: DishCategoryMatchEvidence): number {
	if (b.score !== a.score) return b.score - a.score;
	if (b.surfaceForm.length !== a.surfaceForm.length) return b.surfaceForm.length - a.surfaceForm.length;
	return a.surfaceForm < b.surfaceForm ? -1 : a.surfaceForm > b.surfaceForm ? 1 : 0;
}

/**
 * 抽出テキストから料理カテゴリ候補を出す。
 *
 * @param texts SNS のメタデータから取れたテキスト（title / description / caption / hashtag）
 * @param dictionary `dish_category_variants` の行。**呼び出し側が DB から引いて渡す**
 */
export function matchDishCategories(
	texts: readonly ExtractedText[] | null | undefined,
	dictionary: readonly DishCategoryVariantEntry[] | null | undefined,
	options?: DishCategoryMatchOptions,
): DishCategoryMatchResult {
	return matchDishCategoriesWithIndex(texts, buildDishCategoryVariantIndex(dictionary, options), options);
}

/** 索引を作り置きしてある呼び出し側向け。判定そのものは `matchDishCategories` と同一。 */
export function matchDishCategoriesWithIndex(
	texts: readonly ExtractedText[] | null | undefined,
	index: DishCategoryVariantIndex,
	options?: DishCategoryMatchOptions,
): DishCategoryMatchResult {
	const { adjustment, threshold } = DISH_CATEGORY_MATCH_TUNING;
	const normalizedTexts = normalizeExtractedTexts(texts);
	const collector: EvidenceCollector = { items: [], seen: new Set<string>() };

	for (const normalized of normalizedTexts) {
		collectExactTextMatches(index, normalized, collector);
		collectHashtagMatches(index, normalized, collector);
		collectBodyScanMatches(index, normalized, collector);
	}

	// カテゴリごとにまとめる
	const byCategory = new Map<string, DishCategoryMatchEvidence[]>();
	for (const collected of collector.items) {
		const bucket = byCategory.get(collected.dishCategoryId);
		if (bucket === undefined) byCategory.set(collected.dishCategoryId, [collected.evidence]);
		else bucket.push(collected.evidence);
	}

	const candidates: DishCategoryCandidate[] = [];
	byCategory.forEach((evidenceList, dishCategoryId) => {
		evidenceList.sort(compareEvidence);

		let confidence = evidenceList[0].score;

		// 「2 箇所以上で当たった」は独立した証拠が 2 本あるということ。1 回だけ加点する
		if (countDisjointSites(evidenceList) >= 2) confidence += adjustment.repeatedMatch;

		// 本文走査だけの候補は prefill 閾値へ届かせない（冒頭の不変条件）
		const bodyScanOnly = evidenceList.every((evidence) => evidence.kind === "body-scan");
		if (bodyScanOnly && confidence > threshold.bodyScanCeiling) {
			confidence = threshold.bodyScanCeiling;
		}

		candidates.push({
			dishCategoryId,
			confidence: clampConfidence(confidence),
			rank: 0,
			evidence: evidenceList.slice(0, 8),
		});
	});

	sortCandidates(candidates);

	// 拮抗調整。1 位と 2 位の差が小さいときは「どちらとも言えない」ので両方下げる。
	// 下げ幅は同じなので 1 位・2 位の順序は変わらないが、3 位以下と入れ替わりうるので並べ直す。
	if (
		candidates.length >= 2 &&
		confidenceMargin(candidates[0].confidence, candidates[1].confidence) < threshold.contestedMargin
	) {
		candidates[0].confidence = clampConfidence(candidates[0].confidence + adjustment.contested);
		candidates[1].confidence = clampConfidence(candidates[1].confidence + adjustment.contested);
		sortCandidates(candidates);
	}

	// prefill の判断は **切り詰める前の全候補**で行う。`maxCandidates: 1` を渡した呼び出し側が
	// 「2 位が居ないので差は無限大」と読んで prefill してしまうのを防ぐ。
	const margin =
		candidates.length >= 2
			? confidenceMargin(candidates[0].confidence, candidates[1].confidence)
			: Number.POSITIVE_INFINITY;
	const shouldPrefill =
		candidates.length >= 1 &&
		candidates[0].confidence >= threshold.prefillMinConfidence &&
		margin >= threshold.prefillMinMargin;

	const maxCandidates = options?.maxCandidates ?? threshold.maxCandidates;
	const top = candidates.slice(0, Math.max(0, maxCandidates));
	for (let i = 0; i < top.length; i += 1) top[i].rank = i + 1;

	return {
		candidates: top,
		shouldPrefill,
		prefillDishCategoryId: shouldPrefill ? candidates[0].dishCategoryId : null,
		normalizedTexts,
	};
}

/**
 * 信頼度の降順。同点なら**長い `surface_form` が当たった方を上**にする（#1399 設計 §4-4-7）。
 *
 * `dish_categories` に親子関係の列が無いので「味噌ラーメン と ラーメン のどちらが下位か」は
 * 階層では解けない。より具体的な（＝長い）表記に当たった方を上に置く、という規則で代替している。
 */
function sortCandidates(candidates: DishCategoryCandidate[]): void {
	candidates.sort((a, b) => {
		if (b.confidence !== a.confidence) return b.confidence - a.confidence;

		const aLength = a.evidence[0]?.surfaceForm.length ?? 0;
		const bLength = b.evidence[0]?.surfaceForm.length ?? 0;
		if (bLength !== aLength) return bLength - aLength;

		return a.dishCategoryId < b.dishCategoryId ? -1 : a.dishCategoryId > b.dishCategoryId ? 1 : 0;
	});
}
