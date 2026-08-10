// #1196 error-triage / エントリポイント（`plan` / `apply` サブコマンド）のテスト。
//
// 実時刻・BigQuery・GitHub には触りません。clock と fetch を注入し、
// 出力（Job Summary / plan.json）を一時ディレクトリへ書かせて検証します。

"use strict";

const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { MAX_BYTES_BILLED, GROUP_LIMIT, FP_ALGO_VERSION } = require("./constants");
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
		pathName: "/search",
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
	// fpalgo 2: pathName から剥がしたロケールの内訳（SQL が出す）
	localeCounts: [
		{ locale: "ja-JP", count: 7 },
		{ locale: "en-US", count: 5 },
	],
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
		expect(summary).toContain("Error Triage — dry-run");
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
		writeFileSync(
			tamperedPath,
			generateErrorTriageSql().replace(`-- fpalgo: ${FP_ALGO_VERSION}`, "-- fpalgo: 99"),
			"utf8",
		);
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

describe("サブコマンドの入口", () => {
	test("apply は GITHUB_TOKEN / GITHUB_REPOSITORY が無ければ BigQuery を叩く前に落ちる", async () => {
		const fetchImpl = makeFetch();
		await expect(main({ argv: ["apply"], env: {}, clock, fetchImpl })).rejects.toThrow(/GITHUB_TOKEN/);
		expect(fetchImpl.calls).toHaveLength(0);
	});

	test("未知のサブコマンドは使い方を出して終了コード 2", async () => {
		expect(await main({ argv: [], env: {}, clock, fetchImpl: makeFetch() })).toBe(2);
		expect(await main({ argv: ["triage"], env: {}, clock, fetchImpl: makeFetch() })).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// apply（triage Job）
// ---------------------------------------------------------------------------

const existingIssues = require("./__fixtures__/existing-issues.json");
const { PARENT_ISSUE_NUMBER, TRIAGE_LABEL } = require("./constants");

/**
 * BigQuery と GitHub の両方を1つの fetch で捌く（実際の Job も同じ Node プロセス1本で動く）。
 * BigQuery へは PLAN と同じ2レスポンス、GitHub へは最小限の偽サーバ。
 */
const makeApplyFetch = ({ issues = existingIssues, subIssues = [] } = {}) => {
	const calls = [];
	const state = { issues: JSON.parse(JSON.stringify(issues)), subIssues: [...subIssues], comments: {}, next: 6000 };
	const bqResponses = [
		{ totalBytesProcessed: "665800" },
		{ jobComplete: true, totalRows: "2", totalBytesProcessed: "665800", rows: [row(GROUP), row(RUN_SUMMARY)] },
	];
	let bqIndex = 0;

	const fetchImpl = async (rawUrl, init = {}) => {
		const method = (init.method || "GET").toUpperCase();
		const body = init.body ? JSON.parse(init.body) : null;
		calls.push({ url: rawUrl, method, body });

		if (rawUrl.startsWith("https://bigquery.googleapis.com")) {
			const payload = bqResponses[bqIndex];
			bqIndex += 1;
			return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
		}

		const url = new URL(rawUrl);
		const path = url.pathname.replace("/repos/Ayato-kosaka/nanitabeyo", "");
		const json = (status, value) => ({
			ok: status < 300,
			status,
			text: async () => JSON.stringify(value),
		});

		if (method === "GET" && path === "/issues") {
			const page = Number(url.searchParams.get("page") || "1");
			return json(200, page === 1 ? state.issues : []);
		}
		if (method === "POST" && path === "/issues") {
			state.next += 1;
			const created = {
				number: state.next,
				id: 9000000 + state.next,
				labels: body.labels.map((name) => ({ name })),
				body: body.body,
				state: "open",
			};
			state.issues.push(created);
			return json(201, created);
		}
		if (method === "GET" && /\/sub_issues$/.test(path)) return json(200, state.subIssues);
		if (method === "POST" && /\/sub_issues$/.test(path)) return json(201, {});
		if (method === "GET" && /\/comments$/.test(path)) return json(200, []);
		if (method === "POST" && /\/comments$/.test(path)) return json(201, { id: 1 });
		if (method === "PATCH") return json(200, {});
		if (method === "GET" && path.startsWith("/commits/")) return json(404, { message: "Not Found" });
		return json(404, { message: `unhandled ${method} ${path}` });
	};
	fetchImpl.calls = calls;
	fetchImpl.state = state;
	fetchImpl.githubWrites = () => calls.filter((call) => call.method !== "GET" && !call.url.includes("bigquery"));
	return fetchImpl;
};

const APPLY_ENV = {
	GCP_PROJECT_ID: "food-scroll",
	BQ_ACCESS_TOKEN: "bq-token",
	GITHUB_TOKEN: "gh-token",
	GITHUB_REPOSITORY: "Ayato-kosaka/nanitabeyo",
	GITHUB_API_URL: "https://api.github.test",
	GITHUB_SERVER_URL: "https://github.test",
	GITHUB_RUN_ID: "31215551992",
};

describe("apply（triage Job）", () => {
	test("BigQuery → 索引 → 起票 → 常駐サマリまで通し、終了コード 0", async () => {
		const workspace = makeWorkspace();
		writeFileSync(workspace.summaryPath, "", "utf8");
		const fetchImpl = makeApplyFetch();

		const code = await main({
			argv: ["apply", "--out", workspace.planPath],
			env: { ...APPLY_ENV, GITHUB_STEP_SUMMARY: workspace.summaryPath },
			clock,
			fetchImpl,
			sleepImpl: async () => {},
		});

		expect(code).toBe(0);
		const summary = readFileSync(workspace.summaryPath, "utf8");
		expect(summary).toContain("Error Triage — apply");
		expect(summary).toContain("適用結果（apply）");

		const out = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		expect(out.applyResult.created).toHaveLength(1);
		expect(out.applyResult.parentSummary).toBe("created");

		// 起票 POST の body に run へのリンクが入る（Issue から run を辿れる）
		const post = fetchImpl.calls.find((call) => call.method === "POST" && call.url.endsWith("/issues"));
		expect(post.body.labels).toEqual([TRIAGE_LABEL]);
		expect(post.body.body).toContain("https://github.test/Ayato-kosaka/nanitabeyo/actions/runs/31215551992");
		expect(post.body.body).toContain(`親: #${PARENT_ISSUE_NUMBER}`);
	});

	test("--dry-run は GitHub へ1バイトも書かない", async () => {
		const fetchImpl = makeApplyFetch();
		const code = await main({
			argv: ["apply", "--dry-run"],
			env: APPLY_ENV,
			clock,
			fetchImpl,
			sleepImpl: async () => {},
		});
		expect(code).toBe(0);
		expect(fetchImpl.githubWrites()).toHaveLength(0);
	});

	test("既に起票済みなら2回目は何も起票しない（冪等）", async () => {
		const fetchImpl = makeApplyFetch();
		await main({ argv: ["apply"], env: APPLY_ENV, clock, fetchImpl, sleepImpl: async () => {} });
		const afterFirst = fetchImpl.calls.filter((call) => call.method === "POST" && call.url.endsWith("/issues")).length;

		// 2回目は BigQuery のレスポンスを使い切っているので、新しい fetch へ state を引き継ぐ
		const second = makeApplyFetch({ issues: fetchImpl.state.issues });
		await main({ argv: ["apply"], env: APPLY_ENV, clock, fetchImpl: second, sleepImpl: async () => {} });

		expect(afterFirst).toBe(1);
		expect(second.calls.filter((call) => call.method === "POST" && call.url.endsWith("/issues"))).toHaveLength(0);
	});

	test("GITHUB_TOKEN が無ければ BigQuery を叩く前に落ちる（権限不足で走り始めない）", async () => {
		const fetchImpl = makeApplyFetch();
		await expect(
			main({ argv: ["apply"], env: { ...APPLY_ENV, GITHUB_TOKEN: undefined }, clock, fetchImpl }),
		).rejects.toThrow(/GITHUB_TOKEN/);
		expect(fetchImpl.calls).toHaveLength(0);
	});

	test("runUrlFrom は run_id が無ければ null", () => {
		const { runUrlFrom } = require("./main");
		expect(runUrlFrom({})).toBeNull();
		expect(runUrlFrom({ GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" })).toBe("https://github.com/o/r/actions/runs/1");
	});
});

// ---------------------------------------------------------------------------
// L-3（PR #1211 レビュー）: PANIC / 契約違反のときの「記録だけは残す」
// ---------------------------------------------------------------------------
//
// Phase 3 のガードには2種類あり、書き込みの止め方が違う:
//   - abort（fpalgo 不一致）  : 状態機械そのものが壊れている → **1バイトも書かない**
//   - panic / 契約違反        : 起票・reopen・body 更新はしないが、
//                              **何が起きたかは親の常駐サマリへ残す**（Job Summary は 90 日で消える。G5）
// 一番あとから振り返りたい run の記録だけが消える、という状態にしない。

/** BigQuery のレスポンスを差し替えられる apply 用 fetch（PANIC / 契約違反の再現に使う）。 */
const makeApplyFetchWithRows = ({ bqRows, issues = existingIssues }) => {
	const fetchImpl = makeApplyFetch({ issues });
	const original = fetchImpl;
	const wrapped = async (rawUrl, init = {}) => {
		if (rawUrl.startsWith("https://bigquery.googleapis.com") && wrapped.bqCalls > 0) {
			wrapped.bqCalls += 1;
			return {
				ok: true,
				status: 200,
				text: async () =>
					JSON.stringify({
						jobComplete: true,
						totalRows: String(bqRows.length),
						totalBytesProcessed: "665800",
						rows: bqRows.map(row),
					}),
			};
		}
		if (rawUrl.startsWith("https://bigquery.googleapis.com")) {
			wrapped.bqCalls += 1;
			return { ok: true, status: 200, text: async () => JSON.stringify({ totalBytesProcessed: "665800" }) };
		}
		return original(rawUrl, init);
	};
	wrapped.bqCalls = 0;
	wrapped.calls = original.calls;
	wrapped.state = original.state;
	wrapped.githubWrites = original.githubWrites;
	return wrapped;
};

/**
 * PANIC 閾値（50）を超える 60 グループ。pathName を変えれば fingerprint が変わる。
 * pathName は**先頭ロケールを剥がした形**にする（fpalgo 2。ロケール付きだと不変条件違反になる）。
 * 数字を混ぜると不変条件 3（正規化済みであること）に引っかかって「契約違反」になってしまうので、
 * **英字だけ**で散らして「PANIC だけが起きている」状態にする。
 */
const panicRows = () => [
	...Array.from({ length: 60 }, (_, index) => ({
		...GROUP,
		groupKey: {
			...GROUP.groupKey,
			pathName: `/search/${"abcdefghij"[Math.floor(index / 10)]}${"abcdefghij"[index % 10]}`,
		},
	})),
	{ ...RUN_SUMMARY, groupCount: 60 },
];

describe("L-3: PANIC / 契約違反でも親の常駐サマリは残す", () => {
	test("PANIC: 起票・reopen・body 更新は0件だが、親の常駐サマリだけは書く", async () => {
		const workspace = makeWorkspace();
		const fetchImpl = makeApplyFetchWithRows({ bqRows: panicRows() });

		const code = await main({
			argv: ["apply", "--out", workspace.planPath],
			env: APPLY_ENV,
			clock,
			fetchImpl,
			sleepImpl: async () => {},
		});

		// PANIC は exit 1（成功したように見せない）
		expect(code).toBe(1);
		const out = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		// PANIC だけが起きている（契約違反でも fpalgo 不一致でもない）
		expect(out.plan.panic).toBe(true);
		expect(out.plan.valid).toBe(true);
		expect(out.plan.abort).toBe(false);
		expect(out.applyResult.created).toHaveLength(0);
		expect(out.applyResult.reopened).toHaveLength(0);
		expect(out.applyResult.bodyUpdated).toHaveLength(0);

		// 起票・reopen・body 更新の書き込みは1本も出ていない
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.url.endsWith("/issues"))).toBe(false);
		expect(fetchImpl.calls.some((call) => call.method === "PATCH")).toBe(false);

		// 親の常駐サマリだけは残る（90日で消える Job Summary の代わり）
		expect(out.applyResult.parentSummary).toBe("created");
		const summaryPost = fetchImpl.calls.find(
			(call) => call.method === "POST" && call.url.endsWith(`/issues/${PARENT_ISSUE_NUMBER}/comments`),
		);
		expect(summaryPost).toBeDefined();
		expect(summaryPost.body.body).toContain("PANIC");
		expect(summaryPost.body.body).toContain("起票・reopen・body 更新を1件も行っていません");
		// 計画値を「書いた」ように見せない
		expect(summaryPost.body.body).toContain("この run では書き込みを止めました");
	});

	test("PANIC でも --dry-run なら1バイトも書かない（preview Job は issues: read しか持たない）", async () => {
		const fetchImpl = makeApplyFetchWithRows({ bqRows: panicRows() });
		const code = await main({
			argv: ["apply", "--dry-run"],
			env: APPLY_ENV,
			clock,
			fetchImpl,
			sleepImpl: async () => {},
		});
		expect(code).toBe(1);
		expect(fetchImpl.githubWrites()).toHaveLength(0);
	});

	test("契約違反（不変条件を満たさない envelope）でも親の常駐サマリは残す", async () => {
		const workspace = makeWorkspace();
		// messagePattern が正規化されていない（生の数値が残っている）＝不変条件 4 違反
		const fetchImpl = makeApplyFetchWithRows({
			bqRows: [{ ...GROUP, messagePattern: "user 12345 not found" }, RUN_SUMMARY],
		});

		const code = await main({
			argv: ["apply", "--out", workspace.planPath],
			env: APPLY_ENV,
			clock,
			fetchImpl,
			sleepImpl: async () => {},
		});

		expect(code).toBe(1);
		const out = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		expect(out.plan.valid).toBe(false);
		// Phase 4 は dry-run へ落ちる（計画上は create 1 件でも、POST は1本も出ない）
		expect(out.applyResult.dryRun).toBe(true);
		expect(out.applyResult.created.every((entry) => entry.issueNumber === null)).toBe(true);
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.url.endsWith("/issues"))).toBe(false);
		expect(fetchImpl.calls.some((call) => call.method === "PATCH")).toBe(false);

		expect(out.applyResult.parentSummary).toBe("created");
		const summaryPost = fetchImpl.calls.find(
			(call) => call.method === "POST" && call.url.endsWith(`/issues/${PARENT_ISSUE_NUMBER}/comments`),
		);
		expect(summaryPost.body.body).toContain("契約違反");
	});

	test("abort（fpalgo 不一致）は親の常駐サマリも書かない（1バイトも書かない）", async () => {
		// 既存 Issue の fpalgo が現行と違う ＝ 状態機械が壊れている
		const tampered = existingIssues.map((issue) =>
			String(issue.body).includes("fpalgo:2")
				? { ...issue, body: String(issue.body).replace("fpalgo:2", "fpalgo:99") }
				: issue,
		);
		const workspace = makeWorkspace();
		const fetchImpl = makeApplyFetch({ issues: tampered });

		const code = await main({
			argv: ["apply", "--out", workspace.planPath],
			env: APPLY_ENV,
			clock,
			fetchImpl,
			sleepImpl: async () => {},
		});

		expect(code).toBe(1);
		const out = JSON.parse(readFileSync(workspace.planPath, "utf8"));
		expect(out.plan.abort).toBe(true);
		expect(out.applyResult.aborted).toBe(true);
		expect(out.applyResult.parentSummary).toBeNull();
		expect(fetchImpl.githubWrites()).toHaveLength(0);
	});
});
