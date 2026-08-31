/**
 * `textNormalize` の仕様固定テスト（#1399 PR: 候補マッチングのルール）。
 *
 * ここは料理カテゴリ照合と店舗名照合が共有する土台なので、**「こう動く」ではなく
 * 「こう間違えない」**を書く。とくに `isWordBoundaryMatch` は、独立レビューが実データで
 * 再現した誤爆（`ぱい` / `パイ`）と、境界を厳しくしすぎたときに起きる取りこぼし
 * （`おいしいうどん` / `絶品味噌ラーメン` / `カレーが好き`）の**両方**を固定する。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	classifySurfaceScript,
	clampConfidence,
	confidenceMargin,
	extractBracketedNames,
	extractHashtags,
	extractMentions,
	isWordBoundaryMatch,
	katakanaToHiragana,
	MATCH_TEXT_MAX_FIELDS,
	MATCH_TEXT_MAX_LENGTH,
	normalizeExtractedTexts,
	normalizeMatchText,
	stripMatchSymbols,
	trigramSimilarity,
	type ExtractedText,
} from "../textNormalize";

// ---------------------------------------------------------------------------
// normalizeMatchText — `4_1_generate_variants.py` の norm_key() と同じ結果になること
// ---------------------------------------------------------------------------

test("normalizeMatchText: NFKC → 空白圧縮 → 小文字化 の 3 手順を、この順で当てる", () => {
	for (const [input, expected] of [
		// 1. NFKC: 全角英数 → 半角
		["ＲＡＭＥＮ", "ramen"],
		// 1. NFKC: 半角カナ → 全角カナ（濁点も合成される）
		["ﾗｰﾒﾝ", "ラーメン"],
		["ﾊﾞｰｶﾞｰ", "バーガー"],
		// 2. 空白圧縮: 連続空白・改行・タブ・U+3000 をすべて半角スペース 1 個へ
		["味噌  ラーメン", "味噌 ラーメン"],
		["味噌\n\tラーメン", "味噌 ラーメン"],
		["味噌　ラーメン", "味噌 ラーメン"],
		// 2. 空白圧縮: 前後の空白は落ちる
		["  ラーメン  ", "ラーメン"],
		// 3. 小文字化
		["Ramen", "ramen"],
		["MISO Ramen", "miso ramen"],
	] as const) {
		assert.equal(normalizeMatchText(input), expected, input);
	}
});

test("normalizeMatchText: ひらがな・カタカナは畳まない（辞書側に kata2hira 由来の行が既にある）", () => {
	// ここで畳むと、同じカテゴリに wikidata-label と kata2hira の 2 系統が同時に当たり、
	// 「2 箇所以上で一致」の加点が二重計上される。
	assert.equal(normalizeMatchText("ラーメン"), "ラーメン");
	assert.equal(normalizeMatchText("らーめん"), "らーめん");
	assert.notEqual(normalizeMatchText("ラーメン"), normalizeMatchText("らーめん"));
});

test("normalizeMatchText: 記号は落とさない（落とすのは stripMatchSymbols の仕事）", () => {
	assert.equal(normalizeMatchText("カフェ・ド・パリ"), "カフェ・ド・パリ");
	assert.equal(normalizeMatchText("#ラーメン"), "#ラーメン");
});

test("normalizeMatchText: 壊れた入力でも例外を投げず空文字を返す", () => {
	assert.equal(normalizeMatchText(null), "");
	assert.equal(normalizeMatchText(undefined), "");
	assert.equal(normalizeMatchText(""), "");
	assert.equal(normalizeMatchText("   "), "");
	assert.equal(normalizeMatchText(123 as unknown as string), "");
});

test("normalizeMatchText: 極端に長い入力は上限で切る（正規表現に食わせる前に落とす）", () => {
	const long = "あ".repeat(MATCH_TEXT_MAX_LENGTH + 500);
	assert.equal(normalizeMatchText(long).length, MATCH_TEXT_MAX_LENGTH);
});

test("normalizeExtractedTexts: 空になったフィールドを落とし、添字を詰め直す", () => {
	const input: ExtractedText[] = [
		{ field: "title", text: "  " },
		{ field: "caption", text: "ラーメン" },
		{ field: "description", text: "" },
		{ field: "hashtag", text: "#麺" },
	];
	assert.deepEqual(normalizeExtractedTexts(input), [
		{ index: 0, field: "caption", text: "ラーメン" },
		{ index: 1, field: "hashtag", text: "#麺" },
	]);
});

test("normalizeExtractedTexts: 件数上限を超えたぶんは無視する", () => {
	const many: ExtractedText[] = [];
	for (let i = 0; i < MATCH_TEXT_MAX_FIELDS + 10; i += 1) many.push({ field: "caption", text: `text${i}` });
	assert.equal(normalizeExtractedTexts(many).length, MATCH_TEXT_MAX_FIELDS);
});

test("normalizeExtractedTexts: 配列でないものを渡されても例外を投げない", () => {
	assert.deepEqual(normalizeExtractedTexts(null), []);
	assert.deepEqual(normalizeExtractedTexts(undefined), []);
	assert.deepEqual(normalizeExtractedTexts("ラーメン" as unknown as ExtractedText[]), []);
});

// ---------------------------------------------------------------------------
// stripMatchSymbols / katakanaToHiragana
// ---------------------------------------------------------------------------

test("stripMatchSymbols: 中黒・スラッシュ・ハイフン・アンダースコア・空白を落とす", () => {
	assert.equal(stripMatchSymbols("カフェ・ド・パリ"), "カフェドパリ");
	assert.equal(stripMatchSymbols("blue bottle - shibuya"), "bluebottleshibuya");
	assert.equal(stripMatchSymbols("ラーメン_太郎"), "ラーメン太郎");
	assert.equal(stripMatchSymbols("a&w"), "aw");
	assert.equal(stripMatchSymbols("hot dog"), "hotdog");
});

test("stripMatchSymbols: 長音符は落とさない（落とすと ラーメン と ラメン が同じになる）", () => {
	assert.equal(stripMatchSymbols("ラーメン"), "ラーメン");
});

test("katakanaToHiragana: カタカナだけを畳み、長音符と中黒はそのまま残す", () => {
	assert.equal(katakanaToHiragana("ラーメン"), "らーめん");
	assert.equal(katakanaToHiragana("カフェ・ド・パリ"), "かふぇ・ど・ぱり");
	// 長音符を写す先がひらがなに無いので変えない。変えると同じ語が別物になる
	assert.equal(katakanaToHiragana("ー"), "ー");
	// ひらがな・漢字・ラテン文字は素通し
	assert.equal(katakanaToHiragana("らーめん太郎 ramen"), "らーめん太郎 ramen");
});

test("katakanaToHiragana: カタカナ表記とひらがな表記が同じキーへ寄る", () => {
	assert.equal(katakanaToHiragana("ラーメン太郎"), katakanaToHiragana("らーめん太郎"));
});

// ---------------------------------------------------------------------------
// classifySurfaceScript
// ---------------------------------------------------------------------------

test("classifySurfaceScript: 漢字を 1 文字でも含めば han（かなが混じっていても）", () => {
	assert.equal(classifySurfaceScript("寿司"), "han");
	assert.equal(classifySurfaceScript("味噌ラーメン"), "han");
	assert.equal(classifySurfaceScript("焼きそば"), "han");
});

test("classifySurfaceScript: 漢字が無くかなを含めば kana", () => {
	assert.equal(classifySurfaceScript("ラーメン"), "kana");
	assert.equal(classifySurfaceScript("らーめん"), "kana");
	assert.equal(classifySurfaceScript("ぱい"), "kana");
});

test("classifySurfaceScript: ラテン文字・数字・記号だけなら latin", () => {
	assert.equal(classifySurfaceScript("ramen"), "latin");
	assert.equal(classifySurfaceScript("hot dog"), "latin");
	assert.equal(classifySurfaceScript("crème brûlée"), "latin");
});

test("classifySurfaceScript: キリル・ハングル・アラビア・タイは other（本文走査をもっとも厳しくする側）", () => {
	assert.equal(classifySurfaceScript("глясе"), "other");
	assert.equal(classifySurfaceScript("비빔밥"), "other");
	assert.equal(classifySurfaceScript("كباب"), "other");
	assert.equal(classifySurfaceScript("ต้มยำ"), "other");
});

// ---------------------------------------------------------------------------
// extractHashtags / extractMentions
// ---------------------------------------------------------------------------

test("extractHashtags: `#` を剥がした本体と、正規化済みテキスト上の位置を返す", () => {
	const text = normalizeMatchText("うまい #ラーメン #味噌ラーメン");
	assert.deepEqual(extractHashtags(text), [
		{ tag: "ラーメン", start: 5, end: 9 },
		{ tag: "味噌ラーメン", start: 11, end: 17 },
	]);
	assert.equal(text.slice(5, 9), "ラーメン");
});

test("extractHashtags: 全角の ＃ は NFKC で # になるので拾える", () => {
	assert.deepEqual(
		extractHashtags(normalizeMatchText("＃ラーメン")).map((token) => token.tag),
		["ラーメン"],
	);
});

test("extractHashtags: 日本語の句読点・括弧で切れる（次の語を巻き込まない）", () => {
	for (const [input, expected] of [
		["#ラーメン、うまい", ["ラーメン"]],
		["#ラーメン。", ["ラーメン"]],
		["#ラーメン！最高", ["ラーメン"]],
		["「#ラーメン」", ["ラーメン"]],
		["#ラーメン #うどん", ["ラーメン", "うどん"]],
		["#ラーメン…", ["ラーメン"]],
	] as const) {
		assert.deepEqual(
			extractHashtags(normalizeMatchText(input)).map((token) => token.tag),
			[...expected],
			input,
		);
	}
});

test("extractHashtags: ハッシュタグが無いテキストからは何も出ない", () => {
	assert.deepEqual(extractHashtags(normalizeMatchText("今日はラーメンを食べた")), []);
	assert.deepEqual(extractHashtags(normalizeMatchText("# ")), []);
});

test("extractMentions: SNS のユーザー名に使われる文字だけを拾う", () => {
	assert.deepEqual(
		extractMentions(normalizeMatchText("@Ippudo_Shibuya へ行った")).map((token) => token.mention),
		["ippudo_shibuya"],
	);
	// 末尾の記号は本体に含めない
	assert.deepEqual(
		extractMentions(normalizeMatchText("@ippudo. うまい")).map((token) => token.mention),
		["ippudo"],
	);
	// 日本語のメンションは対象外（SNS 側の ID 表記が英数のため）
	assert.deepEqual(extractMentions(normalizeMatchText("@ラーメン太郎")), []);
});

test("extractBracketedNames: 【店名】の本体と、正規化済みテキスト上の位置を返す（#1273）", () => {
	assert.deepEqual(extractBracketedNames(normalizeMatchText("この【おかげ庵】さん")), [
		{ name: "おかげ庵", start: 3, end: 7 },
	]);
	// 先頭の空白は本体に含めず、開始位置を進める
	assert.deepEqual(extractBracketedNames("あ【 ラーメン太郎】い"), [{ name: "ラーメン太郎", start: 3, end: 9 }]);
});

test("誤爆させない: 【店名】【住所】等の «見出しラベル» は店名として採らない（#1273）", () => {
	// 一部テンプレは括弧を項目ラベルに使い、値は次行に書く（実測 toyamashokujikai）
	for (const label of ["店名", "住所", "所在地", "営業時間", "定休日", "アクセス", "メニュー"]) {
		assert.deepEqual(extractBracketedNames(`【${label}】`), [], label);
	}
});

test("extractBracketedNames: 閉じ括弧が無い／長すぎるものは採らない", () => {
	assert.deepEqual(extractBracketedNames("【閉じない店名 のあとに文が続く"), []);
	assert.deepEqual(extractBracketedNames(`【${"あ".repeat(41)}】`), []);
	// 『』「」 は店名の目印にしない（料理名・CTA に使われる）
	assert.deepEqual(extractBracketedNames("『養老パフェ』「行きたい！」"), []);
});

// ---------------------------------------------------------------------------
// isWordBoundaryMatch — 誤爆と取りこぼしの両方を固定する
// ---------------------------------------------------------------------------

/** `text` の中で `surface` が「語として」当たる位置があるか */
function matchesAsWord(text: string, surface: string): boolean {
	let at = text.indexOf(surface);
	while (at !== -1) {
		if (isWordBoundaryMatch(text, at, at + surface.length, surface)) return true;
		at = text.indexOf(surface, at + 1);
	}
	return false;
}

test("誤爆させない: ラテン文字の別名が、無関係な英単語の途中に当たらない", () => {
	assert.equal(matchesAsWord("this is nice", "ice"), false);
	assert.equal(matchesAsWord("password", "pass"), false);
	assert.equal(matchesAsWord("ramen123", "ramen"), false);
	assert.equal(matchesAsWord("pastafarian", "pasta"), false);
	// 単独で出てくれば当たる
	assert.equal(matchesAsWord("ice cream", "ice"), true);
	assert.equal(matchesAsWord("best pasta ever", "pasta"), true);
	assert.equal(matchesAsWord("(pasta)", "pasta"), true);
});

test("誤爆させない: カタカナ語がカタカナの並びの途中に当たらない", () => {
	// 独立レビューが実データで再現した誤爆
	assert.equal(matchesAsWord("パイナップルジュースが最高", "パイ"), false);
	assert.equal(matchesAsWord("カレーライスを食べた", "カレー"), false);
	assert.equal(matchesAsWord("アイスコーヒー", "アイス"), false);
	assert.equal(matchesAsWord("ミニラーメン", "ラーメン"), false);
});

test("取りこぼさない: カタカナ語の直後にひらがなの助詞が来ても当たる", () => {
	// ここを間違えると日本語の文がほぼ全部弾かれる
	assert.equal(matchesAsWord("カレーが好き", "カレー"), true);
	assert.equal(matchesAsWord("ラーメンを食べた", "ラーメン"), true);
	assert.equal(matchesAsWord("スシローに行った", "スシロー"), true);
	assert.equal(matchesAsWord("ステーキ丼", "ステーキ"), true);
	assert.equal(matchesAsWord("味噌ラーメン", "ラーメン"), true);
});

test("取りこぼさない: ひらがなには境界を課さない（助詞に囲まれても当たる）", () => {
	assert.equal(matchesAsWord("おいしいうどんでした", "うどん"), true);
	assert.equal(matchesAsWord("きょうはらーめん", "らーめん"), true);
});

test("取りこぼさない: 漢字には境界を課さない（複合語の一部でも当たる）", () => {
	assert.equal(matchesAsWord("絶品味噌ラーメンを食べた", "味噌ラーメン"), true);
	assert.equal(matchesAsWord("回転寿司に行った", "寿司"), true);
});

test("誤爆させない: その他の文字体系は、どの語構成文字にも隣接してはいけない", () => {
	assert.equal(matchesAsWord("глясение", "глясе"), false);
	assert.equal(matchesAsWord("это глясе!", "глясе"), true);
});

test("長音符は、隣り合うかなの実体を辿って並びの種別を決める", () => {
	// `カレー` の末尾 `ー` はカタカナの並び → 直後の `ラ` はカタカナなので不一致
	assert.equal(isWordBoundaryMatch("カレーライス", 0, 3, "カレー"), false);
	// 同じ `ー` でも、直後が助詞なら一致
	assert.equal(isWordBoundaryMatch("カレーが好き", 0, 3, "カレー"), true);
	// `らー` の `ー` はひらがなの並び。ひらがなには境界を課さないので一致
	assert.equal(isWordBoundaryMatch("おらーめん", 1, 5, "らーめん"), true);
});

// ---------------------------------------------------------------------------
// trigramSimilarity / confidenceMargin / clampConfidence
// ---------------------------------------------------------------------------

test("trigramSimilarity: 完全一致は 1、共通部分が無ければ 0", () => {
	assert.equal(trigramSimilarity("ippudo", "ippudo"), 1);
	assert.equal(trigramSimilarity("ippudo", "xyzqwv"), 0);
	assert.equal(trigramSimilarity("", "ippudo"), 0);
});

test("trigramSimilarity: 似ているものほど大きい（順位付けに使える）", () => {
	const close = trigramSimilarity("ippudo shibuya", "ippudoshibuya");
	const far = trigramSimilarity("ippudo shibuya", "ichiran shinjuku");
	assert.ok(close > far, `${close} > ${far}`);
	assert.ok(close >= 0.4, `${close} >= 0.4`);
	assert.ok(far < 0.4, `${far} < 0.4`);
});

test("confidenceMargin: 0.65 - 0.55 が閾値 0.10 を下回らない（IEEE754 の誤差を閾値へ漏らさない）", () => {
	// 素の減算は 0.09999999999999998 になり、`< 0.1` を通ってしまう
	assert.ok(0.65 - 0.55 < 0.1);
	assert.equal(confidenceMargin(0.65, 0.55), 0.1);
	assert.ok(!(confidenceMargin(0.65, 0.55) < 0.1));
});

test("clampConfidence: 0〜1 に収め、4 桁で丸める", () => {
	assert.equal(clampConfidence(1.4), 1);
	assert.equal(clampConfidence(-0.3), 0);
	assert.equal(clampConfidence(0.55 + 0.1), 0.65);
	assert.equal(clampConfidence(Number.NaN), 0);
});
