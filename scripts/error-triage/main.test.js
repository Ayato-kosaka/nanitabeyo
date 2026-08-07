// #1196 error-triage / エントリポイント（`plan` サブコマンド）のテスト。
//
// 実時刻・BigQuery・GitHub には触りません。clock と fetch を注入し、
// 出力（Job Summary / plan.json）を一時ディレクトリへ書かせて検証します。

"use strict";

const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { MAX_BYTES_BILLED, GROUP_LIMIT } = require("./constants");
const { DEFAULT_SQL_PATH, main, parseArgs, requireEnv } = require("./main");
const { generateErrorTriageSql } = require("./sql-generator");

const FIXED_NOW = "2026-08-07T00:05:12Z";
const clock = () => new Date(FIXED_NOW);

const row = (value) => ({ f: [{ v: JSON.stringify(value) }] });

const GROUP = {
	kind: "group",
	surface: "frontend",
	groupKey: {
		eventName: "api_call_error",
		pathName: "/ja/search",
		functionName: null,
		apiName: null,
		endpoint: null,
		method: null,
		statusCode: null,
		httpStatus: 500,
		route: "/v<n>/dishes?",
		errorCode: null,
	},
	messagePattern: "API call to /v<n>/dishes failed with status <n>",
	occurrences: 12,
	affectedUsers: 3,
	anonymousOccurrences: 0,
	firstSeenUtc: "2026-08-06T01:00:00Z",
	lastSeenUtc: "2026-08-06T22:00:00Z",
	hourlyCounts: [{ hourUtc: "2026-08-06T01:00:00Z", count: 12 }],
	commits: [{ sha: "abc123def456", count: 12 }],
	appVersions: ["1.4.2"],
	representativeCommit: "abc123def456",
};

const RUN_SUMMARY = {
	kind: "run_summary",
	groupCount: 1,
	groupLimit: GROUP_LIMIT,
	keptRows: 12,
	excludedRows: 40,
	excludedBreakdown: [{ reason: "transient_status", eventName: "api_call_error", httpStatus: 429, count: 40 }],
};

const makeFetch = () => {
	const calls = [];
	const responses = [
		{ totalBytesProcessed: "665800" },
		{ jobComplete: true, totalRows: "2", totalBytesProcessed: "665800", rows: [row(GROUP), row(RUN_SUMMARY)] },
	];
	const fetchImpl = async (url, init) => {
		calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
		return { ok: true, status: 200, text: async () => JSON.stringify(responses[calls.length - 1]) };
	};
	fetchImpl.calls = calls;
	return fetchImpl;
};

const makeWorkspace = () => {
	const dir = mkdtempSync(join(tmpdir(), "error-triage-test-"));
	return {
		dir,
		summaryPath: join(dir, "summary.md"),
		planPath: join(dir, "plan.json"),
	};
};

describe("argv の読み取り", () => {
	test("サブコマンドと --key value を読む", () => {
		expect(parseArgs(["plan", "--lookback-hours", "25", "--out", "/tmp/plan.json"])).toEqual({
			command: "plan",
			options: { "lookback-hours": "25", out: "/tmp/plan.json" },
		});
	});

	test("値の無いフラグは true 扱い", () => {
		expect(parseArgs(["plan", "--verbose"]).options).toEqual({ verbose: "true" });
	});

	test("必須の環境変数が無ければ落ちる", () => {
		expect(() => requireEnv({}, ["GCP_PROJECT_ID", "GCP_PROJECT"])).toThrow(/GCP_PROJECT_ID/);
		expect(requireEnv({ GCP_PROJECT: "food-scroll" }, ["GCP_PROJECT_ID", "GCP_PROJECT"])).toBe("food-scroll");
	});
});

describe("plan（dry-run）", () => {
	test("Job Summary と plan.json を書き、終了コード 0 を返す", async () => {
		const workspace = makeWorkspace();
		writeFileSync(workspace.summaryPath, "", "utf8");
		const fetchImpl = makeFetch();

		const code = await main({
			argv: ["plan", "--out", workspace.planPath],
			env: {
				GCP_PROJECT_ID: "food-scroll",
				BQ_ACCESS_TOKEN: "dummy-token",
				GITHUB_STEP_SUMMARY: workspace.summaryPath,
			},
			clock,
			fetchImpl,
		});

		expect(code).toBe(0);

		const summary = readFileSync(workspace.summaryPath, "utf8");
		expect(summary).toContain("Error Triage — dry-run (PR2)");
		expect(summary).toContain("2026-08-05T23:00:00Z");
		expect(summary).toContain("2026-08-07T00:00:00Z");
		expect(summary).toContain("既存 Issue は読んでいません");
		expect(summary).toContain("issues: read");

		const plan = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		expect(plan.envelope.groups).toHaveLength(1);
		expect(plan.envelope.groups[0].fingerprint).toMatch(/^[0-9a-f]{12}$/);
		expect(plan.plan.valid).toBe(true);
		// PR2 は既存 Issue を読まないので、全グループが未知 = create 候補になる
		expect(plan.plan.counts.create).toBe(1);
	});

	test("窓は run 開始時刻を時単位で切り捨てて 25h 遡る（B5 / G1）", async () => {
		const workspace = makeWorkspace();
		const fetchImpl = makeFetch();
		await main({
			argv: ["plan", "--out", workspace.planPath],
			env: { GCP_PROJECT_ID: "food-scroll", BQ_ACCESS_TOKEN: "t" },
			clock,
			fetchImpl,
		});
		const plan = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		expect(plan.envelope.window).toEqual({
			startUtc: "2026-08-05T23:00:00Z",
			endUtc: "2026-08-07T00:00:00Z",
			lookbackHours: 25,
		});
		expect(fetchImpl.calls[1].body.query).toContain("TIMESTAMP '2026-08-05 23:00:00+00'");
	});

	test("--lookback-hours を渡すと窓が変わる", async () => {
		const workspace = makeWorkspace();
		await main({
			argv: ["plan", "--lookback-hours", "3", "--out", workspace.planPath],
			env: { GCP_PROJECT_ID: "food-scroll", BQ_ACCESS_TOKEN: "t" },
			clock,
			fetchImpl: makeFetch(),
		});
		const plan = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		expect(plan.envelope.window.lookbackHours).toBe(3);
		expect(plan.envelope.window.startUtc).toBe("2026-08-06T21:00:00Z");
	});

	test("同じ入力で2回叩くとバイト単位で同じ plan になる（S12: clock を注入している）", async () => {
		const first = makeWorkspace();
		const second = makeWorkspace();
		for (const workspace of [first, second]) {
			await main({
				argv: ["plan", "--out", workspace.planPath],
				env: { GCP_PROJECT_ID: "food-scroll", BQ_ACCESS_TOKEN: "t" },
				clock,
				fetchImpl: makeFetch(),
			});
		}
		expect(readFileSync(first.planPath, "utf8")).toBe(readFileSync(second.planPath, "utf8"));
	});

	test("既定の SQL はリポジトリの生成物で、fpalgo マーカーを持つ", () => {
		expect(readFileSync(DEFAULT_SQL_PATH, "utf8")).toBe(generateErrorTriageSql());
	});

	test("SQL の fpalgo が JS と食い違っていたら BigQuery を叩く前に落ちる", async () => {
		const workspace = makeWorkspace();
		const tamperedPath = join(workspace.dir, "tampered.sql");
		writeFileSync(tamperedPath, generateErrorTriageSql().replace("-- fpalgo: 1", "-- fpalgo: 9"), "utf8");
		const fetchImpl = makeFetch();

		await expect(
			main({
				argv: ["plan", "--sql", tamperedPath],
				env: { GCP_PROJECT_ID: "food-scroll", BQ_ACCESS_TOKEN: "t" },
				clock,
				fetchImpl,
			}),
		).rejects.toThrow(/fpalgo 不一致/);
		expect(fetchImpl.calls).toHaveLength(0);
	});

	test("query の見積りが Job Summary に残る（じわじわ増えるのに気づくため）", async () => {
		const workspace = makeWorkspace();
		writeFileSync(workspace.summaryPath, "", "utf8");
		await main({
			argv: ["plan"],
			env: { GCP_PROJECT_ID: "food-scroll", BQ_ACCESS_TOKEN: "t", GITHUB_STEP_SUMMARY: workspace.summaryPath },
			clock,
			fetchImpl: makeFetch(),
		});
		const summary = readFileSync(workspace.summaryPath, "utf8");
		expect(summary).toContain("665,800 bytes");
		expect(summary).toContain(MAX_BYTES_BILLED.toLocaleString("en-US"));
	});
});

describe("PR2 の範囲外は明示的に断る", () => {
	test("apply は PR3 の範囲として終了コード 2", async () => {
		const code = await main({ argv: ["apply"], env: {}, clock, fetchImpl: makeFetch() });
		expect(code).toBe(2);
	});

	test("未知のサブコマンドは使い方を出して終了コード 2", async () => {
		expect(await main({ argv: [], env: {}, clock, fetchImpl: makeFetch() })).toBe(2);
		expect(await main({ argv: ["triage"], env: {}, clock, fetchImpl: makeFetch() })).toBe(2);
	});
});
