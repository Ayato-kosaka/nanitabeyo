// #1196 error-triage / 正規化ルール表（唯一の正）。
//
// 横断レビュー 1-2 の決定:
//   ① 正規化（このファイルのルール表）は **SQL** で適用する（group by の前に効かせないと集約が壊れる／
//      生テキストを BigQuery の外へ出さない）。
//   ③ fingerprint のハッシュ合成だけを JS（fingerprint.js）で行う。
//
// つまり本番で実際に走るのは PR2 で生成する `sql/error-triage.sql` の REGEXP_REPLACE 群だが、
// **その生成元はこのファイル一本**とする。生成物と一致することを CI で固定する。
// 生成の材料は2つあり、**どちらもこのファイルが唯一の正**である:
//   - `NORMALIZE_RULES`  … 置換ルール（`REGEXP_REPLACE(<expr>, r'<re2Pattern>', '<replacement>')` を順に重ねる）
//   - `POST_RULE_STEPS`  … 置換後の後処理（trim → 切り出し → trim）。各要素が `sql` 断片を持つ
//
// したがってルールは **RE2 と JS 正規表現の共通部分集合**に限定しなければならない:
//   - 先読み / 後読み `(?=` `(?!` `(?<=` `(?<!` を使わない
//   - 後方参照 `\1` を使わない
//   - インラインフラグ `(?i)` `(?s)` `(?m)` を使わない（RE2 は解釈するが JS は解釈しない）
//     → 大文字小文字を許す箇所は `[0-9a-fA-F]` のように文字クラスへ展開する
//   - **Unicode 差のあるショートハンド `\s` `\S` `\w` `\W` を使わない**（PR #1200 レビュー B-1）
//     RE2 の `\s` は `[\t\n\f\r ]`（ASCII のみ。`\v` すら含まない）だが、
//     JS の `\s` は U+00A0 / U+2007 / U+3000 / U+FEFF / `\v` などの Unicode 空白を含む。
//     同じルール文字列が SQL と JS で**違う結果**を出すため、明示的な文字クラスへ展開する。
//     `\d` と `\b` は RE2 / JS とも ASCII 一致なのでそのまま使ってよい。
//   これらは normalize-rules.test.js が **機械的に**検査する（構文だけでなく意味の差も検査する）。
//
// B-1 の帰結として、各ルールは **JS 表記（`pattern`）と RE2 表記（`re2Pattern`）の2つ**を持つ。
// U+3000 のような非 ASCII を文字クラスへ書くときの表記が JS は `\uXXXX`、RE2 は `\x{XXXX}` と
// 違うためで、**両方とも `WHITESPACE_CODE_POINTS` 1つから機械的に生成する**。
// つまり唯一の正は「コードポイントの集合」であって、正規表現の文字列そのものではない。

"use strict";

const { MESSAGE_PATTERN_MAX_LENGTH } = require("./constants");

/** 不透明トークン（ルール8）の最小長。 */
const OPAQUE_TOKEN_MIN_LENGTH = 28;

/**
 * 折り畳む空白文字のコードポイント（唯一の正。B-1 対応）。
 *
 * **JS の `\s`（WhiteSpace ∪ LineTerminator）と完全に同一の集合**にしてある
 * （同一であることは normalize-rules.test.js が U+0000〜U+FFFF 総当たりで検査する）。
 * RE2 の `\s` はこの部分集合（`[\t\n\f\r ]`）しか持たないので、**ショートハンドではなく
 * この配列から生成した文字クラス**を両エンジンへ渡すことで意味を一致させる。
 *
 * 日本語アプリなので U+3000（全角スペース）は**畳む側**に入れる。
 * 入力値をエコーするバリデーションエラー（`name="すし　太郎"`）が半角版と別グループに
 * 割れるのを防ぐため。RE2 側は `\x{3000}` 表記になるが、それは下の生成器が吸収する。
 *
 * @type {ReadonlyArray<number>}
 */
const WHITESPACE_CODE_POINTS = Object.freeze([
	0x0009, // CHARACTER TABULATION (\t)
	0x000a, // LINE FEED (\n)
	0x000b, // LINE TABULATION (\v) ← RE2 の \s には入らない
	0x000c, // FORM FEED (\f)
	0x000d, // CARRIAGE RETURN (\r)
	0x0020, // SPACE
	0x00a0, // NO-BREAK SPACE
	0x1680, // OGHAM SPACE MARK
	0x2000, // EN QUAD
	0x2001, // EM QUAD
	0x2002, // EN SPACE
	0x2003, // EM SPACE
	0x2004, // THREE-PER-EM SPACE
	0x2005, // FOUR-PER-EM SPACE
	0x2006, // SIX-PER-EM SPACE
	0x2007, // FIGURE SPACE
	0x2008, // PUNCTUATION SPACE
	0x2009, // THIN SPACE
	0x200a, // HAIR SPACE
	0x2028, // LINE SEPARATOR
	0x2029, // PARAGRAPH SEPARATOR
	0x202f, // NARROW NO-BREAK SPACE
	0x205f, // MEDIUM MATHEMATICAL SPACE
	0x3000, // IDEOGRAPHIC SPACE（全角スペース）
	0xfeff, // ZERO WIDTH NO-BREAK SPACE (BOM)
]);

/**
 * コードポイント1つを正規表現の文字クラス内表記へ変換する。
 *
 * @param {number} codePoint
 * @param {"js"|"re2"} dialect
 * @returns {string}
 */
const escapeCodePoint = (codePoint, dialect) => {
	const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
	return dialect === "re2" ? `\\x{${hex}}` : `\\u${hex}`;
};

/**
 * コードポイントの集合を、連続部分を範囲へ畳んだ文字クラスの中身にする。
 * 3個以上連続していれば `a-z` 形式、2個以下なら個別に並べる。
 *
 * @param {ReadonlyArray<number>} codePoints
 * @param {"js"|"re2"} dialect
 * @returns {string}
 */
const renderCodePointRanges = (codePoints, dialect) => {
	const sorted = [...codePoints].sort((a, b) => a - b);
	let out = "";
	let index = 0;
	while (index < sorted.length) {
		let last = index;
		while (last + 1 < sorted.length && sorted[last + 1] === sorted[last] + 1) last += 1;
		out +=
			last - index >= 2
				? `${escapeCodePoint(sorted[index], dialect)}-${escapeCodePoint(sorted[last], dialect)}`
				: sorted
						.slice(index, last + 1)
						.map((codePoint) => escapeCodePoint(codePoint, dialect))
						.join("");
		index = last + 1;
	}
	return out;
};

/**
 * 文字クラスを組み立てる。
 *
 * @param {{codePoints: ReadonlyArray<number>, dialect: "js"|"re2", negated?: boolean, literals?: string}} params
 * @returns {string}
 */
const buildCharClass = ({ codePoints, dialect, negated = false, literals = "" }) =>
	`[${negated ? "^" : ""}${renderCodePointRanges(codePoints, dialect)}${literals}]`;

/** 空白1文字（ルール10 用）。 */
const whitespaceClass = (dialect) => buildCharClass({ codePoints: WHITESPACE_CODE_POINTS, dialect });

/** 空白でも `"` `'` `)` でもない1文字（ルール6 のクエリ文字列用）。 */
const queryCharClass = (dialect) =>
	buildCharClass({ codePoints: WHITESPACE_CODE_POINTS, dialect, negated: true, literals: "\"')" });

/**
 * 「改行を含む任意の1文字」（ルール0 用）。
 *
 * `[\s\S]` が定番だが、`\s` / `\S` は機械検査で禁止したので使わない
 * （この組み合わせ自体は両エンジンで同義だが、例外を1つ作ると検査が骨抜きになる）。
 * JS の文字列は UTF-16 なので上限は U+FFFF（＝全コードユニット＝全文字）、
 * RE2 は UTF-8 なので上限は `\x{10FFFF}`。表記が違うだけで意味は同じ。
 */
const ANY_CHAR_CLASS = Object.freeze({ js: "[\\u0000-\\uFFFF]", re2: "[\\x{0000}-\\x{10FFFF}]" });

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
 * ASCII だけで構成されるので JS 表記と RE2 表記は同一である。
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
 *   pattern     … **JS 表記**の正規表現ソース（フラグは常に `g` 相当）
 *   re2Pattern  … **RE2 表記**の正規表現ソース。ASCII だけのルールでは `pattern` と同一（B-1）
 *   replacement … 置換後の文字列（後方参照を含まない）
 *   why         … なぜ潰すのか
 *
 * @type {ReadonlyArray<{id:number,name:string,pattern:string,re2Pattern:string,replacement:string,why:string}>}
 */
const NORMALIZE_RULES = Object.freeze(
	[
		{
			id: 0,
			name: "first-line-only",
			// SQL 側は REGEXP_EXTRACT(s, r'^[^\r\n]*') でも同義だが、
			// 「置換ルール表」として形を揃えるため 2行目以降を消す置換で表現する。
			pattern: `[\\r\\n]${ANY_CHAR_CLASS.js}*$`,
			re2Pattern: `[\\r\\n]${ANY_CHAR_CLASS.re2}*$`,
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
			// B-1: 元は `\?[^\s"')]*`。RE2 の `\s` は U+3000 を含まないので、SQL 側だけが
			// 「?key=v　続きの日本語」の日本語本文まで巻き込んで消していた。
			// 空白の定義を WHITESPACE_CODE_POINTS へ明示して両エンジンを一致させる。
			pattern: `\\?${queryCharClass("js")}*`,
			re2Pattern: `\\?${queryCharClass("re2")}*`,
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
			// B-1: 元は `\s+`。RE2 の `\s` は `[\t\n\f\r ]` しか畳まないため、
			// SQL 側では全角スペース入りのメッセージが畳まれず（＝半角版と別 fingerprint になり
			// 重複起票され）、さらに JS の isNormalized() が false を返して run 全体が invalid になっていた。
			pattern: `${whitespaceClass("js")}+`,
			re2Pattern: `${whitespaceClass("re2")}+`,
			replacement: " ",
			why: "整形差の吸収。畳む対象は WHITESPACE_CODE_POINTS（全角スペースを含む）",
		},
	].map((rule) => Object.freeze({ ...rule, re2Pattern: rule.re2Pattern ?? rule.pattern })),
);

/** ルール名 → ルール の索引。 */
const RULES_BY_NAME = Object.freeze(Object.fromEntries(NORMALIZE_RULES.map((rule) => [rule.name, rule])));

// ---------------------------------------------------------------------------
// pathName 専用の後段ルール — 先頭ロケールを剥がす（#1196 CLUSTERING.md 類型1 / fpalgo 2）
// ---------------------------------------------------------------------------
//
// なぜ NORMALIZE_RULES に入れないのか:
//   NORMALIZE_RULES は messagePattern / pathName / route(fe) / route(be) / endpoint の
//   **5スロット全部**に同じ式が掛かる（sql-generator.js の UNNEST + WITH OFFSET）。
//   ロケール剥がしは `pathName`（＝ app-expo の画面パス）にだけ意味があり、
//   backend の route（`/v<n>/dishes/bulk-import`）や external の endpoint へ掛けると
//   別物を潰しかねない。**掛ける対象を絞るために別の表**にする。
//
// なぜ NORMALIZE_RULES の**あと**に掛けるのか（順序は逆にしない）:
//   旧 fingerprint（fpalgo 1）の pathName は `normalize(raw)` そのものだった。
//   ロケール剥がしを normalize の**後**に置けば
//       v1 の pathName = '/' + localeTag + (v2 の pathName === '/' ? '' : v2 の pathName)
//   が**厳密に**成り立ち、v2 の出力だけから v1 の fingerprint を復元できる（＝移行できる）。
//   先に剥がすと、後段の切り出し（SUBSTR 200文字）がロケールの有無で違う位置を切るため
//   この等式が壊れ、既存 Issue との突合が復元不能になる。
//
// この順序の帰結として、**入力は既に normalize 済み**である。つまり数値ルール（ルール9）が
// 先に効いているので、UN M.49 の数値リージョン `es-419` は `es-<n>` の形で到達する。
// ロケールの文法にリテラル `<n>` を含めているのはそのため。
//
// ★ app-expo のルーティング（`app-expo/app/[locale]/…`）を確認した結果:
//   - 画面は**全て** `app/[locale]/` 配下にある。したがって path_name の第1セグメントは
//     原則としてロケール。例外は root（`/`）と `app/store.tsx`（`/store`）だけ。
//   - 実データには `[locale]` が**未解決のまま**載ったパスが実在する
//     （`/es-ES/[locale]/contribution-tasks/…`）。同じ画面なので同じく剥がす。
//   - 剥がしすぎの実害を避けるため、**素の3文字言語タグ（`fil` 等）は剥がさない**。
//     `app/[locale]/(tabs)/map.tsx` の `map` が「3文字の小文字」に当たるので、
//     これを許すと `/ja-JP/map` → `/map` → `/` と2段で画面名まで消える（＝冪等でなくなる）。
//     素で許すのは2文字言語タグだけにし、3文字はリージョン/スクリプト付きのみ許す。
//     ルート配下に「ちょうど2文字の小文字」セグメントは1つも無いので、これは安全側。

/**
 * ロケール1セグメントの文法（BCP-47 の先頭部分の**保守的な部分集合**）。
 *
 * 受け付ける形:
 *   `ja` `en`                        … 2文字言語タグ（素で許すのはここだけ）
 *   `ja-JP` `en-IE` `fil-PH`         … 言語 + 2文字リージョン
 *   `es-<n>`                         … 言語 + 数値リージョン（`es-419` がルール9 を通った姿）
 *   `zh-Hant` `zh-Hant-TW`           … 言語 + スクリプト（+ リージョン）
 *   `[locale]`                       … expo-router の未解決の動的セグメント
 *
 * 受け付けない形（＝剥がさない）:
 *   `map` `food` `post` `auth` `store` … 実在する画面名。3文字素通しを許さないので当たらない
 *   `ja-jp` `JA-JP`                    … 正準でない大小文字。畳み損ねるだけで壊さない（安全側）
 *
 * ASCII だけで構成されるので JS 表記と RE2 表記は同一。
 */
const LOCALE_SEGMENT_PATTERN =
	"(?:[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|<n>)|[a-z]{2,3}-[A-Z][a-z]{3}|[a-z]{2}|\\[locale\\])";

/** ロケールの直後に続く、未解決の `[locale]` セグメントの繰り返し（`/es-ES/[locale]/…` 対策）。 */
const LOCALE_TAIL_PATTERN = "(?:/\\[locale\\])*";

/** 剥がす対象の先頭ロケール部（スラッシュを除いた本体）。 */
const LOCALE_PREFIX_PATTERN = `${LOCALE_SEGMENT_PATTERN}${LOCALE_TAIL_PATTERN}`;

/**
 * pathName の先頭ロケールを剥がす置換ルール（適用順）。
 *
 * 2本に分けてあるのは、置換文字列に後方参照を使わない（RE2 / JS の方言差を持ち込まない）ため。
 * 「ロケール + `/`」と「ロケールだけ（＝パスがロケールで終わる）」を別のルールにすれば
 * どちらも置換後は `/` 固定になり、後方参照が要らない。
 *
 * 順序も重要で、先に**接頭辞**（末尾に `/` があるもの）を処理する。
 * 逆にすると `/ja-JP/map` に対して「全体がロケール列」の解釈を試すことになり、
 * `map` を巻き込む余地が生まれる。
 *
 * @type {ReadonlyArray<{id:number,name:string,pattern:string,re2Pattern:string,replacement:string,why:string}>}
 */
const PATH_LOCALE_RULES = Object.freeze(
	[
		{
			id: 0,
			name: "path-locale-prefix",
			pattern: `^/${LOCALE_PREFIX_PATTERN}/`,
			replacement: "/",
			why: "`/ja-JP/search/result` と `/en-US/search/result` を同じ画面として畳む（CLUSTERING.md 類型1）",
		},
		{
			id: 1,
			name: "path-locale-only",
			pattern: `^/${LOCALE_PREFIX_PATTERN}$`,
			replacement: "/",
			why: "`/ja-JP` `/ja` `/en-US`（ロケールだけのパス＝トップ画面）を `/` に畳む",
		},
	].map((rule) => Object.freeze({ ...rule, re2Pattern: rule.re2Pattern ?? rule.pattern })),
);

/**
 * 剥がしたロケール部を取り出す正規表現（`localeCounts` の集計キー）。
 *
 * 捕獲するのは**剥がした部分そのもの**（`ja-JP` / `[locale]` / `es-ES/[locale]`）。
 * 「どのロケールで何件出ているか」を Issue 本文へ残すためと、
 * v1 fingerprint を復元して既存 Issue と突合するための2用途がある。
 * 捕獲グループは RE2 / JS 双方にあるので使ってよい（禁止しているのは**後方参照**）。
 */
const PATH_LOCALE_EXTRACT = Object.freeze({
	name: "path-locale-extract",
	pattern: `^/(${LOCALE_PREFIX_PATTERN})(?:/|$)`,
	re2Pattern: `^/(${LOCALE_PREFIX_PATTERN})(?:/|$)`,
	why: "ロケール内訳（localeCounts）と、旧 fingerprint 復元のためのロケール名",
});

// 実装（stripPathLocale / extractPathLocale / …）は normalize() のあとに置く。

// ---------------------------------------------------------------------------
// 置換ルールのあとに掛ける後処理（S-1: これも「唯一の正」に含める）
// ---------------------------------------------------------------------------

/** `POST_RULE_STEPS[].sql` の中で「直前までの式」を指すプレースホルダ。PR2 の生成器が差し替える。 */
const SQL_EXPR_PLACEHOLDER = "<expr>";

/** 折り畳む空白文字そのもの（JS 側の trim 用）。 */
const WHITESPACE_CHARS = WHITESPACE_CODE_POINTS.map((codePoint) => String.fromCodePoint(codePoint)).join("");

/**
 * BigQuery の `TRIM(value, characters)` へ渡す文字集合リテラル。
 *
 * 引数なしの `TRIM(value)` は「空白」の定義がこちらの集合と一致する保証が無いので使わない。
 * `WHITESPACE_CODE_POINTS` から生成しているので、集合を足し引きしても SQL 側が自動で追従する。
 */
const SQL_WHITESPACE_LITERAL = `'${WHITESPACE_CODE_POINTS.map(
	(codePoint) => `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
).join("")}'`;

/**
 * 前後の空白（WHITESPACE_CODE_POINTS）を落とす。
 *
 * @param {string} value
 * @returns {string}
 */
const trimWhitespace = (value) => {
	let start = 0;
	let end = value.length;
	while (start < end && WHITESPACE_CHARS.includes(value[start])) start += 1;
	while (end > start && WHITESPACE_CHARS.includes(value[end - 1])) end -= 1;
	return value.slice(start, end);
};

/**
 * **コードポイント単位**で先頭 N 文字を取り出す（S-1）。
 *
 * JS の `slice()` は UTF-16 コードユニット単位、BigQuery の `SUBSTR()` は文字単位なので、
 * 非BMP文字（絵文字など）が混ざると切り出し位置がズレるうえ、境界にサロゲートペアが来ると
 * **孤立サロゲート**が生まれる。孤立サロゲートはそのまま Issue 本文へ載って GitHub API へ渡る。
 *
 * @param {string} value
 * @param {number} maxCodePoints
 * @returns {string}
 */
const truncateByCodePoints = (value, maxCodePoints) => {
	const codePoints = Array.from(value);
	return codePoints.length <= maxCodePoints ? value : codePoints.slice(0, maxCodePoints).join("");
};

/**
 * 置換ルールを全て適用したあとに掛ける後処理（適用順）。
 *
 * S-1 対応: これらが `NORMALIZE_RULES` の外にあると、PR2 がルール表から生成した SQL は
 * trim も truncate もしない式を吐き、その出力を `isNormalized()` が「未正規化」と判定して
 * `validateEnvelope` に弾かれる。**後処理も契約の一部**として明示的に持つ。
 *
 * 各要素:
 *   id   … 適用順
 *   name … 識別子
 *   apply … JS 側の実装
 *   sql   … SQL 側の等価な式。`<expr>`（SQL_EXPR_PLACEHOLDER）を直前までの式で置換して使う
 *   why   … なぜ要るのか
 *
 * @type {ReadonlyArray<{id:number,name:string,apply:(value:string)=>string,sql:string,why:string}>}
 */
const POST_RULE_STEPS = Object.freeze(
	[
		{
			id: 0,
			name: "trim",
			apply: (value) => trimWhitespace(value),
			sql: `TRIM(${SQL_EXPR_PLACEHOLDER}, ${SQL_WHITESPACE_LITERAL})`,
			why: "ルール10 が畳んだあとの前後の空白を落とす。SQL 側は TRIM の既定の空白定義に頼らず集合を明示する",
		},
		{
			id: 1,
			name: "truncate",
			apply: (value) => truncateByCodePoints(value, MESSAGE_PATTERN_MAX_LENGTH),
			sql: `SUBSTR(${SQL_EXPR_PLACEHOLDER}, 1, ${MESSAGE_PATTERN_MAX_LENGTH})`,
			why: "ハッシュ入力と Issue タイトルを有界にする（#1197 §3-2）。BigQuery の SUBSTR に合わせてコードポイント単位で切る",
		},
		{
			id: 2,
			name: "trim-after-truncate",
			apply: (value) => trimWhitespace(value),
			sql: `TRIM(${SQL_EXPR_PLACEHOLDER}, ${SQL_WHITESPACE_LITERAL})`,
			why: "切り詰めた結果の末尾が空白になると normalize が冪等でなくなり、不変条件3の検査（isNormalized）が誤検知する",
		},
	].map(Object.freeze),
);

/**
 * ルール1件を JS の RegExp としてコンパイルする。
 * SQL 生成側（PR2）はコンパイルせず `re2Pattern` 文字列をそのまま埋め込む。
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
 * @returns {string|null} 正規化済み文字列（最大 MESSAGE_PATTERN_MAX_LENGTH コードポイント）
 */
const normalize = (value) => {
	if (value === null || value === undefined) return null;
	let out = String(value);
	for (const rule of NORMALIZE_RULES) {
		out = out.replace(compileRule(rule), rule.replacement);
	}
	for (const step of POST_RULE_STEPS) {
		out = step.apply(out);
	}
	return out;
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

// ---------------------------------------------------------------------------
// pathName 専用ルールの実装（表は上の PATH_LOCALE_RULES / PATH_LOCALE_EXTRACT）
// ---------------------------------------------------------------------------

/**
 * pathName から先頭ロケールを剥がす。**入力は normalize() 済みであることが前提**。
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
const stripPathLocale = (value) => {
	if (value === null || value === undefined) return null;
	let out = String(value);
	for (const rule of PATH_LOCALE_RULES) {
		out = out.replace(compileRule(rule), rule.replacement);
	}
	return out;
};

/**
 * pathName の先頭ロケール部を取り出す。ロケールが無ければ null。
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
const extractPathLocale = (value) => {
	if (value === null || value === undefined) return null;
	const matched = new RegExp(PATH_LOCALE_EXTRACT.pattern).exec(String(value));
	return matched ? matched[1] : null;
};

/**
 * ロケール部と剥がしたあとの pathName から、剥がす前の pathName を**厳密に**復元する。
 *
 * 移行（fpalgo 1 → 2）の要。`stripPathLocale` の逆写像であることを
 * テストが往復で検査する（path-locale.test.js）。
 *
 * @param {string|null|undefined} locale 例 `ja-JP` / `[locale]` / `es-ES/[locale]`
 * @param {string|null|undefined} strippedPathName 例 `/search/result` / `/`
 * @returns {string|null} 例 `/ja-JP/search/result` / `/ja-JP`
 */
const restorePathLocale = (locale, strippedPathName) => {
	if (locale === null || locale === undefined || locale === "") return strippedPathName ?? null;
	const rest = strippedPathName === null || strippedPathName === undefined ? "" : String(strippedPathName);
	return `/${locale}${rest === "/" ? "" : rest}`;
};

/**
 * pathName 用の完全な正規化（SQL 側の `keyPathName` と等価）。
 *
 * `normalize()` → 先頭ロケール剥がし、の順。順序の理由は PATH_LOCALE_RULES のコメントを参照。
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
const normalizePathName = (value) => stripPathLocale(normalize(value));

/**
 * 先頭ロケールが既に剥がされているか（＝もう一度剥がしても変わらないか）。
 *
 * @param {string|null|undefined} value
 * @returns {boolean}
 */
const isPathLocaleStripped = (value) => {
	if (value === null || value === undefined) return true;
	return stripPathLocale(value) === String(value);
};

module.exports = Object.freeze({
	OPAQUE_TOKEN_MIN_LENGTH,
	WHITESPACE_CODE_POINTS,
	ANY_CHAR_CLASS,
	NORMALIZE_RULES,
	POST_RULE_STEPS,
	SQL_EXPR_PLACEHOLDER,
	SQL_WHITESPACE_LITERAL,
	RULES_BY_NAME,
	LOCALE_SEGMENT_PATTERN,
	LOCALE_TAIL_PATTERN,
	LOCALE_PREFIX_PATTERN,
	PATH_LOCALE_RULES,
	PATH_LOCALE_EXTRACT,
	buildCharClass,
	buildOpaqueTokenPattern,
	compileRule,
	trimWhitespace,
	truncateByCodePoints,
	normalize,
	isNormalized,
	stripPathLocale,
	extractPathLocale,
	restorePathLocale,
	normalizePathName,
	isPathLocaleStripped,
});
