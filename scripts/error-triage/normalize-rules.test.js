"use strict";

const cases = require("./__fixtures__/normalize-cases.json");
const {
	ANY_CHAR_CLASS,
	NORMALIZE_RULES,
	OPAQUE_TOKEN_MIN_LENGTH,
	POST_RULE_STEPS,
	RULES_BY_NAME,
	SQL_EXPR_PLACEHOLDER,
	WHITESPACE_CODE_POINTS,
	buildOpaqueTokenPattern,
	compileRule,
	isNormalized,
	normalize,
	truncateByCodePoints,
} = require("./normalize-rules");
const { MESSAGE_PATTERN_MAX_LENGTH } = require("./constants");

/**
 * RE2 表記（`\x{XXXX}`）を JS 表記（`\uXXXX`）へ機械的に変換する。
 * これで「2つの表記が同じ集合を指しているか」をテスト側から検算できる。
 *
 * 唯一の例外が RE2 の上限 U+10FFFF で、JS の文字列は UTF-16 なので U+FFFF（全コードユニット）が対応する。
 */
const re2ToJsSource = (source) =>
	source.replace(/\\x\{([0-9A-Fa-f]{1,6})\}/g, (_match, hex) => {
		const codePoint = Number.parseInt(hex, 16);
		return codePoint > 0xffff ? "\\uFFFF" : `\\u${hex.toUpperCase().padStart(4, "0")}`;
	});

describe("置換ルール表そのもの", () => {
	it("適用順を保証する id の連番になっている", () => {
		expect(NORMALIZE_RULES.map((rule) => rule.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	it("凍結されていて呼び出し側から書き換えられない", () => {
		expect(Object.isFrozen(NORMALIZE_RULES)).toBe(true);
		expect(() => {
			"use strict";
			NORMALIZE_RULES[0].replacement = "boom";
		}).toThrow();
	});

	// PR2 でこの表から SQL 式を生成するため、RE2 で解釈できない構文を混ぜてはならない。
	describe.each(NORMALIZE_RULES.map((rule) => [rule.name, rule]))("ルール %s", (_name, rule) => {
		it("JS の RegExp としてコンパイルできる", () => {
			expect(() => compileRule(rule)).not.toThrow();
		});

		it("RE2 と JS の共通部分集合に収まっている（先読み・後読み・後方参照・インラインフラグを使わない）", () => {
			for (const source of [rule.pattern, rule.re2Pattern]) {
				expect(source).not.toMatch(/\(\?=/);
				expect(source).not.toMatch(/\(\?!/);
				expect(source).not.toMatch(/\(\?</);
				expect(source).not.toMatch(/\(\?[ims]+[):]/);
				expect(source).not.toMatch(/\\[1-9]/);
			}
		});

		// ★ B-1（PR #1200 レビュー）: 構文ではなく**意味**の差を捕まえる検査。
		//   RE2 の \s は [\t\n\f\r ]（ASCII のみ。\v すら含まない）、JS の \s は
		//   U+00A0 / U+2007 / U+3000 / U+FEFF / \v などを含む。\w / \W も同様に定義が揺れる。
		//   同じルール文字列が SQL と JS で違う結果を出すため、ショートハンドは一切使わない。
		//   （\d と \b は RE2 / JS とも ASCII 一致なので許可する。下の別テストで固定する。）
		it("Unicode 差のあるショートハンド（\\s / \\S / \\w / \\W）を使わない", () => {
			for (const source of [rule.pattern, rule.re2Pattern]) {
				expect(source).not.toMatch(/\\[sSwW]/);
			}
		});

		it("JS 表記に RE2 専用の \\x{...} を、RE2 表記に JS 専用の \\uXXXX を混ぜない", () => {
			expect(rule.pattern).not.toMatch(/\\x\{/);
			expect(rule.re2Pattern).not.toMatch(/\\u[0-9A-Fa-f]{4}/);
		});

		it("JS 表記と RE2 表記は同じ集合を指す（表記だけが違う）", () => {
			expect(re2ToJsSource(rule.re2Pattern)).toBe(rule.pattern);
		});

		it("置換文字列に後方参照を含まない（SQL 生成時に $1 / \\1 の方言差を持ち込まない）", () => {
			expect(rule.replacement).not.toMatch(/[$\\][0-9]/);
		});

		it("なぜ潰すのかが書いてある", () => {
			expect(typeof rule.why).toBe("string");
			expect(rule.why.length).toBeGreaterThan(0);
		});
	});
});

describe("B-1: 空白の定義が RE2 と JS で割れない", () => {
	it("WHITESPACE_CODE_POINTS は JS の \\s と完全に同一の集合（取りこぼしが無いことの裏取り）", () => {
		const declared = new Set(WHITESPACE_CODE_POINTS);
		const actual = new Set();
		for (let codePoint = 0; codePoint <= 0xffff; codePoint += 1) {
			if (/\s/.test(String.fromCharCode(codePoint))) actual.add(codePoint);
		}
		expect([...actual].sort((a, b) => a - b)).toEqual([...declared].sort((a, b) => a - b));
	});

	it("RE2 の \\s（ASCII のみ）の全要素を含む＝RE2 側が畳めるものは JS 側も必ず畳む", () => {
		// RE2: \s == [\t\n\f\r ]
		for (const codePoint of [0x09, 0x0a, 0x0c, 0x0d, 0x20]) {
			expect(WHITESPACE_CODE_POINTS).toContain(codePoint);
		}
	});

	it("日本語アプリなので全角スペース U+3000 は畳む側に入っている", () => {
		expect(WHITESPACE_CODE_POINTS).toContain(0x3000);
	});

	// レビュー本文の再現コマンドそのもの。修正前は false（＝run 全体が invalid）になっていた。
	it.each([
		["U+3000 全角スペース", "\u3000"],
		["U+00A0 NO-BREAK SPACE", "\u00a0"],
		["U+2007 FIGURE SPACE", "\u2007"],
		["U+FEFF ZERO WIDTH NO-BREAK SPACE", "\ufeff"],
		["U+000B 垂直タブ（\\v。RE2 の \\s にすら入らない）", "\u000b"],
		["U+202F NARROW NO-BREAK SPACE", "\u202f"],
		["U+205F MEDIUM MATHEMATICAL SPACE", "\u205f"],
		["U+1680 OGHAM SPACE MARK", "\u1680"],
		["U+2028 LINE SEPARATOR", "\u2028"],
	])("%s は半角スペース1つへ畳まれ、その結果は isNormalized() が true になる", (_label, whitespace) => {
		const raw = `Validation failed: name="すし${whitespace}太郎" is too long`;
		const normalized = normalize(raw);
		expect(normalized).toBe('Validation failed: name="すし 太郎" is too long');
		expect(isNormalized(raw)).toBe(false);
		expect(isNormalized(normalized)).toBe(true);
	});

	it("全角スペース版と半角スペース版が同じ messagePattern へ畳まれる（重複起票にならない）", () => {
		expect(normalize("name\u3000is invalid")).toBe(normalize("name is invalid"));
	});

	it("ルール6 は全角スペースで止まる（クエリ部の後ろの日本語本文まで巻き込まない）", () => {
		expect(normalize("GET /a?k=v\u3000続きの説明文です")).toBe("GET /a? 続きの説明文です");
	});

	it("ルール0（1行目だけ残す）は \\s を使わずに任意の1文字を表す", () => {
		expect(RULES_BY_NAME["first-line-only"].pattern).toBe(`[\\r\\n]${ANY_CHAR_CLASS.js}*$`);
		expect(normalize("first line\n\u3000second\u2028third")).toBe("first line");
		expect(normalize("first line\r\nsecond")).toBe("first line");
	});

	it("\\d と \\b は RE2 / JS とも ASCII 一致なので使ってよい（全角数字を拾わない）", () => {
		// 全角数字 １２３ が <n> になるなら \d が Unicode 解釈されている、という検算。
		expect(normalize("code １２３ here")).toBe("code １２３ here");
		expect(normalize("code 123 here")).toBe("code <n> here");
	});
});

describe("S-1: 後処理（trim / 切り出し）もルール表の外に置かない", () => {
	it("POST_RULE_STEPS が trim → 切り出し → trim の3手順を順番に持つ", () => {
		expect(POST_RULE_STEPS.map((step) => step.name)).toEqual(["trim", "truncate", "trim-after-truncate"]);
		expect(POST_RULE_STEPS.map((step) => step.id)).toEqual([0, 1, 2]);
	});

	it("各手順が SQL 断片を併記している（PR2 がルール表から SQL を生成できる）", () => {
		for (const step of POST_RULE_STEPS) {
			expect(step.sql).toContain(SQL_EXPR_PLACEHOLDER);
			expect(typeof step.why).toBe("string");
			expect(step.why.length).toBeGreaterThan(0);
		}
		expect(POST_RULE_STEPS[1].sql).toBe(`SUBSTR(${SQL_EXPR_PLACEHOLDER}, 1, ${MESSAGE_PATTERN_MAX_LENGTH})`);
		// TRIM は既定の空白定義に頼らず、WHITESPACE_CODE_POINTS を明示指定する。
		expect(POST_RULE_STEPS[0].sql).toContain("\\u3000");
		expect(POST_RULE_STEPS[0].sql).toBe(POST_RULE_STEPS[2].sql);
	});

	it("凍結されていて呼び出し側から書き換えられない", () => {
		expect(Object.isFrozen(POST_RULE_STEPS)).toBe(true);
		expect(() => {
			POST_RULE_STEPS[1].sql = "boom";
		}).toThrow();
	});

	it("normalize() は POST_RULE_STEPS を順に適用したものと一致する（表が実装から離れない）", () => {
		const rulesOnly = NORMALIZE_RULES.reduce(
			(acc, rule) => acc.replace(compileRule(rule), rule.replacement),
			`  ${"z".repeat(300)}\u3000 `,
		);
		const viaSteps = POST_RULE_STEPS.reduce((acc, step) => step.apply(acc), rulesOnly);
		expect(normalize(`  ${"z".repeat(300)}\u3000 `)).toBe(viaSteps);
	});

	it("切り出しはコードポイント単位（BigQuery の SUBSTR と同じ単位）", () => {
		expect(truncateByCodePoints("\u{1F600}\u{1F601}\u{1F602}", 2)).toBe("\u{1F600}\u{1F601}");
		expect(truncateByCodePoints("abc", 10)).toBe("abc");
	});

	it("境界に絵文字が来ても孤立サロゲートを作らない", () => {
		const out = normalize(`${"x".repeat(MESSAGE_PATTERN_MAX_LENGTH - 1)}\u{1F600}tail`);
		expect(Array.from(out)).toHaveLength(MESSAGE_PATTERN_MAX_LENGTH);
		expect(out.endsWith("\u{1F600}")).toBe(true);
		// 孤立サロゲート（ペアの片割れだけ）が1つも無いこと。
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
	});

	it("切り出し位置の直後に絵文字が来る場合は丸ごと落ちる（半分だけ残らない）", () => {
		const out = normalize(`${"x".repeat(MESSAGE_PATTERN_MAX_LENGTH)}\u{1F600}tail`);
		expect(out).toBe("x".repeat(MESSAGE_PATTERN_MAX_LENGTH));
	});

	it("非BMP文字を含んでいても切り出しは 200 コードポイント（UTF-16 コードユニットではない）", () => {
		const out = normalize("\u{1F600}".repeat(300));
		expect(Array.from(out)).toHaveLength(MESSAGE_PATTERN_MAX_LENGTH);
		expect(out).toHaveLength(MESSAGE_PATTERN_MAX_LENGTH * 2); // サロゲートペアなので UTF-16 では倍
	});
});

describe("normalize() — #1197 §3-4 の fixture", () => {
	it.each(cases.map((c) => [c.id, c]))("%s", (_id, testCase) => {
		expect(normalize(testCase.input)).toBe(testCase.expected);
	});
});

describe("S1: ルール8（不透明トークン）が CamelCase 識別子を潰さない", () => {
	// 横断レビュー S1: #1197 §3-2 のルール8 `\b[A-Za-z0-9_-]{20,}\b` は
	// LocationPermissionError（23文字）を <token> に化けさせ、同 §3-4 の例8 を
	// この設計自身のルールで再現できなくしていた。
	it.each([
		["LocationPermissionError", 23],
		["UnhandledRejectionError", 23],
		["UnhandledRejectionErrorInBackgroundTask", 39],
		["MaintenanceGuardVersionMismatchException", 40],
	])("英字のみの識別子 %s (%i文字) は素通りする", (identifier, expectedLength) => {
		expect(identifier).toHaveLength(expectedLength);
		expect(normalize(`${identifier}: boom`)).toBe(`${identifier}: boom`);
	});

	it("閾値は 28 文字", () => {
		expect(OPAQUE_TOKEN_MIN_LENGTH).toBe(28);
	});

	it("28文字未満は数字を含んでいても <token> にしない", () => {
		// 27 文字。数字は含むが閾値未満。ルール9（数字）が別途効くだけ。
		const token = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9";
		expect(token).toHaveLength(27);
		expect(normalize(`id ${token} end`)).not.toContain("<token>");
	});

	it("28文字以上でも数字を含まなければ <token> にしない", () => {
		const token = "AbcdefghijklmnopqrstuvwxyzAB";
		expect(token).toHaveLength(28);
		expect(normalize(`id ${token} end`)).toBe(`id ${token} end`);
	});

	it("28文字以上かつ数字を含めば、数字がどの位置にあっても <token> にする", () => {
		const base = "abcdefghijklmnopqrstuvwxyzAB"; // 28文字
		for (let position = 0; position < base.length; position += 1) {
			const token = `${base.slice(0, position)}7${base.slice(position + 1)}`;
			expect(token).toHaveLength(28);
			expect(normalize(`id ${token} end`)).toBe("id <token> end");
		}
	});

	it("29文字目以降にしか数字が無くても <token> にする", () => {
		const token = "abcdefghijklmnopqrstuvwxyzABC7";
		expect(token).toHaveLength(30);
		expect(normalize(`id ${token} end`)).toBe("id <token> end");
	});
});

describe("buildOpaqueTokenPattern()", () => {
	it("最小長を変えると閾値も変わる（生成器であって手書きではない）", () => {
		const pattern = new RegExp(buildOpaqueTokenPattern(10));
		expect(pattern.test("abcdefgh9i")).toBe(true); // 10文字・数字あり
		expect(pattern.test("abcdefgh9")).toBe(false); // 9文字
		expect(pattern.test("abcdefghij")).toBe(false); // 数字なし
	});
});

describe("normalize() の性質", () => {
	it("null / undefined は null を返す（SQL の NULL に対応）", () => {
		expect(normalize(null)).toBeNull();
		expect(normalize(undefined)).toBeNull();
	});

	it("極端に長い入力でも例外にならず 200 文字で切られる", () => {
		const long = "x".repeat(5000);
		const result = normalize(long);
		expect(result).toHaveLength(MESSAGE_PATTERN_MAX_LENGTH);
	});

	it("冪等（正規化済みの値をもう一度通しても変わらない）", () => {
		for (const testCase of cases) {
			const once = normalize(testCase.input);
			expect(normalize(once)).toBe(once);
		}
	});

	it("切り詰め境界に空白が来ても冪等が壊れない", () => {
		// 'a' は 16進文字なのでルール7に食われる。境界だけを見たいので非16進の 'x' を使う。
		const input = `${"x".repeat(MESSAGE_PATTERN_MAX_LENGTH - 1)} yyyy`;
		const once = normalize(input);
		expect(normalize(once)).toBe(once);
		expect(once.endsWith(" ")).toBe(false);
	});

	it("URLクエリ部の秘密値は必ず落ちる", () => {
		const withKey = "https://www.googleapis.com/customsearch/v1?key=AIzaSyDsecretsecret&cx=017";
		expect(normalize(withKey)).not.toContain("AIzaSy");
	});
});

describe("isNormalized() — 不変条件 3 の判定器", () => {
	it("生値（UUID を含む）は正規化済みではない", () => {
		expect(isNormalized("/v1/dish-media/9c1e77aa-2b31-41d0-9f2e-77aa2b3141d0/likes")).toBe(false);
	});

	it("正規化済みの値は正規化済みと判定する", () => {
		expect(isNormalized("/v<n>/dish-media/<uuid>/likes")).toBe(true);
	});

	it("null は正規化済み扱い", () => {
		expect(isNormalized(null)).toBe(true);
	});
});

describe("RULES_BY_NAME", () => {
	it("名前で引ける", () => {
		expect(RULES_BY_NAME["opaque-token"].id).toBe(8);
		expect(RULES_BY_NAME.uuid.replacement).toBe("<uuid>");
	});
});
