/**
 * `matchRestaurantNames` の仕様固定テスト（#1399 解くべき問い 4）。
 *
 * ここも **「こう動く」ではなく「こう間違えない」**を書く。店の取り違えは料理の取り違えより
 * 実害が大きい（Map と Calendar に嘘の店が出て、しかもユーザーが気づきにくい）ので、
 * **誤って prefill しないこと**の固定に重みを置いてある。
 *
 * `GET /v1/restaurants/search` は叩かない。候補はすべてこのファイル内で組み立てる。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	GENERIC_BRANCH_WORDS,
	isContainmentEligible,
	matchRestaurantNames,
	RESTAURANT_NAME_MATCH_TUNING,
	splitRestaurantName,
	type RestaurantNameMatchResult,
	type RestaurantSearchCandidate,
} from "../restaurantNameMatch";
import { clampConfidence, type ExtractedText } from "../textNormalize";

const { base, adjustment, threshold } = RESTAURANT_NAME_MATCH_TUNING;

const CANDIDATES: RestaurantSearchCandidate[] = [
	{ id: "ippudo-shibuya", name: "一風堂 渋谷店" },
	{ id: "ippudo-shinjuku", name: "一風堂 新宿店" },
	{ id: "ramen-taro", name: "ラーメン太郎" },
	{ id: "cafe-de-paris", name: "カフェ・ド・パリ" },
	{ id: "blue-bottle", name: "Blue Bottle Coffee - Shibuya" },
	{ id: "marugame", name: "丸亀製麺（渋谷店）" },
];

function caption(text: string): ExtractedText[] {
	return [{ field: "caption", text }];
}

function run(text: string, authorName?: string): RestaurantNameMatchResult {
	return matchRestaurantNames({ texts: caption(text), candidates: CANDIDATES, authorName });
}

function ids(result: RestaurantNameMatchResult): string[] {
	return result.candidates.map((candidate) => candidate.restaurantId);
}

function confidenceOf(result: RestaurantNameMatchResult, restaurantId: string): number | undefined {
	return result.candidates.find((candidate) => candidate.restaurantId === restaurantId)?.confidence;
}

// ---------------------------------------------------------------------------
// 支店名の分離
// ---------------------------------------------------------------------------

test("支店名の分離: 設計 §5-4 の 3 パターンを上から順に当てる", () => {
	assert.deepEqual(splitRestaurantName("一風堂 渋谷店"), { base: "一風堂", branch: "渋谷店" });
	assert.deepEqual(splitRestaurantName("一風堂 本店"), { base: "一風堂", branch: "本店" });
	assert.deepEqual(splitRestaurantName("スターバックス 渋谷営業所"), {
		base: "スターバックス",
		branch: "渋谷営業所",
	});
	assert.deepEqual(splitRestaurantName("blue bottle coffee - shibuya"), {
		base: "blue bottle coffee",
		branch: "shibuya",
	});
	assert.deepEqual(splitRestaurantName("丸亀製麺（渋谷店）"), { base: "丸亀製麺", branch: "渋谷店" });
});

test("支店名の分離: 分けられない名前はそのまま返す（例外は投げない）", () => {
	assert.deepEqual(splitRestaurantName("ラーメン太郎"), { base: "ラーメン太郎", branch: null });
	assert.deepEqual(splitRestaurantName(""), { base: "", branch: null });
	// 屋号が空になる分け方はしない
	assert.deepEqual(splitRestaurantName("本店"), { base: "本店", branch: null });
});

// ---------------------------------------------------------------------------
// 誤って prefill しない
// ---------------------------------------------------------------------------

test("誤爆させない: 屋号しか書かれていない投稿から支店を当てない", () => {
	// #1273 §23。同じ屋号の別支店が拮抗して両方下がり、prefill 閾値 0.90 に届かない
	const result = run("一風堂に行ってきた");
	assert.deepEqual(ids(result).slice(0, 2).sort(), ["ippudo-shibuya", "ippudo-shinjuku"]);
	assert.equal(confidenceOf(result, "ippudo-shibuya"), clampConfidence(base.baseNameContained + adjustment.contested));
	assert.equal(confidenceOf(result, "ippudo-shinjuku"), clampConfidence(base.baseNameContained + adjustment.contested));
	assert.equal(result.shouldPrefill, false);
	assert.equal(result.prefillRestaurantId, null);
});

test("誤爆させない: `本店` のような、どの店にも付きうる支店名では加点しない", () => {
	const candidates: RestaurantSearchCandidate[] = [{ id: "x", name: "一風堂 本店" }];
	const result = matchRestaurantNames({ texts: caption("一風堂の本店に行った"), candidates });
	// 屋号一致の 0.70 のまま。+0.20 されて 0.90（prefill 閾値）に届いてはいけない
	assert.equal(confidenceOf(result, "x"), base.baseNameContained);
	assert.equal(result.shouldPrefill, false);
});

test("誤爆させない: 短い店名は「含まれているだけ」では候補にしない", () => {
	// ラテン文字は 4 文字以上、漢字・かなを含むものは 3 文字以上
	assert.equal(isContainmentEligible("abc"), false);
	assert.equal(isContainmentEligible("abcd"), true);
	assert.equal(isContainmentEligible("一風"), false);
	assert.equal(isContainmentEligible("一風堂"), true);

	const short: RestaurantSearchCandidate[] = [{ id: "abc", name: "ABC" }];
	assert.deepEqual(
		matchRestaurantNames({ texts: caption("abcdefg というお店の話ではない"), candidates: short }).candidates,
		[],
	);
});

test("誤爆させない: ラテン文字の店名が英単語の途中に埋もれても当たらない", () => {
	const candidates: RestaurantSearchCandidate[] = [{ id: "pass", name: "Pass" }];
	assert.deepEqual(matchRestaurantNames({ texts: caption("i forgot my password"), candidates }).candidates, []);
});

test("誤爆させない: 関係ないキャプションからは候補が 0 件になる（それが既定の状態）", () => {
	// #1399 設計 §5-3。0 件は失敗ではないので、UI は「地図から店を選ぶ」を既定にすること
	const result = run("今日はいい天気でした");
	assert.deepEqual(result.candidates, []);
	assert.equal(result.shouldPrefill, false);
});

test("誤爆させない: `author_name` は単独では prefill しない", () => {
	const result = run("うまかった", "ラーメン太郎");
	assert.deepEqual(ids(result), ["ramen-taro"]);
	assert.equal(confidenceOf(result, "ramen-taro"), base.authorName);
	assert.equal(result.candidates[0].evidence[0].kind, "author-name");
	assert.equal(result.shouldPrefill, false);
});

test("誤爆させない: `author_name` だけでは、加点を全部積んでも prefill 閾値へ構造的に届かない", () => {
	// 実行時のガード（根拠が author-name だけなら prefill しない）に加えて、
	// 点数の側でも届かないことを固定しておく。片方が壊れてももう片方が残る
	assert.ok(
		base.authorName + adjustment.branchAlsoMatched < threshold.prefillMinConfidence,
		`${base.authorName} + ${adjustment.branchAlsoMatched} < ${threshold.prefillMinConfidence}`,
	);
});

test("誤爆させない: 曖昧一致（3-gram）は閾値 0.4 未満を候補にしない", () => {
	assert.equal(threshold.minFuzzySimilarity, 0.4);
	const result = matchRestaurantNames({
		texts: caption("@totally_unrelated_account の投稿"),
		candidates: [{ id: "x", name: "一風堂 渋谷店" }],
	});
	assert.deepEqual(result.candidates, []);
});

test("誤爆させない: 曖昧一致だけでは prefill 閾値へ届かない（畳んだキーの上での一致なので）", () => {
	// 記号を落とせば完全一致、というケースが曖昧一致の側から 1.00 で入ってこないこと
	const result = matchRestaurantNames({
		texts: caption("@bluebottlecoffeeshibuya"),
		candidates: [{ id: "bb", name: "Blue Bottle Coffee Shibuya" }],
	});
	assert.ok((confidenceOf(result, "bb") ?? 1) <= clampConfidence(base.exactName + adjustment.foldedKey));
});

// ---------------------------------------------------------------------------
// 取りこぼさない
// ---------------------------------------------------------------------------

test("取りこぼさない: 店名がそのまま書かれていれば完全一致で 1.00 になり prefill する", () => {
	const result = matchRestaurantNames({ texts: [{ field: "title", text: "一風堂 渋谷店" }], candidates: CANDIDATES });
	assert.equal(result.candidates[0].restaurantId, "ippudo-shibuya");
	assert.equal(result.candidates[0].confidence, base.exactName);
	assert.equal(result.candidates[0].evidence[0].kind, "exact-name");
	assert.equal(result.shouldPrefill, true);
	assert.equal(result.prefillRestaurantId, "ippudo-shibuya");
});

test("取りこぼさない: 屋号と支店名が両方テキストに出ていれば +0.20 して prefill の土俵に乗る", () => {
	const result = run("今日は一風堂の渋谷店に行ってきた");
	assert.equal(
		confidenceOf(result, "ippudo-shibuya"),
		clampConfidence(base.baseNameContained + adjustment.branchAlsoMatched),
	);
	assert.equal(confidenceOf(result, "ippudo-shinjuku"), base.baseNameContained);
	assert.equal(result.shouldPrefill, true);
	assert.equal(result.prefillRestaurantId, "ippudo-shibuya");
});

test("取りこぼさない: カタカナ／ひらがなの書き分けを吸収する", () => {
	const result = run("らーめん太郎で食べた");
	assert.deepEqual(ids(result), ["ramen-taro"]);
	assert.equal(result.candidates[0].evidence[0].keyKind, "kana-folded");
	// 片側の形を崩して当てているので −0.05
	assert.equal(confidenceOf(result, "ramen-taro"), clampConfidence(base.nameContained + adjustment.foldedKey));
});

test("取りこぼさない: 中黒・スラッシュ・ハイフン・空白の有無を吸収する", () => {
	for (const [text, expected] of [
		["カフェドパリでランチ", "cafe-de-paris"],
		["カフェ・ド・パリでランチ", "cafe-de-paris"],
		["blue bottle coffee shibuya に行った", "blue-bottle"],
		["丸亀製麺 渋谷店 でうどん", "marugame"],
	] as const) {
		assert.ok(ids(matchRestaurantNames({ texts: caption(text), candidates: CANDIDATES })).includes(expected), text);
	}
});

test("取りこぼさない: 全角英数・大文字小文字の違いを吸収する", () => {
	const candidates: RestaurantSearchCandidate[] = [{ id: "bb", name: "Blue Bottle" }];
	for (const text of ["BLUE BOTTLE で一杯", "Ｂｌｕｅ Ｂｏｔｔｌｅ で一杯", "blue  bottle で一杯"]) {
		assert.deepEqual(
			matchRestaurantNames({ texts: caption(text), candidates }).candidates.map((c) => c.restaurantId),
			["bb"],
			text,
		);
	}
});

test("取りこぼさない: ハッシュタグと @mention も照合の対象にする", () => {
	const candidates: RestaurantSearchCandidate[] = [{ id: "bb", name: "Blue Bottle Coffee" }];

	const viaHashtag = matchRestaurantNames({ texts: caption("うまい #bluebottlecoffee"), candidates });
	assert.deepEqual(viaHashtag.candidates.map((c) => c.restaurantId), ["bb"]);

	const viaMention = matchRestaurantNames({ texts: caption("@bluebottlecoffee で一杯"), candidates });
	assert.deepEqual(viaMention.candidates.map((c) => c.restaurantId), ["bb"]);
});

test("取りこぼさない: 店名が【】に囲まれていれば完全一致 1.00 で prefill する（#1273）", () => {
	// グルメ紹介キャプションは店名を隅付き括弧に入れる。括弧内は含有だと 0.85 止まりで
	// 無人取り込みの prefill（0.90）に届かなかった。トークン化して完全一致へ引き上げる
	const candidates: RestaurantSearchCandidate[] = [
		{ id: "okage", name: "おかげ庵" },
		{ id: "sbux", name: "スターバックス 栄店" },
	];
	const result = matchRestaurantNames({
		texts: caption("名古屋市東区葵3-12-18の【おかげ庵】さん okagean_official"),
		candidates,
	});
	assert.equal(result.candidates[0].restaurantId, "okage");
	assert.equal(result.candidates[0].confidence, base.exactName);
	assert.equal(result.candidates[0].evidence[0].kind, "exact-name");
	assert.equal(result.shouldPrefill, true);
	assert.equal(result.prefillRestaurantId, "okage");
});

test("誤爆させない: 【店名】等の見出しラベルからは候補を作らない（#1273）", () => {
	// 括弧を項目ラベルに使い値を次行に置くテンプレ。ラベル語「店名」は店ではない
	const result = matchRestaurantNames({
		texts: caption("【店名】\nスターバックス"),
		candidates: [{ id: "x", name: "店名" }],
	});
	assert.deepEqual(result.candidates, []);
	assert.equal(result.shouldPrefill, false);
});

test("取りこぼさない: 3 文字の漢字の屋号は含有判定の対象に残す", () => {
	// `一風堂` `大戸屋` は実在の屋号。ラテン 3 文字と違い固有名詞性が高いので落とさない
	const candidates: RestaurantSearchCandidate[] = [{ id: "ootoya", name: "大戸屋" }];
	assert.deepEqual(
		matchRestaurantNames({ texts: caption("大戸屋でごはん"), candidates }).candidates.map((c) => c.restaurantId),
		["ootoya"],
	);
});

// ---------------------------------------------------------------------------
// 順位・閾値・戻り値の形
// ---------------------------------------------------------------------------

test("閾値は 1 箇所にまとまっていて、料理カテゴリより厳しい", () => {
	assert.deepEqual(threshold, {
		minContainmentLengthLatin: 4,
		minContainmentLengthCjk: 3,
		minFuzzySimilarity: 0.4,
		maxFuzzyTokenLength: 40,
		contestedMargin: 0.1,
		prefillMinConfidence: 0.9,
		prefillMinMargin: 0.2,
		maxCandidates: 5,
	});
	// 店の取り違えは料理の取り違えより実害が大きいので、料理カテゴリの 0.80 / 0.15 より厳しくする
	assert.ok(threshold.prefillMinConfidence > 0.8);
	assert.ok(threshold.prefillMinMargin > 0.15);
});

test("順位: 1 始まりの rank が信頼度の降順で振られる", () => {
	const result = run("今日は一風堂の渋谷店に行ってきた");
	assert.equal(result.candidates[0].rank, 1);
	assert.equal(result.candidates[1].rank, 2);
	assert.ok(result.candidates[0].confidence >= result.candidates[1].confidence);
});

test("順位: maxCandidates を絞っても、切り捨てた 2 位を無視して prefill しない", () => {
	const result = matchRestaurantNames(
		{ texts: caption("一風堂に行ってきた"), candidates: CANDIDATES },
		{ maxCandidates: 1 },
	);
	assert.equal(result.candidates.length, 1);
	assert.equal(result.shouldPrefill, false);
});

test("戻り値: 根拠は「どの店名がどこに当たったか」を持つ（オフセットは normalizedTexts 基準）", () => {
	const result = run("今日はラーメン太郎に行った");
	const evidence = result.candidates[0].evidence[0];

	assert.equal(evidence.kind, "name-contained");
	assert.equal(evidence.keyKind, "normalized");
	assert.equal(evidence.field, "caption");
	assert.equal(evidence.fieldIndex, 0);

	const text = result.normalizedTexts[evidence.fieldIndex!].text;
	assert.equal(text.slice(evidence.start!, evidence.end!), "ラーメン太郎");
});

test("戻り値: 記号除去キー経由の一致はオフセットを返さない（文字数が変わっているため）", () => {
	const result = run("カフェドパリでランチ");
	const evidence = result.candidates[0].evidence[0];
	assert.equal(evidence.keyKind, "symbol-stripped");
	assert.equal(evidence.start, null);
	assert.equal(evidence.end, null);
});

test("`本店` `支店` `営業所` は加点対象外の支店名として明示されている", () => {
	for (const word of ["本店", "支店", "営業所", "店"]) {
		assert.ok(GENERIC_BRANCH_WORDS.has(word), word);
	}
	assert.equal(GENERIC_BRANCH_WORDS.has("渋谷店"), false);
});

// ---------------------------------------------------------------------------
// 壊れた入力
// ---------------------------------------------------------------------------

test("壊れた入力でも例外を投げない（API のレスポンスを素通しできること）", () => {
	for (const candidates of [null, undefined, []] as const) {
		const result = matchRestaurantNames({ texts: caption("一風堂"), candidates });
		assert.deepEqual(result.candidates, []);
		assert.equal(result.shouldPrefill, false);
	}
	for (const texts of [null, undefined, []] as const) {
		const result = matchRestaurantNames({ texts, candidates: CANDIDATES });
		assert.deepEqual(result.candidates, []);
	}

	// 行の形が壊れていても、その行だけ落として続ける
	const broken = [
		null,
		{ id: "", name: "一風堂 渋谷店" },
		{ id: "no-name" },
		{ id: "ok", name: "一風堂 渋谷店" },
	] as unknown as RestaurantSearchCandidate[];
	assert.deepEqual(
		matchRestaurantNames({ texts: [{ field: "title", text: "一風堂 渋谷店" }], candidates: broken }).candidates.map(
			(candidate) => candidate.restaurantId,
		),
		["ok"],
	);
});

test("壊れた入力: authorName が null / 空でも動く", () => {
	for (const authorName of [null, undefined, "", "   "] as const) {
		const result = matchRestaurantNames({ texts: caption("うまい"), candidates: CANDIDATES, authorName });
		assert.deepEqual(result.candidates, []);
	}
});
