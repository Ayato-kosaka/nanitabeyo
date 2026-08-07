"use strict";

const cases = require("./__fixtures__/normalize-cases.json");
const {
	NORMALIZE_RULES,
	OPAQUE_TOKEN_MIN_LENGTH,
	RULES_BY_NAME,
	buildOpaqueTokenPattern,
	compileRule,
	isNormalized,
	normalize,
} = require("./normalize-rules");
const { MESSAGE_PATTERN_MAX_LENGTH } = require("./constants");

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
			expect(rule.pattern).not.toMatch(/\(\?=/);
			expect(rule.pattern).not.toMatch(/\(\?!/);
			expect(rule.pattern).not.toMatch(/\(\?</);
			expect(rule.pattern).not.toMatch(/\(\?[ims]+[):]/);
			expect(rule.pattern).not.toMatch(/\\[1-9]/);
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
