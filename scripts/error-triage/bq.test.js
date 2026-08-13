// #1196 error-triage / BigQuery アクセス層のテスト。
//
// **本番 BigQuery には一切触りません。** `fetch` を差し替えて、
//   - リクエストボディ（特に maximumBytesBilled のバイパス不能性）
//   - コストガード第2層（見積り > 200MB なら本クエリを投げない）
//   - レスポンス → 契約エンベロープ
// を固定します。

"use strict";

const { MAX_BYTES_BILLED, SCHEMA_VERSION, FP_ALGO_VERSION, GROUP_LIMIT } = require("./constants");
const {
	BQ_LOCATION,
	buildQueryRequest,
	checkEstimatedBytes,
	describeApiError,
	estimateQuery,
	fetchTriageEnvelope,
	parseTriageRows,
	renderSql,
	runQuery,
	toSqlTimestampLiteral,
} = require("./bq");
const { generateErrorTriageSql } = require("./sql-generator");
const { computeWindow } = require("./window");

const WINDOW = computeWindow({ now: "2026-08-07T00:05:12Z" });
const GENERATED_AT = "2026-08-07T00:05:12Z";

/** SQL の1行（`{f:[{v: "<JSON文字列>"}]}`）を作る。 */
const row = (value) => ({ f: [{ v: JSON.stringify(value) }] });

const sampleGroup = (overrides = {}) => ({
	kind: "group",
	surface: "backend",
	groupKey: {
		eventName: "UnhandledException",
		pathName: null,
		functionName: "ApiExceptionFilter",
		apiName: null,
		endpoint: null,
		method: null,
		statusCode: null,
		httpStatus: 500,
		route: "/v<n>/dishes/bulk-import?",
		errorCode: null,
	},
	messagePattern: "TypeError: Cannot read properties of undefined",
	occurrences: 142,
	affectedUsers: 37,
	anonymousOccurrences: 12,
	firstSeenUtc: "2026-08-06T00:14:02Z",
	lastSeenUtc: "2026-08-06T23:41:55Z",
	hourlyCounts: [{ hourUtc: "2026-08-06T13:00:00Z", count: 12 }],
	commits: [{ sha: "9f2c1ab4d7e0", count: 130 }],
	appVersions: [],
	representativeCommit: "9f2c1ab4d7e0",
	...overrides,
});

const sampleRunSummary = (overrides = {}) => ({
	kind: "run_summary",
	groupCount: 23,
	groupLimit: GROUP_LIMIT,
	keptRows: 517,
	excludedRows: 4820,
	excludedBreakdown: [{ reason: "expected_client_error", eventName: "HttpException", httpStatus: 404, count: 3011 }],
	...overrides,
});

/**
 * 呼び出しを記録する fetch のふり。
 *
 * @param {Array<{status?:number, body:unknown}>} responses 呼ばれた順に返す
 */
const makeFetch = (responses) => {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
		const next = responses[calls.length - 1];
		if (!next) throw new Error(`想定外の ${calls.length} 回目の呼び出し: ${url}`);
		return {
			ok: (next.status || 200) < 400,
			status: next.status || 200,
			text: async () => JSON.stringify(next.body),
		};
	};
	fetchImpl.calls = calls;
	return fetchImpl;
};

describe("窓のリテラル埋め込み（テンプレート変数は2つだけ）", () => {
	test("RFC3339 UTC を GoogleSQL の TIMESTAMP リテラルへ変換する", () => {
		expect(toSqlTimestampLiteral("2026-08-05T23:00:00Z")).toBe("2026-08-05 23:00:00+00");
	});

	test.each([
		"2026-08-05T23:00:00+09:00",
		"2026-08-05 23:00:00Z",
		"2026-08-05T23:00:00.123Z",
		"2026-08-05",
		"'; DROP TABLE x; --",
		"",
		null,
	])("書式が違う値は落とす: %p", (value) => {
		expect(() => toSqlTimestampLiteral(value)).toThrow(TypeError);
	});

	test("生成物の SQL テンプレートへ窓を埋め込める", () => {
		const sql = renderSql(generateErrorTriageSql(), WINDOW);
		expect(sql).toContain("timestamp >= TIMESTAMP '2026-08-05 23:00:00+00'");
		expect(sql).toContain("timestamp <  TIMESTAMP '2026-08-07 00:00:00+00'");
		expect(sql).not.toContain("{{");
	});

	test("窓のプレースホルダが無いテンプレートは落とす（全期間スキャンになる）", () => {
		expect(() => renderSql("SELECT 1", WINDOW)).toThrow(/WINDOW_START/);
	});

	test("置換後に別のテンプレート変数が残っていたら落とす", () => {
		const template = "{{WINDOW_START}} {{WINDOW_END}} {{DATASET}}";
		expect(() => renderSql(template, WINDOW)).toThrow(/未置換のテンプレート変数/);
	});
});

describe("コストガード第1層: maximumBytesBilled はバイパスできない", () => {
	test("常に定数が載る", () => {
		expect(buildQueryRequest({ sql: "SELECT 1" }).maximumBytesBilled).toBe(String(MAX_BYTES_BILLED));
	});

	test("引数で別の値を渡しても無視する（上限が可変なら上限ではない）", () => {
		const request = buildQueryRequest({ sql: "SELECT 1", maximumBytesBilled: "999999999999" });
		expect(request.maximumBytesBilled).toBe(String(MAX_BYTES_BILLED));
	});

	test.each([undefined, null, 0, "0", Number.MAX_SAFE_INTEGER, { evil: true }])(
		"maximumBytesBilled=%p を渡しても定数のまま",
		(value) => {
			expect(buildQueryRequest({ sql: "SELECT 1", maximumBytesBilled: value }).maximumBytesBilled).toBe(
				String(MAX_BYTES_BILLED),
			);
		},
	);

	test("dryRun は真偽値で載り、legacy SQL は使わない", () => {
		expect(buildQueryRequest({ sql: "SELECT 1", dryRun: true }).dryRun).toBe(true);
		expect(buildQueryRequest({ sql: "SELECT 1" }).dryRun).toBe(false);
		expect(buildQueryRequest({ sql: "SELECT 1" }).useLegacySql).toBe(false);
	});

	test("location は dataset のリージョン（asia-northeast1）が既定", () => {
		expect(buildQueryRequest({ sql: "SELECT 1" }).location).toBe(BQ_LOCATION);
		expect(BQ_LOCATION).toBe("asia-northeast1");
	});
});

describe("コストガード第2層: 見積りが上限を超えたら本クエリを投げない", () => {
	test("上限ちょうどは通す", () => {
		expect(checkEstimatedBytes(MAX_BYTES_BILLED).ok).toBe(true);
	});

	test("1バイトでも超えたら落とす", () => {
		const result = checkEstimatedBytes(MAX_BYTES_BILLED + 1);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("本クエリは投げません");
	});

	test("BigQuery が返す文字列の INT64 を数値として扱う", () => {
		expect(checkEstimatedBytes("665800")).toEqual({
			ok: true,
			estimatedBytes: 665800,
			maxBytesBilled: MAX_BYTES_BILLED,
			message: null,
		});
	});

	test("見積り超過のとき本クエリの POST が発生しない", async () => {
		const fetchImpl = makeFetch([{ body: { totalBytesProcessed: String(MAX_BYTES_BILLED + 1) } }]);
		await expect(
			fetchTriageEnvelope({
				projectId: "food-scroll",
				accessToken: "dummy-token",
				sqlTemplate: generateErrorTriageSql(),
				window: WINDOW,
				generatedAt: GENERATED_AT,
				fetchImpl,
			}),
		).rejects.toThrow(/上限 .*を超えています/);
		// dry-run の1回だけで止まっている
		expect(fetchImpl.calls).toHaveLength(1);
		expect(fetchImpl.calls[0].body.dryRun).toBe(true);
	});

	test("dry-run のリクエストにも maximumBytesBilled が載る", async () => {
		const fetchImpl = makeFetch([{ body: { totalBytesProcessed: "665800" } }]);
		const result = await estimateQuery({
			projectId: "food-scroll",
			accessToken: "dummy-token",
			sql: "SELECT 1",
			fetchImpl,
		});
		expect(result.estimatedBytes).toBe(665800);
		expect(fetchImpl.calls[0].body.maximumBytesBilled).toBe(String(MAX_BYTES_BILLED));
	});
});

describe("認証とエラー処理", () => {
	test("アクセストークンが無ければ叩く前に落ちる", async () => {
		const fetchImpl = makeFetch([]);
		await expect(estimateQuery({ projectId: "p", accessToken: "", sql: "SELECT 1", fetchImpl })).rejects.toThrow(
			/アクセストークン/,
		);
		expect(fetchImpl.calls).toHaveLength(0);
	});

	test("Bearer トークンを Authorization ヘッダへ載せる", async () => {
		const fetchImpl = makeFetch([{ body: { totalBytesProcessed: "1" } }]);
		await estimateQuery({ projectId: "p", accessToken: "tok", sql: "SELECT 1", fetchImpl });
		expect(fetchImpl.calls[0].init.headers.authorization).toBe("Bearer tok");
	});

	test("エラーメッセージに認証情報を混ぜない", () => {
		const message = describeApiError(403, {
			error: { message: "Access Denied", errors: [{ reason: "accessDenied" }] },
		});
		expect(message).toContain("HTTP 403");
		expect(message).toContain("accessDenied");
		expect(message).not.toContain("Bearer");
	});

	test("HTTP エラーは BigQuery のメッセージ付きで投げ直す", async () => {
		const fetchImpl = makeFetch([
			{ status: 400, body: { error: { message: "Field name error_message does not exist in STRUCT" } } },
		]);
		await expect(estimateQuery({ projectId: "p", accessToken: "tok", sql: "SELECT 1", fetchImpl })).rejects.toThrow(
			/does not exist in STRUCT/,
		);
	});
});

describe("SQL の出力行を仕分ける（1行1JSON は内部表現であって契約ではない）", () => {
	test("group と run_summary を分けて取り出す", () => {
		const parsed = parseTriageRows([row(sampleGroup()), row(sampleRunSummary())]);
		expect(parsed.groups).toHaveLength(1);
		expect(parsed.runSummary.groupCount).toBe(23);
		expect(parsed.warnings).toEqual([]);
	});

	test("壊れた行は捨てて警告する（run 全体は落とさない）", () => {
		const parsed = parseTriageRows([{ f: [{ v: "{not json" }] }, { f: [] }, row({ kind: "unknown" })]);
		expect(parsed.groups).toEqual([]);
		expect(parsed.warnings).toHaveLength(3);
	});

	test("run_summary が2行あったら最初の1件だけ使い、警告する", () => {
		const parsed = parseTriageRows([row(sampleRunSummary({ groupCount: 1 })), row(sampleRunSummary({ groupCount: 2 }))]);
		expect(parsed.runSummary.groupCount).toBe(1);
		expect(parsed.warnings).toHaveLength(1);
	});

	test("空の結果でも落ちない", () => {
		expect(parseTriageRows([])).toEqual({ groups: [], runSummary: null, warnings: [] });
		expect(parseTriageRows(undefined)).toEqual({ groups: [], runSummary: null, warnings: [] });
	});
});

describe("ページング / 非同期完了", () => {
	test("jobComplete が false なら getQueryResults で待つ", async () => {
		const fetchImpl = makeFetch([
			{ body: { jobComplete: false, jobReference: { jobId: "job-1", location: BQ_LOCATION } } },
			{ body: { jobComplete: true, totalRows: "1", rows: [row(sampleRunSummary())] } },
		]);
		const result = await runQuery({ projectId: "p", accessToken: "tok", sql: "SELECT 1", fetchImpl });
		expect(result.rows).toHaveLength(1);
		expect(fetchImpl.calls[1].url).toContain("/queries/job-1?");
		expect(fetchImpl.calls[1].url).toContain(`location=${BQ_LOCATION}`);
	});

	test("pageToken があれば続きを取りに行く", async () => {
		const fetchImpl = makeFetch([
			{
				body: {
					jobComplete: true,
					pageToken: "tk",
					totalRows: "2",
					rows: [row(sampleGroup())],
					jobReference: { jobId: "job-2" },
				},
			},
			{ body: { jobComplete: true, totalRows: "2", rows: [row(sampleRunSummary())] } },
		]);
		const result = await runQuery({ projectId: "p", accessToken: "tok", sql: "SELECT 1", fetchImpl });
		expect(result.rows).toHaveLength(2);
		expect(fetchImpl.calls[1].url).toContain("pageToken=tk");
	});
});

describe("契約エンベロープの組み立て（BigQuery → 契約 §7）", () => {
	const happyFetch = () =>
		makeFetch([
			{ body: { totalBytesProcessed: "665800" } },
			{
				body: {
					jobComplete: true,
					totalRows: "2",
					totalBytesProcessed: "665800",
					cacheHit: false,
					rows: [row(sampleGroup()), row(sampleRunSummary())],
				},
			},
		]);

	test("schemaVersion / fpAlgoVersion / window / query が JS 側から注入される", async () => {
		const { envelope, estimatedBytes } = await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl: happyFetch(),
		});
		expect(envelope.schemaVersion).toBe(SCHEMA_VERSION);
		expect(envelope.fpAlgoVersion).toBe(FP_ALGO_VERSION);
		expect(envelope.generatedAt).toBe(GENERATED_AT);
		expect(envelope.window).toEqual({ ...WINDOW });
		expect(envelope.query).toEqual({ estimatedBytes: 665800, maxBytesBilled: MAX_BYTES_BILLED, totalRows: 2 });
		expect(estimatedBytes).toBe(665800);
	});

	test("SQL の1行が契約の1グループに対応し、fingerprint が載る", async () => {
		const { envelope } = await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl: happyFetch(),
		});
		expect(envelope.groups).toHaveLength(1);
		expect(envelope.groups[0].fingerprint).toMatch(/^[0-9a-f]{12}$/);
		expect(envelope.groups[0].occurrences).toBe(142);
		expect(envelope.groups[0].affectedUsers).toBe(37);
	});

	test("SQL が出した kind は契約へ漏れない（許可リスト射影）", async () => {
		const { envelope } = await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl: happyFetch(),
		});
		expect(envelope.groups[0]).not.toHaveProperty("kind");
	});

	test("runSummary がそのままエンベロープへ載り、truncated が計算される", async () => {
		const fetchImpl = makeFetch([
			{ body: { totalBytesProcessed: "1" } },
			{
				body: {
					jobComplete: true,
					totalRows: "1",
					rows: [row(sampleRunSummary({ groupCount: GROUP_LIMIT + 1 }))],
				},
			},
		]);
		const { envelope } = await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl,
		});
		expect(envelope.runSummary.truncated).toBe(true);
		expect(envelope.runSummary.excludedBreakdown[0]).toEqual({
			reason: "expected_client_error",
			eventName: "HttpException",
			httpStatus: 404,
			count: 3011,
		});
	});

	test("run_summary 行が無くても落ちず、警告になる", async () => {
		const fetchImpl = makeFetch([
			{ body: { totalBytesProcessed: "1" } },
			{ body: { jobComplete: true, totalRows: "1", rows: [row(sampleGroup())] } },
		]);
		const { warnings, envelope } = await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl,
		});
		expect(warnings.some((message) => message.includes("run_summary 行がありません"))).toBe(true);
		expect(envelope.runSummary.groupCount).toBe(1);
	});

	test("未知 surface の行は破棄され、警告になる（契約の不変条件 6）", async () => {
		const fetchImpl = makeFetch([
			{ body: { totalBytesProcessed: "1" } },
			{
				body: {
					jobComplete: true,
					totalRows: "2",
					rows: [row(sampleGroup({ surface: "mobile" })), row(sampleRunSummary())],
				},
			},
		]);
		const { envelope, warnings } = await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl,
		});
		expect(envelope.groups).toHaveLength(0);
		expect(warnings.some((message) => message.includes("未知の surface"))).toBe(true);
	});

	test("dry-run → 本クエリ の順に、ちょうど2回だけ叩く", async () => {
		const fetchImpl = happyFetch();
		await fetchTriageEnvelope({
			projectId: "food-scroll",
			accessToken: "tok",
			sqlTemplate: generateErrorTriageSql(),
			window: WINDOW,
			generatedAt: GENERATED_AT,
			fetchImpl,
		});
		expect(fetchImpl.calls).toHaveLength(2);
		expect(fetchImpl.calls[0].body.dryRun).toBe(true);
		expect(fetchImpl.calls[1].body.dryRun).toBe(false);
		// 2回とも同じ SQL（見積りと本番でクエリが違ったらガードの意味が無い）
		expect(fetchImpl.calls[0].body.query).toBe(fetchImpl.calls[1].body.query);
		// 窓が埋まっている
		expect(fetchImpl.calls[1].body.query).toContain("TIMESTAMP '2026-08-05 23:00:00+00'");
	});
});
