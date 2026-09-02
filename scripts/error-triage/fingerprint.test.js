"use strict";

const rows = require("./__fixtures__/bq-rows.json");
const {
	FINGERPRINT_KEY_FIELDS,
	FINGERPRINT_PATTERN,
	FP_ALGO_VERSION,
	assertSqlFpAlgoVersion,
	attachFingerprints,
	buildFingerprintInput,
	computeFingerprint,
	encodeField,
	parseSqlFpAlgoVersion,
} = require("./fingerprint");

const backendRow = rows.find((row) => row.surface === "backend");
const frontendRow = rows.find((row) => row.surface === "frontend");
const externalRow = rows.find((row) => row.surface === "external");

const withGroupKey = (row, patch) => ({ ...row, groupKey: { ...row.groupKey, ...patch } });

describe("computeFingerprint()", () => {
	it("常に12桁の小文字16進を返す（#1196 のマーカー形式）", () => {
		for (const row of rows) {
			expect(computeFingerprint(row)).toMatch(FINGERPRINT_PATTERN);
		}
	});

	it("同一入力に対して決定的", () => {
		expect(computeFingerprint(backendRow)).toBe(computeFingerprint(backendRow));
		expect(computeFingerprint({ ...backendRow })).toBe(computeFingerprint(backendRow));
	});

	it("同一エラーの別インスタンス（正規化で潰れる差）は同一 fingerprint になる", () => {
		// 正規化は SQL 側の仕事なので、JS が受け取る時点で messagePattern は既に同じ値になっている。
		// ここで確認したいのは「正規化後が同じなら fingerprint も同じ」という合成側の性質。
		const a = { ...backendRow, occurrences: 1, firstSeenUtc: "2026-01-01T00:00:00Z" };
		const b = { ...backendRow, occurrences: 999, firstSeenUtc: "2026-12-31T23:00:00Z" };
		expect(computeFingerprint(a)).toBe(computeFingerprint(b));
	});

	it("キーの取り違えを検出する: pathName / eventName が違えば別 fingerprint", () => {
		const base = computeFingerprint(frontendRow);
		expect(computeFingerprint(withGroupKey(frontendRow, { pathName: "/ja/other" }))).not.toBe(base);
		expect(computeFingerprint(withGroupKey(frontendRow, { eventName: "other_event" }))).not.toBe(base);
	});

	it("矛盾E: httpStatus / route を変えれば別 fingerprint（4xx と 5xx が同居しない）", () => {
		const base = computeFingerprint(backendRow);
		expect(computeFingerprint(withGroupKey(backendRow, { httpStatus: 400 }))).not.toBe(base);
		expect(computeFingerprint(withGroupKey(backendRow, { route: "/v<n>/other" }))).not.toBe(base);
	});

	it("messagePattern が違えば別 fingerprint（frontend / backend）", () => {
		expect(computeFingerprint({ ...backendRow, messagePattern: "other" })).not.toBe(computeFingerprint(backendRow));
	});

	it("external は messagePattern を fingerprint に含めない（#1196: message 非依存）", () => {
		expect(computeFingerprint({ ...externalRow, messagePattern: "全然ちがうメッセージ" })).toBe(
			computeFingerprint(externalRow),
		);
	});

	it("external は apiName / endpoint / method / statusCode で割れる", () => {
		const base = computeFingerprint(externalRow);
		expect(computeFingerprint(withGroupKey(externalRow, { apiName: "Google Places" }))).not.toBe(base);
		expect(computeFingerprint(withGroupKey(externalRow, { endpoint: "/v<n>/other" }))).not.toBe(base);
		expect(computeFingerprint(withGroupKey(externalRow, { method: "GET" }))).not.toBe(base);
		expect(computeFingerprint(withGroupKey(externalRow, { statusCode: 500 }))).not.toBe(base);
	});

	it("surface が違えば別 fingerprint（キー構成そのものが違う）", () => {
		const asFrontend = { ...backendRow, surface: "frontend" };
		expect(computeFingerprint(asFrontend)).not.toBe(computeFingerprint(backendRow));
	});

	it("未知の surface は例外にする（不変条件 6 は呼び出し側で握る）", () => {
		expect(() => computeFingerprint({ ...backendRow, surface: "mobile" })).toThrow(/unknown surface/);
	});

	it("messagePattern が null / 空文字 / 極端に長くても例外にならない", () => {
		for (const messagePattern of [null, undefined, "", "z".repeat(10000)]) {
			expect(computeFingerprint({ ...backendRow, messagePattern })).toMatch(FINGERPRINT_PATTERN);
		}
	});

	it("null と空文字は同一に扱う（SQL の IFNULL(x,'') と同義）", () => {
		expect(computeFingerprint({ ...backendRow, messagePattern: null })).toBe(
			computeFingerprint({ ...backendRow, messagePattern: "" }),
		);
	});
});

describe("区切り文字の衝突（#1199 §7-3-A ケース10）", () => {
	it("`a|b` + `c` と `a` + `b|c` が衝突しない", () => {
		const left = withGroupKey(backendRow, { functionName: "a|b", eventName: "c" });
		const right = withGroupKey(backendRow, { functionName: "a", eventName: "b|c" });
		expect(buildFingerprintInput(left)).not.toBe(buildFingerprintInput(right));
		expect(computeFingerprint(left)).not.toBe(computeFingerprint(right));
	});

	it("エスケープ自体も衝突しない（`a\\` + `b` と `a` + `\\b`）", () => {
		const left = withGroupKey(backendRow, { functionName: "a\\", eventName: "b" });
		const right = withGroupKey(backendRow, { functionName: "a", eventName: "\\b" });
		expect(computeFingerprint(left)).not.toBe(computeFingerprint(right));
	});

	it("encodeField() が `|` と `\\` をエスケープする", () => {
		expect(encodeField("a|b")).toBe("a\\|b");
		expect(encodeField("a\\b")).toBe("a\\\\b");
		expect(encodeField(null)).toBe("");
		expect(encodeField(529)).toBe("529");
	});
});

describe("buildFingerprintInput()", () => {
	it("surface ごとに使うキー集合が違う", () => {
		expect(FINGERPRINT_KEY_FIELDS.frontend).toEqual(["pathName", "eventName", "route", "httpStatus"]);
		expect(FINGERPRINT_KEY_FIELDS.backend).toEqual(["functionName", "eventName", "httpStatus", "route"]);
		expect(FINGERPRINT_KEY_FIELDS.external).toEqual(["apiName", "endpoint", "method", "statusCode"]);
	});

	it("frontend に functionName を混ぜても fingerprint は変わらない（キー構成の取り違え検出）", () => {
		expect(computeFingerprint(withGroupKey(frontendRow, { functionName: "ApiExceptionFilter" }))).toBe(
			computeFingerprint(frontendRow),
		);
	});

	it("errorCode は fingerprint に含めない（契約 §7 のコメントどおり）", () => {
		expect(computeFingerprint(withGroupKey(frontendRow, { errorCode: "SOMETHING_ELSE" }))).toBe(
			computeFingerprint(frontendRow),
		);
	});

	it("先頭は必ず surface", () => {
		expect(buildFingerprintInput(backendRow).startsWith("backend|")).toBe(true);
	});
});

describe("attachFingerprints()", () => {
	it("入力行と 1:1（再グルーピングしない）", () => {
		const attached = attachFingerprints(rows);
		expect(attached).toHaveLength(rows.length);
		attached.forEach((row, index) => {
			expect(row.fingerprint).toBe(computeFingerprint(rows[index]));
			expect(row.occurrences).toBe(rows[index].occurrences);
		});
	});

	it("入力を破壊しない", () => {
		const before = JSON.stringify(rows);
		attachFingerprints(rows);
		expect(JSON.stringify(rows)).toBe(before);
	});
});

describe("FP_ALGO_VERSION と SQL の一致検査（横断レビュー 1-3）", () => {
	it("JS 側の定数が単一の数値として公開されている", () => {
		// fpalgo 2 = pathName の先頭ロケールを剥がす世代（#1196 CLUSTERING.md 類型1）
		expect(FP_ALGO_VERSION).toBe(2);
		expect(Number.isInteger(FP_ALGO_VERSION)).toBe(true);
	});

	it("SQL 冒頭の `-- fpalgo: N` を読み取れる", () => {
		const sql = `-- =====================\n-- fpalgo: ${FP_ALGO_VERSION}\n-- =====================\nSELECT 1;\n`;
		expect(parseSqlFpAlgoVersion(sql)).toBe(FP_ALGO_VERSION);
		expect(assertSqlFpAlgoVersion(sql).ok).toBe(true);
	});

	it("マーカーが無ければ不一致として扱う", () => {
		const result = assertSqlFpAlgoVersion("SELECT 1;");
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/fpalgo/);
	});

	it("SQL と JS がずれていたら検出する（片方だけ変えて全件再起票、を構造的に防ぐ）", () => {
		const result = assertSqlFpAlgoVersion(`-- fpalgo: ${FP_ALGO_VERSION + 1}\nSELECT 1;`);
		expect(result.ok).toBe(false);
		expect(result.sqlVersion).toBe(FP_ALGO_VERSION + 1);
		expect(result.jsVersion).toBe(FP_ALGO_VERSION);
	});

	it("行の途中にある `-- fpalgo: 9` は拾わない", () => {
		expect(parseSqlFpAlgoVersion("SELECT 1; -- fpalgo: 9")).toBeNull();
	});
});
