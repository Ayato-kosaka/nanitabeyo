// #1196 error-triage / 正規化ルール表（唯一の正）。
//
// 横断レビュー 1-2 の決定:
//   ① 正規化（このファイルのルール表）は **SQL** で適用する（group by の前に効かせないと集約が壊れる／
//      生テキストを BigQuery の外へ出さない）。
//   ③ fingerprint のハッシュ合成だけを JS（fingerprint.js）で行う。
//
// つまり本番で実際に走るのは PR2 で生成する `sql/error-triage.sql` の REGEXP_REPLACE 群だが、
// **その生成元はこのファイルの NORMALIZE_RULES 一本**とする。生成物と一致することを CI で固定する。
// したがってルールは **RE2 と JS 正規表現の共通部分集合**に限定しなければならない:
//   - 先読み / 後読み `(?=` `(?!` `(?<=` `(?<!` を使わない
//   - 後方参照 `\1` を使わない
//   - インラインフラグ `(?i)` `(?s)` `(?m)` を使わない（RE2 は解釈するが JS は解釈しない）
//     → 大文字小文字を許す箇所は `[0-9a-fA-F]` のように文字クラスへ展開する
// この制約はユニットテスト（normalize-rules.test.js）で機械的に守る。

"use strict";

const { MESSAGE_PATTERN_MAX_LENGTH } = require("./constants");

/** 不透明トークン（ルール8）の最小長。 */
const OPAQUE_TOKEN_MIN_LENGTH = 28;

/**
 * ルール8「不透明な長トークン → `<token>`」の正規表現を組み立てる。
 *
 * 横断レビュー S1 の修正:
 *   #1197 §3-2 の元ルール `\b[A-Za-z0-9_-]{20,}\b` は、同 §3-2 が「潰さない」と宣言した
 *   クラス名を潰してしまう。`LocationPermissionError` は 23 文字なので `<token>` に化け、
 *   §3-4 の例8 がこの設計自身のルールで再現しない。
 *   そこで **閾値を 28 文字へ上げ、かつ「数字を1文字以上含む」条件を足す**。
 *   これで英字のみの CamelCase 識別子（`LocationPermissionError` /
 *   `UnhandledRejectionError` など、いくら長くても数字を含まない）が保護され、
 *   base64url 系の不透明IDだけが潰れる。
 *
 * 「長さ >= N かつ数字を1文字以上含む」を **先読みなし**で書くために、
 * 「最初の数字の位置 p」で場合分けした選択肢の和で表現する:
 *   p = 1..N   : `[A-Za-z_-]{p-1}` `[0-9]` `[A-Za-z0-9_-]{N-p,}`   （合計 >= N）
 *   p > N      : `[A-Za-z_-]{N,}`  `[0-9]` `[A-Za-z0-9_-]*`        （合計 >= N+1）
 * 前置部を「数字を含まない文字クラス」にしてあるので各選択肢は互いに排他で、
 * 「最初の数字」がどこにあっても必ずどれか1つに当たる（＝取りこぼしがない）。
 *
 * 生成物であって手書きではない。長いが、SQL 側もこの文字列をそのまま埋め込む。
 *
 * @param {number} minLength 最小長
 * @returns {string} RE2 / JS 双方で有効な正規表現ソース
 */
const buildOpaqueTokenPattern = (minLength) => {
	const NON_DIGIT = "[A-Za-z_-]";
	const ANY = "[A-Za-z0-9_-]";
	const alternatives = [];
	for (let firstDigitAt = 1; firstDigitAt <= minLength; firstDigitAt += 1) {
		const head = firstDigitAt === 1 ? "" : `${NON_DIGIT}{${firstDigitAt - 1}}`;
		const tailMin = minLength - firstDigitAt;
		const tail = tailMin === 0 ? `${ANY}*` : `${ANY}{${tailMin},}`;
		alternatives.push(`${head}[0-9]${tail}`);
	}
	alternatives.push(`${NON_DIGIT}{${minLength},}[0-9]${ANY}*`);
	return `\\b(?:${alternatives.join("|")})\\b`;
};

/**
 * 置換ルール表（適用順。上から順に適用する）。
 *
 * 各要素:
 *   id          … #1197 §3-2 の番号。SQL 生成時のコメントに使う
 *   name        … 識別子（テスト・SQL コメント用）
 *   pattern     … RE2 / JS 共通部分集合の正規表現ソース（フラグは常に `g` 相当）
 *   replacement … 置換後の文字列（後方参照を含まない）
 *   why         … なぜ潰すのか
 *
 * @type {ReadonlyArray<{id:number,name:string,pattern:string,replacement:string,why:string}>}
 */
const NORMALIZE_RULES = Object.freeze(
	[
		{
			id: 0,
			name: "first-line-only",
			// SQL 側は REGEXP_EXTRACT(s, r'^[^\r\n]*') でも同義だが、
			// 「置換ルール表」として形を揃えるため 2行目以降を消す置換で表現する。
			pattern: "[\\r\\n][\\s\\S]*$",
			replacement: "",
			why: "exception.stack（api-exception.filter.ts:60,123,126）は行番号込みで毎回変わる。1行目だけ残す",
		},
		{
			id: 1,
			name: "iso8601-timestamp",
			pattern: "\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?",
			replacement: "<ts>",
			why: "時刻は原因の識別子ではない",
		},
		{
			id: 2,
			name: "uuid",
			// (?i) は使えないので文字クラスへ展開する
			pattern: "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
			replacement: "<uuid>",
			why: "#1196 の確定事項",
		},
		{
			id: 3,
			name: "jwt",
			pattern: "\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
			replacement: "<jwt>",
			why: "秘密値。Issue 本文に出さない",
		},
		{
			id: 4,
			name: "email",
			pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\\.[A-Za-z0-9.-]+",
			replacement: "<email>",
			why: "PII",
		},
		{
			id: 5,
			name: "google-place-id",
			pattern: "\\bChIJ[A-Za-z0-9_-]{8,}",
			replacement: "<placeid>",
			why: "数値ルールでは潰れない実IDが残るため",
		},
		{
			id: 6,
			name: "url-query",
			pattern: "\\?[^\\s\"')]*",
			replacement: "?",
			why: "#1196。external-api.service.ts:196 の key=${googleApiKey} を落とす目的も兼ねる",
		},
		{
			id: 7,
			name: "hex-run",
			pattern: "\\b[0-9a-fA-F]{8,}\\b",
			replacement: "<hex>",
			why: "commit sha / share_token（randomUUID().replace(/-/g,'') = 32桁hex）",
		},
		{
			id: 8,
			name: "opaque-token",
			pattern: buildOpaqueTokenPattern(OPAQUE_TOKEN_MIN_LENGTH),
			replacement: "<token>",
			why: "形式不明のID・base64url。S1 対応で 28文字以上かつ数字を含むものに限定し、英字のみの CamelCase 識別子を保護する",
		},
		{
			id: 9,
			name: "number",
			// ⚠️ #1197 §3-2 のルール表は `\d+(\.\d+)?`、同 §2 の SQL は `\b\d+(?:\.\d+)?\b` と
			//    食い違っている。**表（＝\b なし）を採る。** 理由は2つ:
			//    (a) §3-4 の10例のうち 3・5・10 が `/v1/` → `/v<n>/` を期待しており、
			//        `\b` 付きだと 'v' と '1' の間に語境界が無いため1つも再現しない。
			//    (b) ルール8の閾値を 28 文字へ上げた結果（S1 対応）、8〜27 文字の
			//        英数字混在ID（非hex）が素通りする。`\b` なしならその中の数字が潰れて
			//        同一原因が1グループに畳まれる。`\b` 付きだと ID ごとに別グループへ割れる。
			pattern: "\\d+(?:\\.\\d+)?",
			replacement: "<n>",
			why: "#1196",
		},
		{
			id: 10,
			name: "whitespace",
			pattern: "\\s+",
			replacement: " ",
			why: "整形差の吸収",
		},
	].map(Object.freeze),
);

/** ルール名 → ルール の索引。 */
const RULES_BY_NAME = Object.freeze(Object.fromEntries(NORMALIZE_RULES.map((rule) => [rule.name, rule])));

/**
 * ルール1件を JS の RegExp としてコンパイルする。
 * SQL 生成側（PR2）はコンパイルせず `pattern` 文字列をそのまま埋め込む。
 *
 * @param {{pattern:string}} rule
 * @returns {RegExp}
 */
const compileRule = (rule) => new RegExp(rule.pattern, "g");

/**
 * 正規化を適用する。SQL 側の `NORMALIZE(...)` と等価であることが契約。
 *
 * null / undefined は null を返す（SQL の IFNULL 前の状態に対応させる）。
 *
 * @param {string|null|undefined} value
 * @returns {string|null} 正規化済み文字列（最大 MESSAGE_PATTERN_MAX_LENGTH 文字）
 */
const normalize = (value) => {
	if (value === null || value === undefined) return null;
	let out = String(value);
	for (const rule of NORMALIZE_RULES) {
		out = out.replace(compileRule(rule), rule.replacement);
	}
	// 末尾 trim → 切り詰め → もう一度 trim。
	// 切り詰めた結果の末尾が空白になると normalize が冪等でなくなり、
	// 不変条件 3 の検査（isNormalized）が誤検知するため。
	return out.trim().slice(0, MESSAGE_PATTERN_MAX_LENGTH).trim();
};

/**
 * 既に正規化済みかどうか（＝もう一度通しても変わらないか）。
 *
 * 契約の不変条件 3「messagePattern / route / endpoint / pathName は全て正規化後の値。
 * 生値はこの契約に一切現れない」を検査するために使う。
 *
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
const isNormalized = (value) => {
	if (value === null || value === undefined) return true;
	return normalize(value) === String(value);
};

module.exports = Object.freeze({
	OPAQUE_TOKEN_MIN_LENGTH,
	NORMALIZE_RULES,
	RULES_BY_NAME,
	buildOpaqueTokenPattern,
	compileRule,
	normalize,
	isNormalized,
});
