// 横断レビュー §7「確定した単一の入出力契約」の**不変条件6項目**をここで固定する。
// 契約が壊れたことに CI で気づけるようにするのがこのファイルの唯一の目的なので、
// 6項目それぞれに対応する describe を1つずつ置き、番号を残す。

"use strict";

const rows = require("./__fixtures__/bq-rows.json");
const runSummary = require("./__fixtures__/run-summary.json");
const { FP_ALGO_VERSION, SCHEMA_VERSION, SURFACES } = require("./constants");
const { FINGERPRINT_PATTERN, computeFingerprint } = require("./fingerprint");
const { isNormalized } = require("./normalize-rules");
const { renderIssueBody } = require("./render");
const { FORBIDDEN_FIELDS, buildEnvelope, findForbiddenFields, validateEnvelope } = require("./triage");
const { RFC3339_UTC_PATTERN, computeWindow } = require("./window");

const GENERATED_AT = "2026-08-07T00:05:12Z";
const WINDOW = computeWindow({ now: GENERATED_AT });
const QUERY = { estimatedBytes: 78412345, maxBytesBilled: 200000000, totalRows: 1204 };

const build = (overrides = {}) =>
	buildEnvelope({ rows, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY, ...overrides });

describe("契約 §7 のエンベロープ形状", () => {
	const { envelope } = build();

	it("トップレベルのキーが契約どおり", () => {
		expect(Object.keys(envelope).sort()).toEqual(
			["fpAlgoVersion", "generatedAt", "groups", "query", "runSummary", "schemaVersion", "window"].sort(),
		);
	});

	it('schemaVersion は数値 1（G7: `"error-triage/v1"` ではない）', () => {
		expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
		expect(typeof envelope.schemaVersion).toBe("number");
	});

	it("fpAlgoVersion は JS 定数（矛盾B: SQL 出力には入れない）", () => {
		expect(envelope.fpAlgoVersion).toBe(FP_ALGO_VERSION);
	});

	it("generatedAt / window は RFC3339 UTC", () => {
		expect(envelope.generatedAt).toMatch(RFC3339_UTC_PATTERN);
		expect(envelope.window.startUtc).toMatch(RFC3339_UTC_PATTERN);
		expect(envelope.window.endUtc).toMatch(RFC3339_UTC_PATTERN);
	});

	it("命名は全レイヤ camelCase（snake_case を混ぜない = 変換レイヤを作らない）", () => {
		const keys = new Set();
		const walk = (node) => {
			if (Array.isArray(node)) return node.forEach(walk);
			if (node && typeof node === "object") {
				for (const [key, value] of Object.entries(node)) {
					keys.add(key);
					walk(value);
				}
			}
		};
		walk(envelope);
		expect([...keys].filter((key) => key.includes("_"))).toEqual([]);
	});

	it("groupKey は契約の10フィールドを常に持つ（surface により null）", () => {
		for (const group of envelope.groups) {
			expect(Object.keys(group.groupKey).sort()).toEqual(
				[
					"apiName",
					"endpoint",
					"errorCode",
					"eventName",
					"functionName",
					"httpStatus",
					"method",
					"pathName",
					"route",
					"statusCode",
				].sort(),
			);
		}
	});

	it("hourlyCounts は最大 lookbackHours 要素（dailyCounts ではない = 矛盾B / S5）", () => {
		for (const group of envelope.groups) {
			expect(Array.isArray(group.hourlyCounts)).toBe(true);
			expect(group.hourlyCounts.length).toBeLessThanOrEqual(WINDOW.lookbackHours);
			for (const bucket of group.hourlyCounts) {
				expect(bucket.hourUtc).toMatch(RFC3339_UTC_PATTERN);
				expect(typeof bucket.count).toBe("number");
			}
		}
		expect(envelope.groups.some((group) => "dailyCounts" in group)).toBe(false);
	});

	it("anonymousOccurrences が契約に含まれる（S4）", () => {
		for (const group of envelope.groups) {
			expect(typeof group.anonymousOccurrences).toBe("number");
		}
	});
});

describe("不変条件 1: groups[] の要素は SQL の1出力行と 1:1（JS 側で再グルーピングしない）", () => {
	it("行数と要素数が一致する", () => {
		expect(build().envelope.groups).toHaveLength(rows.length);
	});

	it("fingerprint が重複していてもマージしない", () => {
		const duplicated = [rows[0], { ...rows[0] }, { ...rows[0] }];
		const { envelope } = build({ rows: duplicated });
		expect(envelope.groups).toHaveLength(3);
		expect(new Set(envelope.groups.map((group) => group.fingerprint)).size).toBe(1);
	});

	it("マージすると affectedUsers が occurrences に漸近するので、そもそも合算関数を公開しない（B1）", () => {
		const api = require("./triage");
		for (const name of Object.keys(api)) {
			expect(name).not.toMatch(/merge|regroup|sumGroups/i);
		}
	});
});

describe("不変条件 2: affectedUsers / occurrences を run をまたいで合算してはならない（G6）", () => {
	const { envelope } = build();
	const group = envelope.groups[0];

	it("Issue 本文には今回の窓の値だけが載る", () => {
		const previousBody = renderIssueBody({
			group: { ...group, occurrences: 9000, affectedUsers: 900 },
			window: WINDOW,
			generatedAt: "2026-08-06T00:05:12Z",
		});
		const currentBody = renderIssueBody({
			group,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: previousBody,
		});
		expect(currentBody).toContain(`**${group.occurrences} 件**`);
		expect(currentBody).not.toContain("9000");
		expect(currentBody).not.toContain(String(9000 + group.occurrences));
	});

	it("窓は run 間で 1h 重複することが本文に明記されている", () => {
		const body = renderIssueBody({ group, window: WINDOW, generatedAt: GENERATED_AT });
		expect(body).toContain("run をまたいで合算されません");
	});
});

describe("不変条件 3: messagePattern / route / endpoint / pathName は全て正規化後の値", () => {
	const { envelope } = build();

	it("fixture の全グループが正規化済み", () => {
		for (const group of envelope.groups) {
			expect(isNormalized(group.messagePattern)).toBe(true);
			expect(isNormalized(group.groupKey.route)).toBe(true);
			expect(isNormalized(group.groupKey.endpoint)).toBe(true);
			expect(isNormalized(group.groupKey.pathName)).toBe(true);
		}
	});

	it("生値が混ざったら validateEnvelope が落とす", () => {
		for (const [field, path] of [
			["messagePattern", null],
			["route", "groupKey"],
			["endpoint", "groupKey"],
			["pathName", "groupKey"],
		]) {
			const dirty = build().envelope;
			const target = path ? dirty.groups[0][path] : dirty.groups[0];
			target[field] = "/v1/dish-media/9c1e77aa-2b31-41d0-9f2e-77aa2b3141d0/likes?key=AIzaSySECRET";
			const result = validateEnvelope(dirty);
			expect(result.ok).toBe(false);
			expect(result.errors.join("\n")).toContain(field);
		}
	});

	it("URLクエリの秘密値が契約に現れない", () => {
		expect(JSON.stringify(envelope)).not.toMatch(/AIzaSy/);
	});

	// ★ B-1（PR #1200 レビュー）: 正規化は SQL 側で行うので、SQL が吐いた値をそのまま
	//   isNormalized() に掛ける。ルールが RE2 と JS で割れていると、SQL 側で正しく畳まれた値を
	//   JS 側が「未正規化」と誤判定し、全角スペースが1つあるだけで run 全体が invalid になる。
	it("SQL 側で畳まれた全角スペース入りの値を「未正規化」と誤判定しない", () => {
		const fromSql = 'Validation failed: name="すし 太郎" is too long';
		expect(isNormalized(fromSql)).toBe(true);

		const dirty = build().envelope;
		dirty.groups[0].messagePattern = fromSql;
		expect(validateEnvelope(dirty).ok).toBe(true);
	});

	it("畳まれていない全角スペースが混ざったら validateEnvelope が落とす", () => {
		const dirty = build().envelope;
		dirty.groups[0].messagePattern = 'Validation failed: name="すし\u3000太郎" is too long';
		const result = validateEnvelope(dirty);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toContain("messagePattern");
	});
});

describe("不変条件 4: user_id の値・payload 各種・緯度経度・検索クエリが出力に存在しない", () => {
	it("禁止フィールドの一覧が定義されている", () => {
		for (const field of ["userId", "user_id", "payload", "requestPayload", "responsePayload", "lat", "lng", "query"]) {
			expect(FORBIDDEN_FIELDS).toContain(field);
		}
	});

	it("SQL が禁止フィールドを出しても許可リスト射影で落ちる", () => {
		const { envelope } = build({
			rows: [
				{
					...rows[0],
					user_id: "e0a5f2c8-1111-2222-3333-444455556666",
					requestPayload: { query: "ラーメン" },
					lat: 35.6812,
					lng: 139.7671,
				},
			],
		});
		expect(findForbiddenFields(envelope.groups, "$.groups")).toEqual([]);
		expect(validateEnvelope(envelope).ok).toBe(true);
	});

	it("それでも混入したら validateEnvelope が検出する（射影を迂回した場合の最後の砦）", () => {
		const { envelope } = build();
		envelope.groups[0].userId = "e0a5f2c8-1111-2222-3333-444455556666";
		const result = validateEnvelope(envelope);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toMatch(/不変条件 4/);
	});

	it("エンベロープ直下の query（BigQuery の見積り情報）は誤検出しない", () => {
		const { envelope } = build();
		expect(envelope.query.estimatedBytes).toBe(78412345);
		expect(validateEnvelope(envelope).ok).toBe(true);
	});
});

describe("不変条件 5: fingerprint は groupKey と messagePattern のみから決まる純関数", () => {
	const mutable = {
		occurrences: 99999,
		affectedUsers: 12345,
		anonymousOccurrences: 777,
		firstSeenUtc: "2020-01-01T00:00:00Z",
		lastSeenUtc: "2030-01-01T00:00:00Z",
		hourlyCounts: [{ hourUtc: "2030-01-01T00:00:00Z", count: 1 }],
		commits: [{ sha: "ffffffffffff", count: 1 }],
		appVersions: ["9.9.9"],
		representativeCommit: "ffffffffffff",
	};

	it.each(rows.map((row) => [row.surface, row]))("%s: 可変値を変えても fingerprint は変わらない", (_surface, row) => {
		expect(computeFingerprint({ ...row, ...mutable })).toBe(computeFingerprint(row));
	});

	it("常に 12桁小文字hex", () => {
		for (const group of build().envelope.groups) {
			expect(group.fingerprint).toMatch(FINGERPRINT_PATTERN);
		}
	});

	it("groupKey を変えれば必ず変わる（surface ごとのキー集合の範囲で）", () => {
		const backend = rows.find((row) => row.surface === "backend");
		for (const field of ["functionName", "eventName", "httpStatus", "route"]) {
			const mutated = { ...backend, groupKey: { ...backend.groupKey, [field]: "CHANGED" } };
			expect(computeFingerprint(mutated)).not.toBe(computeFingerprint(backend));
		}
	});
});

describe("不変条件 6: surface が既知3値以外なら、その要素は破棄して警告", () => {
	it("既知の3値", () => {
		expect(SURFACES).toEqual(["frontend", "backend", "external"]);
	});

	it.each([["mobile"], [null], [undefined], [""], ["Frontend"]])("surface=%p は破棄して警告する", (surface) => {
		const { envelope, warnings } = build({ rows: [...rows, { ...rows[0], surface }] });
		expect(envelope.groups).toHaveLength(rows.length);
		expect(warnings).toHaveLength(1);
	});

	it("破棄せず素通しした場合は validateEnvelope が落とす", () => {
		const { envelope } = build();
		envelope.groups.push({ ...envelope.groups[0], surface: "mobile" });
		expect(validateEnvelope(envelope).ok).toBe(false);
	});
});
