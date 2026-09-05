/**
 * `matchDishCategories` の仕様固定テスト（#1399 解くべき問い 3）。
 *
 * **「こう動く」ではなく「こう間違えない」を書く。** 具体的には次の 2 方向を両方固定する。
 *
 * - **誤爆**: 無関係な語に当たらないこと。独立レビューが実データ（5,028 行）で再現した
 *   4 件（`ぱい` / `パイ` / `glass` / `papa`）を回帰テストとして持っている
 * - **取りこぼし**: 当たるべきものに当たること。境界規則を厳しくしすぎると
 *   `おいしいうどん` `絶品味噌ラーメン` `カレーが好き` を落とすので、そちらも固定する
 *
 * 辞書はすべてこのファイル内で組み立てる。**DB もネットワークも使わない。**
 * 表記は実物の `dish_category_variants` に合わせてある（`surface_form` は norm_key 済みの形）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	buildDishCategoryVariantIndex,
	DISH_CATEGORY_MATCH_TUNING,
	HASHTAG_STRIPPABLE_SUFFIXES,
	isBodyScanEligible,
	matchDishCategories,
	matchDishCategoriesWithIndex,
	type DishCategoryMatchResult,
	type DishCategoryVariantEntry,
} from "../dishCategoryMatch";
import { clampConfidence, type ExtractedText } from "../textNormalize";

// ---------------------------------------------------------------------------
// テスト用の辞書
//
// 実データの構成（wikidata-label が大半、ja からの kata2hira / romaji 派生、
// 他言語ラベルが普通の語と衝突する）を小さく再現したもの。
// ---------------------------------------------------------------------------

const DICT: DishCategoryVariantEntry[] = [
	{ dishCategoryId: "ramen", surfaceForm: "ラーメン", source: "wikidata-label" },
	{ dishCategoryId: "ramen", surfaceForm: "らーめん", source: "kata2hira" },
	{ dishCategoryId: "ramen", surfaceForm: "ramen", source: "romaji" },
	{ dishCategoryId: "miso-ramen", surfaceForm: "味噌ラーメン", source: "wikidata-label" },
	{ dishCategoryId: "udon", surfaceForm: "うどん", source: "wikidata-label" },
	{ dishCategoryId: "sushi", surfaceForm: "寿司", source: "wikidata-label" },
	{ dishCategoryId: "curry", surfaceForm: "カレー", source: "wikidata-label" },
	{ dishCategoryId: "curry-rice", surfaceForm: "カレーライス", source: "wikidata-label" },
	{ dishCategoryId: "pasta", surfaceForm: "pasta", source: "canonical-label-en" },
	{ dishCategoryId: "steak", surfaceForm: "steak", source: "canonical-label-en" },
	{ dishCategoryId: "hot-dog", surfaceForm: "hot dog", source: "canonical-label-en" },
	{ dishCategoryId: "pho", surfaceForm: "pho", source: "canonical-label-en" },

	// ここから下が「実データに実在する誤爆源」。独立レビュー M-4 の実測に基づく
	{ dishCategoryId: "pie", surfaceForm: "パイ", source: "wikidata-label" },
	{ dishCategoryId: "pie", surfaceForm: "ぱい", source: "kata2hira" },
	{ dishCategoryId: "pie", surfaceForm: "pie", source: "canonical-label-en" },
	/** スウェーデン語で「アイスクリーム」。英語の glass と綴りが同じ */
	{ dishCategoryId: "ice-cream", surfaceForm: "glass", source: "wikidata-label" },
	/** 各国語で「粥」。英語の papa（パパ）と綴りが同じ */
	{ dishCategoryId: "porridge", surfaceForm: "papa", source: "wikidata-label" },
	/** 1 文字ラベル。何にでも当たるので本文走査から落ちていなければならない */
	{ dishCategoryId: "rice-grain", surfaceForm: "飯", source: "wikidata-label" },
	{ dishCategoryId: "tea", surfaceForm: "tea", source: "canonical-label-en" },
];

function caption(text: string): ExtractedText[] {
	return [{ field: "caption", text }];
}

function run(texts: ExtractedText[]): DishCategoryMatchResult {
	return matchDishCategories(texts, DICT);
}

/** 候補に挙がったカテゴリ ID を順位順で返す */
function ids(result: DishCategoryMatchResult): string[] {
	return result.candidates.map((candidate) => candidate.dishCategoryId);
}

function confidenceOf(result: DishCategoryMatchResult, dishCategoryId: string): number | undefined {
	return result.candidates.find((candidate) => candidate.dishCategoryId === dishCategoryId)?.confidence;
}

// ---------------------------------------------------------------------------
// 誤爆させない — 独立レビューが実データで再現した 4 件
// ---------------------------------------------------------------------------

test("誤爆させない: 「お腹いっぱい」の `ぱい` をパイとして拾わない", () => {
	// kata2hira 由来の 2 文字は、日本語グルメキャプションで最頻出クラスの語を踏む
	const result = run(caption("今日のランチ！お腹いっぱい食べました🍜 #ラーメン"));
	assert.ok(!ids(result).includes("pie"), `pie が混ざった: ${JSON.stringify(ids(result))}`);
	assert.deepEqual(ids(result), ["ramen"]);
});

test("誤爆させない: 「パイナップル」の `パイ` をパイとして拾わない", () => {
	// 長さ（かなのみ 3 文字未満）とカタカナの並びの境界の、二重で止める
	const result = run(caption("パイナップルジュースが最高だった件"));
	assert.deepEqual(ids(result), []);
	assert.equal(result.shouldPrefill, false);
});

test("誤爆させない: 1 文字の別名は本文走査に載せない", () => {
	// `飯` は「ご飯」「炊飯」「飯田橋」等、無関係な語に無限に当たる
	assert.equal(isBodyScanEligible("飯"), false);
	assert.ok(!ids(run(caption("炊飯器を買った話"))).includes("rice-grain"));
});

test("誤爆させない: ラテン文字 3 文字以下の別名は本文走査に載せない", () => {
	assert.equal(isBodyScanEligible("tea"), false);
	assert.equal(isBodyScanEligible("pho"), false);
	assert.equal(isBodyScanEligible("pie"), false);
	assert.ok(!ids(run(caption("a great steak dinner with tea"))).includes("tea"));
});

test("誤爆させない: 他言語ラベルが普通の語と衝突しても、候補チップ止まりで prefill しない", () => {
	// `glass`（スウェーデン語=アイス）と `papa`（粥）は本文走査では止められない。
	// 止められないものを「止めた」ことにせず、**prefill されないこと**を保証する。
	const glass = run([{ field: "description", text: "have a glass of wine with this steak dinner" }]);
	assert.ok(ids(glass).includes("ice-cream"), "誤爆自体は起きる（それが実態）");
	assert.equal(glass.shouldPrefill, false);
	assert.ok((confidenceOf(glass, "ice-cream") ?? 1) <= DISH_CATEGORY_MATCH_TUNING.threshold.bodyScanCeiling);

	const papa = run([{ field: "description", text: "papa took me here! best pasta ever" }]);
	assert.ok(ids(papa).includes("porridge"));
	assert.equal(papa.shouldPrefill, false);
});

test("誤爆させない: `ice` が `nice` に当たらない（ラテン文字の語境界）", () => {
	const dict: DishCategoryVariantEntry[] = [
		{ dishCategoryId: "ice-cream", surfaceForm: "ice cream", source: "canonical-label-en" },
	];
	assert.deepEqual(matchDishCategories(caption("what a nice creamy dessert"), dict).candidates, []);
	assert.deepEqual(
		matchDishCategories(caption("i had ice cream"), dict).candidates.map((c) => c.dishCategoryId),
		["ice-cream"],
	);
});

test("誤爆させない: `カレー` が `カレーライス` の一部として当たらない", () => {
	const result = run(caption("カレーライスを食べた"));
	assert.deepEqual(ids(result), ["curry-rice"]);
});

test("誤爆させない: 同じ表記に複数カテゴリがぶら下がっていたら、どちらも採らない", () => {
	// DB のグローバル UNIQUE では起きないが、呼び出し側が壊れた配列を渡す可能性がある。
	// 「どちらか一方は必ず誤り」な候補を高信頼で出すくらいなら、推測せず落とす。
	const conflicting: DishCategoryVariantEntry[] = [
		{ dishCategoryId: "a", surfaceForm: "ラーメン" },
		{ dishCategoryId: "b", surfaceForm: "ラーメン" },
	];
	const index = buildDishCategoryVariantIndex(conflicting);
	assert.equal(index.exact.has("ラーメン"), false);
	assert.equal(index.ambiguousCount, 1);

	const result = matchDishCategories([{ field: "title", text: "ラーメン" }], conflicting);
	assert.equal(result.shouldPrefill, false);
});

test("誤爆させない: `author_name` を混ぜないこと（フィールドの種別は呼び出し側が決める）", () => {
	// 「ラーメン太郎」という投稿者名は「この投稿が味噌ラーメンである」根拠にならない。
	// 本関数はテキストを素直に見るだけなので、**author_name を texts に入れないのは呼び出し側の責務**。
	// ここではその前提を明示するために、入れてしまった場合に何が起きるかを固定しておく。
	const result = run([{ field: "title", text: "ラーメン太郎チャンネル" }]);
	assert.deepEqual(ids(result), ["ramen"]);
	assert.equal(result.shouldPrefill, false, "本文走査だけなので prefill には至らない");
});

test("誤爆させない: ストップリストに入れた表記は本文走査から消える", () => {
	const withStop = matchDishCategories(
		[{ field: "description", text: "have a glass of wine" }],
		DICT,
		{ bodyScanStopList: ["glass"] },
	);
	assert.deepEqual(withStop.candidates, []);
});

// ---------------------------------------------------------------------------
// 取りこぼさない
// ---------------------------------------------------------------------------

test("取りこぼさない: 助詞に囲まれた日本語の料理名を拾う", () => {
	assert.ok(ids(run(caption("カレーが好き"))).includes("curry"));
	assert.ok(ids(run(caption("おいしいうどんでした"))).includes("udon"));
	assert.ok(ids(run(caption("回転寿司に行った"))).includes("sushi"));
	assert.ok(ids(run(caption("今日はラーメンを食べた"))).includes("ramen"));
});

test("取りこぼさない: 表記ゆれ（全角英数・半角カナ・大文字）を吸収する", () => {
	for (const text of ["ﾗｰﾒﾝ食べた", "ラーメン食べた", "今日は RAMEN", "今日は Ramen"]) {
		assert.ok(ids(run(caption(text))).includes("ramen"), text);
	}
});

test("取りこぼさない: 記号除去キーで、記号入りの別名とハッシュタグが噛み合う", () => {
	// 辞書側 `hot dog` と投稿側 `#hotdog` は、両側に同じ記号除去を当てて初めて一致する
	const result = run(caption("うまい #hotdog"));
	assert.deepEqual(ids(result), ["hot-dog"]);
	assert.equal(result.candidates[0].evidence[0].viaSymbolStrippedKey, true);
});

test("取りこぼさない: ハッシュタグの接尾辞を 1 つ剥がして辞書を引く", () => {
	for (const [text, expected] of [
		["うまい #ラーメン部", "ramen"],
		["#カレー活 だった", "curry"],
		["#うどん好き", "udon"],
		["#寿司巡り", "sushi"],
	] as const) {
		assert.ok(ids(run(caption(text))).includes(expected), text);
	}
});

test("取りこぼさない: 剥がしてよい接尾辞は設計で決めた 8 種だけ", () => {
	assert.deepEqual([...HASHTAG_STRIPPABLE_SUFFIXES].sort(), [
		"_jp",
		"gram",
		"スタグラム",
		"倶楽部",
		"好き",
		"巡り",
		"活",
		"部",
	]);
});

test("誤爆させない: 接尾辞を剥がした残りが 1 文字になる剥がし方はしない", () => {
	// `#朝活` → `朝` を辞書に当てにいくと、当たったときに必ず誤りになる
	const dict: DishCategoryVariantEntry[] = [{ dishCategoryId: "morning", surfaceForm: "朝" }];
	assert.deepEqual(matchDishCategories(caption("#朝活 いってきます"), dict).candidates, []);
});

// ---------------------------------------------------------------------------
// 信頼度と順位
// ---------------------------------------------------------------------------

test("信頼度: 一致の種別ごとに、設計どおりの基礎点が付く", () => {
	const { base } = DISH_CATEGORY_MATCH_TUNING;

	// フィールド全体が料理名 → 0.95
	assert.equal(confidenceOf(run([{ field: "title", text: "ラーメン" }]), "ramen"), base.exactText);
	// ハッシュタグ完全一致 → 0.85
	assert.equal(confidenceOf(run(caption("うまかった #ラーメン")), "ramen"), base.exactHashtag);
	// 接尾辞剥がし → 0.70
	assert.equal(confidenceOf(run(caption("#ラーメン部")), "ramen"), base.hashtagSuffixStripped);
	// 本文走査 → 0.55
	assert.equal(confidenceOf(run(caption("今日はラーメンを食べた")), "ramen"), base.bodyScan);
});

test("信頼度: `hashtag` フィールド全体の一致は `exact-text` ではなく `exact-hashtag` にする", () => {
	// タグが料理名であることは、本文が料理名であることより 1 段弱い根拠にしかならない
	const result = matchDishCategories([{ field: "hashtag", text: "#ラーメン" }], DICT);
	assert.equal(result.candidates[0].evidence[0].kind, "exact-hashtag");
	assert.equal(result.candidates[0].confidence, DISH_CATEGORY_MATCH_TUNING.base.exactHashtag);
});

test("信頼度: 6 文字以上の別名に +0.10、本文中の kata2hira / romaji に減点", () => {
	const { base, adjustment } = DISH_CATEGORY_MATCH_TUNING;

	// 6 文字以上
	assert.equal(
		confidenceOf(run(caption("絶品味噌ラーメンを食べた")), "miso-ramen"),
		clampConfidence(base.bodyScan + adjustment.longSurfaceForm),
	);
	// kata2hira 由来（ひらがな表記）
	assert.equal(
		confidenceOf(run(caption("きょうはらーめんでした")), "ramen"),
		clampConfidence(base.bodyScan + adjustment.bodyScanKata2hira),
	);
	// romaji 由来
	assert.equal(
		confidenceOf(run([{ field: "description", text: "i love ramen so much" }]), "ramen"),
		clampConfidence(base.bodyScan + adjustment.bodyScanRomaji),
	);
});

test("信頼度: source の減点は本文走査にだけ効かせる（ハッシュタグには効かせない）", () => {
	// `#ramen` は投稿者が自分でそう書いたということなので、「ローマ字は英単語と衝突する」
	// という減点の理由が当てはまらない
	assert.equal(
		confidenceOf(run(caption("うまい #ramen")), "ramen"),
		DISH_CATEGORY_MATCH_TUNING.base.exactHashtag,
	);
});

test("信頼度: 別のフィールドでも当たれば +0.10（独立した 2 つ目の証拠）", () => {
	const { base, adjustment } = DISH_CATEGORY_MATCH_TUNING;
	const result = matchDishCategories(
		[
			{ field: "title", text: "今日はラーメンを食べた" },
			{ field: "description", text: "近所のラーメン屋にて" },
		],
		DICT,
	);
	assert.equal(confidenceOf(result, "ramen"), clampConfidence(base.bodyScan + adjustment.repeatedMatch));
});

test("誤爆させない: 同じ 1 か所の言及を「2 箇所」と数えない", () => {
	// `#ラーメン部` は「接尾辞剥がしの一致」と「本文走査の一致」が重なって取れるが、
	// 独立した 2 回の言及ではない。数えてしまうと 0.70 + 0.10 = 0.80 で prefill 閾値に届く
	const result = run(caption("#ラーメン部"));
	assert.equal(confidenceOf(result, "ramen"), DISH_CATEGORY_MATCH_TUNING.base.hashtagSuffixStripped);
	assert.equal(result.shouldPrefill, false);
});

test("順位: より長い（＝より具体的な）別名に当たった方を上に置く", () => {
	// `dish_categories` に親子関係の列が無いので、階層ではなく表記の長さで解く
	const result = run(caption("絶品味噌ラーメンを食べた"));
	assert.deepEqual(ids(result), ["miso-ramen", "ramen"]);
	assert.equal(result.candidates[0].rank, 1);
	assert.equal(result.candidates[1].rank, 2);
});

test("順位: 拮抗している上位 2 件は両方下げる（どちらとも言えないものを prefill しない）", () => {
	const { base, adjustment } = DISH_CATEGORY_MATCH_TUNING;
	const result = run([{ field: "description", text: "steak and pasta" }]);
	assert.equal(result.candidates.length, 2);
	assert.equal(result.candidates[0].confidence, clampConfidence(base.bodyScan + adjustment.contested));
	assert.equal(result.candidates[1].confidence, clampConfidence(base.bodyScan + adjustment.contested));
	assert.equal(result.shouldPrefill, false);
});

// ---------------------------------------------------------------------------
// prefill の規則
// ---------------------------------------------------------------------------

test("prefill: 0.80 以上 かつ 2 位との差 0.15 以上のときだけ立つ", () => {
	const { threshold } = DISH_CATEGORY_MATCH_TUNING;
	assert.equal(threshold.prefillMinConfidence, 0.8);
	assert.equal(threshold.prefillMinMargin, 0.15);

	const strong = run([{ field: "title", text: "ラーメン" }]);
	assert.equal(strong.shouldPrefill, true);
	assert.equal(strong.prefillDishCategoryId, "ramen");

	const weak = run(caption("今日はラーメンを食べた"));
	assert.equal(weak.shouldPrefill, false);
	assert.equal(weak.prefillDishCategoryId, null);
});

test("prefill: 不変条件として、本文走査だけで得た候補は絶対に prefill 閾値へ届かない", () => {
	const { threshold, base, adjustment } = DISH_CATEGORY_MATCH_TUNING;

	// (1) 上限そのものが閾値より小さい
	assert.ok(
		threshold.bodyScanCeiling < threshold.prefillMinConfidence,
		`${threshold.bodyScanCeiling} < ${threshold.prefillMinConfidence}`,
	);
	// (2) 加点をすべて積んでも上限に一致するだけ（0.55 + 0.10 + 0.10 = 0.75）
	assert.equal(
		clampConfidence(base.bodyScan + adjustment.longSurfaceForm + adjustment.repeatedMatch),
		threshold.bodyScanCeiling,
	);

	// (3) 実際に、加点が最大に乗る入力でも prefill しない
	const maxed = matchDishCategories(
		[
			{ field: "title", text: "絶品味噌ラーメンの店" },
			{ field: "description", text: "また味噌ラーメンを食べに来た" },
		],
		DICT,
	);
	assert.ok((confidenceOf(maxed, "miso-ramen") ?? 1) <= threshold.bodyScanCeiling);
	assert.equal(maxed.shouldPrefill, false);
});

test("prefill: maxCandidates を絞っても、切り捨てた 2 位を無視して prefill しない", () => {
	// `maxCandidates: 1` を渡した呼び出し側が「2 位が居ないので差は無限大」と読むのを防ぐ
	const result = matchDishCategories([{ field: "description", text: "steak and pasta" }], DICT, {
		maxCandidates: 1,
	});
	assert.equal(result.candidates.length, 1);
	assert.equal(result.shouldPrefill, false);
});

test("prefill: 候補が 0 件なら立たない", () => {
	const result = run(caption("今日はいい天気でした"));
	assert.deepEqual(result.candidates, []);
	assert.equal(result.shouldPrefill, false);
	assert.equal(result.prefillDishCategoryId, null);
});

// ---------------------------------------------------------------------------
// 根拠（どの surface_form のどこに当たったか）
// ---------------------------------------------------------------------------

test("根拠: どの表記が、どのフィールドのどこに当たったかを返す", () => {
	const result = run(caption("今日はラーメンを食べた"));
	const evidence = result.candidates[0].evidence[0];

	assert.equal(evidence.kind, "body-scan");
	assert.equal(evidence.surfaceForm, "ラーメン");
	assert.equal(evidence.source, "wikidata-label");
	assert.equal(evidence.field, "caption");
	assert.equal(evidence.fieldIndex, 0);

	// オフセットは **正規化済みテキスト**に対するもの。戻り値の normalizedTexts で切り出せる
	const text = result.normalizedTexts[evidence.fieldIndex].text;
	assert.equal(text.slice(evidence.start, evidence.end), "ラーメン");
});

test("根拠: 正規化でずれるオフセットも、normalizedTexts の側と必ず一致する", () => {
	// 半角カナは NFKC で文字数が変わる（ﾗｰﾒﾝ 4 文字 → ラーメン 4 文字だが、濁点付きは縮む）
	const result = run(caption("きょうは ﾊﾞｰｶﾞｰ ではなく ﾗｰﾒﾝ"));
	for (const candidate of result.candidates) {
		for (const evidence of candidate.evidence) {
			const text = result.normalizedTexts[evidence.fieldIndex].text;
			assert.equal(text.slice(evidence.start, evidence.end), evidence.surfaceForm);
		}
	}
});

// ---------------------------------------------------------------------------
// 索引の再利用・壊れた入力
// ---------------------------------------------------------------------------

test("索引を作り置きしても、毎回作り直したときと同じ結果になる", () => {
	const index = buildDishCategoryVariantIndex(DICT);
	const texts = caption("うまい #ラーメン と 味噌ラーメン");

	const viaIndex = matchDishCategoriesWithIndex(texts, index);
	const viaEntries = matchDishCategories(texts, DICT);
	assert.deepEqual(viaIndex.candidates, viaEntries.candidates);
	assert.equal(viaIndex.shouldPrefill, viaEntries.shouldPrefill);
});

test("壊れた入力でも例外を投げない（SNS の生データを素通しできること）", () => {
	for (const texts of [null, undefined, [], [{ field: "caption", text: "" }]] as const) {
		const result = matchDishCategories(texts as ExtractedText[] | null, DICT);
		assert.deepEqual(result.candidates, []);
		assert.equal(result.shouldPrefill, false);
	}
	for (const dictionary of [null, undefined, []] as const) {
		const result = matchDishCategories(caption("ラーメン"), dictionary as DishCategoryVariantEntry[] | null);
		assert.deepEqual(result.candidates, []);
	}
	// 行の形が壊れていても、その行だけ落として続ける
	const broken = [
		null,
		{ dishCategoryId: "", surfaceForm: "ラーメン" },
		{ dishCategoryId: "ramen", surfaceForm: "  " },
		{ dishCategoryId: "ramen", surfaceForm: "ラーメン" },
	] as unknown as DishCategoryVariantEntry[];
	assert.deepEqual(
		matchDishCategories([{ field: "title", text: "ラーメン" }], broken).candidates.map(
			(candidate) => candidate.dishCategoryId,
		),
		["ramen"],
	);
});

test("source を渡さない呼び出し側でも取りこぼしが増えない（wikidata-label と同じ扱い）", () => {
	const withoutSource: DishCategoryVariantEntry[] = [{ dishCategoryId: "ramen", surfaceForm: "ラーメン" }];
	assert.equal(
		matchDishCategories(caption("今日はラーメンを食べた"), withoutSource).candidates[0].confidence,
		DISH_CATEGORY_MATCH_TUNING.base.bodyScan,
	);
});

test("本文走査の最小長は、文字種ごとに設計どおりの値になっている", () => {
	const { bodyScanMinLength } = DISH_CATEGORY_MATCH_TUNING;
	assert.deepEqual(bodyScanMinLength, { han: 2, kana: 3, katakana: 2, latin: 4, other: 4 });

	// 漢字を含む 2 文字は載る
	assert.equal(isBodyScanEligible("寿司"), true);
	assert.equal(isBodyScanEligible("うどん"), true);
	assert.equal(isBodyScanEligible("abc"), false);
	assert.equal(isBodyScanEligible("soup"), true);
	assert.equal(isBodyScanEligible("гля"), false);
	assert.equal(isBodyScanEligible("глясе"), true);
});

/*
#1273 ここから 3 本は «かなをひとくくりにして長さで落とす» という形が戻らないことを固定する。

もとは «かな 2 文字» をまとめて本文走査から外していた。外したかったのは `ぱい`（`お腹いっぱい`）
`もち`（`もちろん`）のような **ひらがなが日本語の文に埋もれる**ケースで、カタカナは長さではなく
**語境界**が止めている（`パイ` の直後が `ナ` なら不一致）。長さで二重に落としていたぶん、
カタカナ 2 文字の料理名（`ピザ`）が丸ごと落ちていた。

テストは個別の表記ではなく «この形» を固定する:
  - カタカナだけの 2 文字は本文走査に載る
  - ひらがなを 1 文字でも含む 2 文字は載らない
  - 載せたカタカナ 2 文字が、長いカタカナ語の途中で当たることは無い（語境界が止める）
*/
/*
#1273 «候補ゼロ» の理由が結果に必ず載ることを固定する。

もとは «候補が 0 件» としか分からず、キャプションが取れていないのか / 料理名が 1 語も無いのか /
規則で落としたのかを **後から区別する手段が無かった**。理由を返さない形へ戻すと、同じ調査を
また実キャプションを手で読んでやり直すことになる（CLAUDE.md「見えないものは «無い» ではない」）。
テストは個別の文言ではなく «ゼロなら必ず理由が付く / ゼロでなければ付かない» という形を固定する。
*/
test("#1273 候補が出たときは理由を付けない・出なかったときは必ず付ける", () => {
	const entries: DishCategoryVariantEntry[] = [{ dishCategoryId: "ramen", surfaceForm: "ラーメン" }];

	const hit = matchDishCategories(caption("今日はラーメンを食べた"), entries);
	assert.ok(hit.candidates.length > 0);
	assert.equal(hit.noCandidate, null);

	for (const texts of [caption(""), caption("今日はいい天気でした"), caption("パイナップルジュース")]) {
		const miss = matchDishCategories(texts, [
			...entries,
			{ dishCategoryId: "pie", surfaceForm: "パイ" },
		]);
		assert.deepEqual(miss.candidates, []);
		assert.notEqual(miss.noCandidate, null);
	}
});

test("#1273 候補ゼロの理由は «テキスト無し / 1 語も無い / 語境界で落とした» を区別する", () => {
	const entries: DishCategoryVariantEntry[] = [
		{ dishCategoryId: "ramen", surfaceForm: "ラーメン" },
		{ dishCategoryId: "pie", surfaceForm: "パイ" },
	];

	assert.equal(matchDishCategories(caption(""), entries).noCandidate?.reason, "no_text");
	assert.equal(matchDishCategories(caption("今日はいい天気でした"), entries).noCandidate?.reason, "no_surface_in_text");

	// `パイ` は本文に現れているが、直後がカタカナなので語境界で落とす
	const blocked = matchDishCategories(caption("パイナップルジュースが美味しい"), entries).noCandidate;
	assert.equal(blocked?.reason, "blocked_by_word_boundary");
	assert.equal(blocked?.boundaryRejectedCount, 1);
	assert.deepEqual(blocked?.boundaryRejectedSamples, ["パイ"]);
	assert.ok((blocked?.textLength ?? 0) > 0);
});

test("#1273 カタカナだけの 2 文字は本文走査に載る（ひらがなを含む 2 文字は載らない）", () => {
	for (const katakana of ["ピザ", "パイ", "パン", "カツ"]) {
		assert.equal(isBodyScanEligible(katakana), true, katakana);
	}
	for (const hiragana of ["ぱい", "もち", "そば", "すし", "うに", "ぴざ"]) {
		assert.equal(isBodyScanEligible(hiragana), false, hiragana);
	}
});

test("#1273 カタカナ 2 文字の料理名が本文で拾える", () => {
	const entries: DishCategoryVariantEntry[] = [{ dishCategoryId: "pizza", surfaceForm: "ピザ" }];
	assert.deepEqual(
		matchDishCategories(caption("焼きたてのピザはもちろん、たっぷり野菜のサラダも"), entries).candidates.map(
			(candidate) => candidate.dishCategoryId,
		),
		["pizza"],
	);
});

test("#1273 カタカナ 2 文字を載せても、長いカタカナ語の途中では当たらない", () => {
	// 最小長で二重に落としていたものを語境界だけで止める。ここが緩むと `パイナップル` が復活する
	const entries: DishCategoryVariantEntry[] = [
		{ dishCategoryId: "pie", surfaceForm: "パイ" },
		{ dishCategoryId: "pizza", surfaceForm: "ピザ" },
	];
	assert.deepEqual(matchDishCategories(caption("パイナップルジュースが美味しい"), entries).candidates, []);
	assert.deepEqual(matchDishCategories(caption("ピザーラではなくピザーロ"), entries).candidates, []);
	// ひらがなを含む 2 文字は、そもそも本文走査に載らないので «近く» の意味でも当たらない
	const soba: DishCategoryVariantEntry[] = [{ dishCategoryId: "soba", surfaceForm: "そば" }];
	assert.deepEqual(matchDishCategories(caption("バス停のすぐそばにあります"), soba).candidates, []);
});
