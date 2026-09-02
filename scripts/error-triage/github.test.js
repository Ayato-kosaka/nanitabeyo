// #1196 error-triage / GitHub API 層と適用（apply）のテスト。
//
// **本番の GitHub には一切触りません。** `bq.test.js` と同じ手法で `fetch` を差し替え、
// 偽の GitHub（`makeServer`）に対して叩かせます。したがってこのテストは
// Issue を1件も起票・reopen・close・コメントしません。
//
// ここで固定したいのは主に3つです。
//   1. **冪等性**: 同じ run を2回流しても、起票の途中で落ちても、重複起票しない
//   2. **再発判定**: `closedAt + 24h` の猶予、`err/skip` の恒久無視、コメント → reopen の順序
//   3. **best-effort の失敗経路**: sub-issue 紐付けが失敗しても run を落とさない（横断レビュー §6-2）

"use strict";

const existingIssues = require("./__fixtures__/existing-issues.json");
const rows = require("./__fixtures__/bq-rows.json");
const runSummary = require("./__fixtures__/run-summary.json");
const { FP_ALGO_VERSION, PARENT_ISSUE_NUMBER, SKIP_LABEL, TRIAGE_LABEL } = require("./constants");
const {
	GitHubApiError,
	applyPlan,
	assertSubIssueId,
	collectIndexSources,
	createGitHubClient,
	parseRepository,
	resolveCommitDates,
	upsertParentSummaryComment,
} = require("./github");
const { PARENT_SUMMARY_MARKER, renderIssueBody, renderRegressionMarker } = require("./render");
const { buildEnvelope, buildPlan } = require("./triage");
const { computeWindow } = require("./window");

const API_ROOT = "https://api.github.test";
const OWNER = "Ayato-kosaka";
const REPO = "nanitabeyo";
const WINDOW = computeWindow({ now: "2026-08-07T00:05:12Z" });
const GENERATED_AT = "2026-08-07T00:05:12Z";
const QUERY = { estimatedBytes: 665800, maxBytesBilled: 200000000, totalRows: 7 };

/** fixture の各行がどの fingerprint になるかは triage.test.js と同じ（1行 ⇔ 1グループ）。 */
const FP = Object.freeze({
	openBackend: "799742528a3a", // #1201 open        → noop-open（body 更新の候補）
	regression: "4faaf5be346b", // #1202 closed(completed) → 回帰
	skipped: "b44a1734803c", // #1203 err/skip     → 恒久無視（API コール0）
	unknown: "77016f1e5b17", // 索引に無い          → 新規起票
	cooldown: "297b01d8b53f", // #1204 closed 直後   → 猶予内なので reopen しない
	wontfix: "c0f546d23818", // #1205 not_planned    → reopen しない。body だけ更新
});

const buildTestEnvelope = () =>
	buildEnvelope({ rows, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY }).envelope;

// ---------------------------------------------------------------------------
// 偽の GitHub
// ---------------------------------------------------------------------------

const jsonResponse = (status, body) => ({
	ok: status >= 200 && status < 300,
	status,
	text: async () => (body === undefined ? "" : JSON.stringify(body)),
});

/**
 * 偽の GitHub。状態を持ち、書き込みを実際に反映する（＝冪等性のテストが書ける）。
 *
 * @param {{
 *   issues?: Array<Record<string, any>>,
 *   subIssues?: Array<Record<string, any>>,
 *   comments?: Record<string, Array<Record<string, any>>>,
 *   commits?: Record<string, string>,
 *   fail?: Record<string, {status:number, times?:number, message?:string}>,
 * }} initial
 */
const makeServer = (initial = {}) => {
	const state = {
		issues: JSON.parse(JSON.stringify(initial.issues || [])),
		subIssues: [...(initial.subIssues || [])],
		comments: JSON.parse(JSON.stringify(initial.comments || {})),
		commits: { ...(initial.commits || {}) },
		fail: { ...(initial.fail || {}) },
		nextNumber: 5000,
		nextId: 9000000,
	};
	const calls = [];

	const maybeFail = (key) => {
		const rule = state.fail[key];
		if (!rule) return null;
		if (rule.times !== undefined) {
			if (rule.times <= 0) return null;
			rule.times -= 1;
		}
		return jsonResponse(rule.status, { message: rule.message || `injected failure for ${key}` });
	};

	const fetchImpl = async (rawUrl, init = {}) => {
		const method = (init.method || "GET").toUpperCase();
		const url = new URL(rawUrl);
		const path = url.pathname.replace(`/repos/${OWNER}/${REPO}`, "");
		const body = init.body ? JSON.parse(init.body) : null;
		calls.push({ method, path, search: url.search, body });

		const injected = maybeFail(`${method} ${path}`);
		if (injected) return injected;

		// --- 一覧（ラベル索引） ---
		if (method === "GET" && path === "/issues") {
			const label = url.searchParams.get("labels");
			const page = Number(url.searchParams.get("page") || "1");
			const perPage = Number(url.searchParams.get("per_page") || "100");
			const matched = state.issues.filter((issue) =>
				(issue.labels || []).some((entry) => (typeof entry === "string" ? entry : entry.name) === label),
			);
			return jsonResponse(200, matched.slice((page - 1) * perPage, page * perPage));
		}
		// --- 起票 ---
		if (method === "POST" && path === "/issues") {
			state.nextNumber += 1;
			state.nextId += 1;
			const created = {
				number: state.nextNumber,
				id: state.nextId,
				state: "open",
				state_reason: null,
				labels: (body.labels || []).map((name) => ({ name })),
				closed_at: null,
				updated_at: GENERATED_AT,
				title: body.title,
				body: body.body,
			};
			state.issues.push(created);
			return jsonResponse(201, created);
		}
		// --- コメントの更新（`/issues/comments/{id}`。`/issues/{n}/comments` より先に見る） ---
		if (method === "PATCH" && /^\/issues\/comments\/\d+$/.test(path)) {
			const id = Number(path.split("/").pop());
			for (const list of Object.values(state.comments)) {
				const found = list.find((comment) => comment.id === id);
				if (found) found.body = body.body;
			}
			return jsonResponse(200, { id, body: body.body });
		}
		// --- コメント一覧 / 投稿 ---
		const commentsMatch = /^\/issues\/(\d+)\/comments$/.exec(path);
		if (commentsMatch) {
			const issueNumber = commentsMatch[1];
			if (method === "GET") {
				// 本物と同じく **古い順**で返し、`page` / `per_page` / `since` を効かせる（L-1 の再現に要る）。
				// `created_at` を持たないコメント（多くの fixture）は時刻不明として `since` で落とさない。
				const all = state.comments[issueNumber] || [];
				const since = url.searchParams.get("since");
				const page = Number(url.searchParams.get("page") || "1");
				const perPage = Number(url.searchParams.get("per_page") || "100");
				const filtered = since ? all.filter((comment) => !comment.created_at || comment.created_at >= since) : all;
				return jsonResponse(200, filtered.slice((page - 1) * perPage, page * perPage));
			}
			state.nextId += 1;
			const comment = { id: state.nextId, body: body.body };
			state.comments[issueNumber] = [...(state.comments[issueNumber] || []), comment];
			return jsonResponse(201, comment);
		}
		// --- sub-issues ---
		const subIssuesMatch = /^\/issues\/(\d+)\/sub_issues$/.exec(path);
		if (subIssuesMatch) {
			if (method === "GET") return jsonResponse(200, state.subIssues);
			const linked = state.issues.find((issue) => issue.id === body.sub_issue_id);
			if (!linked) return jsonResponse(404, { message: "Not Found" });
			state.subIssues.push(linked);
			return jsonResponse(201, linked);
		}
		// --- Issue の更新 ---
		const issueMatch = /^\/issues\/(\d+)$/.exec(path);
		if (issueMatch && method === "PATCH") {
			const issue = state.issues.find((entry) => entry.number === Number(issueMatch[1]));
			if (!issue) return jsonResponse(404, { message: "Not Found" });
			Object.assign(issue, body);
			return jsonResponse(200, issue);
		}
		// --- commit ---
		const commitMatch = /^\/commits\/(.+)$/.exec(path);
		if (commitMatch && method === "GET") {
			const date = state.commits[decodeURIComponent(commitMatch[1])];
			if (!date) return jsonResponse(404, { message: "No commit found for SHA" });
			return jsonResponse(200, { commit: { committer: { date } } });
		}
		return jsonResponse(404, { message: `unhandled ${method} ${path}` });
	};

	fetchImpl.calls = calls;
	fetchImpl.state = state;
	fetchImpl.writes = () => calls.filter((call) => call.method !== "GET");
	return fetchImpl;
};

const makeClient = (fetchImpl, overrides = {}) =>
	createGitHubClient({
		token: "dummy-token",
		owner: OWNER,
		repo: REPO,
		apiRoot: API_ROOT,
		fetchImpl,
		sleepImpl: async () => {},
		...overrides,
	});

/** 親の sub-issue には最初から全部ぶら下がっている、という素直な初期状態。 */
const linkedSubIssues = () => existingIssues.filter((issue) => !issue.pull_request && issue.number !== 1196);

/** 索引 → plan → applyPlan までを1本で回す。 */
const runApply = async ({ fetchImpl, envelope = buildTestEnvelope(), dryRun = false, limits = {} } = {}) => {
	const client = makeClient(fetchImpl);
	const sources = await collectIndexSources({ client, parentIssue: PARENT_ISSUE_NUMBER });
	const plan = buildPlan({ envelope, issues: sources.issues, commitDates: {}, limits });
	const applyResult = await applyPlan({
		client,
		envelope,
		plan,
		issues: sources.issues,
		subIssues: sources.subIssues,
		parentIssue: PARENT_ISSUE_NUMBER,
		dryRun,
		sleepImpl: async () => {},
	});
	return { plan, applyResult, sources };
};

// ---------------------------------------------------------------------------

describe("純粋なユーティリティ", () => {
	test("parseRepository は owner/repo だけを受け付ける", () => {
		expect(parseRepository("Ayato-kosaka/nanitabeyo")).toEqual({ owner: "Ayato-kosaka", repo: "nanitabeyo" });
		expect(() => parseRepository("nanitabeyo")).toThrow(/owner\/repo/);
		expect(() => parseRepository("")).toThrow(/owner\/repo/);
		expect(() => parseRepository("a/b/c")).toThrow(/owner\/repo/);
	});

	test("sub_issue_id に issue number を渡したら弾く（#1198 §9 の取り違え防止）", () => {
		expect(assertSubIssueId(3000002)).toBe(3000002);
		// 1201 は number。id のつもりで渡されたら値域で分かる
		expect(() => assertSubIssueId(1201)).toThrow(/id（7〜10桁）/);
		expect(() => assertSubIssueId(null)).toThrow(/id（7〜10桁）/);
	});
});

describe("索引の取得", () => {
	test("list_issues のラベルフィルタを使う（search_issues は使わない）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: [] });
		await makeClient(fetchImpl).listIssuesByLabel();
		const [call] = fetchImpl.calls;
		expect(call.path).toBe("/issues");
		expect(call.search).toContain(`labels=${encodeURIComponent(TRIAGE_LABEL)}`);
		expect(call.search).toContain("state=all");
		// 既定の created desc だとページング中の新規で1件読み飛ばす（#1198 §1-B）
		expect(call.search).toContain("sort=created");
		expect(call.search).toContain("direction=asc");
		// search_issues のエンドポイントは1度も叩かない
		expect(fetchImpl.calls.every((entry) => !entry.path.includes("/search/"))).toBe(true);
	});

	test("100件ちょうどのページがあれば次ページも読む", async () => {
		const many = Array.from({ length: 100 }, (_, index) => ({
			number: 100 + index,
			id: 4000000 + index,
			state: "open",
			labels: [{ name: TRIAGE_LABEL }],
			body: "",
		}));
		const fetchImpl = makeServer({ issues: [...many, ...existingIssues] });
		const collected = await makeClient(fetchImpl).listIssuesByLabel();
		expect(collected.length).toBe(100 + existingIssues.length);
		expect(fetchImpl.calls.filter((call) => call.path === "/issues").length).toBe(2);
	});

	test("ページングの途中で落ちたら例外（部分索引のまま起票しない）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, fail: { "GET /issues": { status: 500 } } });
		await expect(makeClient(fetchImpl).listIssuesByLabel()).rejects.toThrow(/HTTP 500/);
	});

	test("GET は 5xx をリトライし、リトライで復帰する", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, fail: { "GET /issues": { status: 502, times: 2 } } });
		const collected = await makeClient(fetchImpl).listIssuesByLabel();
		expect(collected.length).toBe(existingIssues.length);
		expect(fetchImpl.calls.length).toBe(3);
	});

	test("POST はリトライしない（結果不明のまま再送すると二重起票になる。#1198 §7-4）", async () => {
		const fetchImpl = makeServer({ fail: { "POST /issues": { status: 502 } } });
		await expect(makeClient(fetchImpl).createIssue({ title: "t", body: "b" })).rejects.toThrow(/HTTP 502/);
		expect(fetchImpl.calls.filter((call) => call.method === "POST").length).toBe(1);
	});

	test("親の sub_issues を第2の索引源として和集合に入れる（レビュー §4）", async () => {
		// ラベルを人間が外してしまった Issue。sub-issue 側にだけ残っている
		const unlabeled = { ...existingIssues[1], number: 1301, id: 3000101, labels: [] };
		const fetchImpl = makeServer({ issues: [...existingIssues, unlabeled], subIssues: [unlabeled] });
		const sources = await collectIndexSources({ client: makeClient(fetchImpl) });
		expect(sources.subIssues.ok).toBe(true);
		expect(sources.issues.some((issue) => issue.number === 1301)).toBe(true);
	});

	test("sub_issues が取れなくても run を落とさない（§6-2。ラベル1枚に退化するだけ）", async () => {
		const fetchImpl = makeServer({
			issues: existingIssues,
			fail: { [`GET /issues/${PARENT_ISSUE_NUMBER}/sub_issues`]: { status: 403, message: "Resource not accessible" } },
		});
		const sources = await collectIndexSources({ client: makeClient(fetchImpl) });
		expect(sources.subIssues.ok).toBe(false);
		expect(sources.issues.length).toBeGreaterThan(0);
		expect(sources.warnings.join("\n")).toContain("sub-issue 一覧を取得できませんでした");
	});
});

describe("commit 日時の解決（再発判定 (3) の抑止条件）", () => {
	test("404 は「不明」として扱い、例外にしない", async () => {
		const fetchImpl = makeServer({ commits: { aaaaaaaaaaaa: "2026-08-05T00:00:00Z" } });
		const resolved = await resolveCommitDates({
			client: makeClient(fetchImpl),
			shas: ["aaaaaaaaaaaa", "unknown-00000"],
		});
		expect(resolved.commitDates).toEqual({ aaaaaaaaaaaa: "2026-08-05T00:00:00Z" });
		expect(resolved.lookups).toBe(2);
	});

	test("上限を超えたら残りは引かずに警告する", async () => {
		const fetchImpl = makeServer({});
		const resolved = await resolveCommitDates({
			client: makeClient(fetchImpl),
			shas: ["a", "b", "c"],
			limit: 2,
		});
		expect(resolved.lookups).toBe(2);
		expect(resolved.warnings.join("\n")).toContain("上限 2 件");
	});
});

describe("applyPlan: 状態遷移ごとの書き込み", () => {
	test("未知 fingerprint は単一 POST で起票し、fp マーカーとラベルを同じ POST に載せる", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.created).toHaveLength(1);
		expect(applyResult.created[0].fingerprint).toBe(FP.unknown);

		const posts = fetchImpl.calls.filter((call) => call.method === "POST" && call.path === "/issues");
		expect(posts).toHaveLength(1);
		expect(posts[0].body.labels).toEqual([TRIAGE_LABEL]);
		expect(posts[0].body.body).toContain(`<!-- fp:${FP.unknown} -->`);
		expect(posts[0].body.body).toContain(`<!-- fpalgo:${FP_ALGO_VERSION} -->`);
		expect(posts[0].body.title).toContain(`(fp:${FP.unknown})`);
	});

	test("起票した Issue は number ではなく **id** で親へぶら下げる", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { applyResult } = await runApply({ fetchImpl });
		const link = fetchImpl.calls.find(
			(call) => call.method === "POST" && call.path === `/issues/${PARENT_ISSUE_NUMBER}/sub_issues`,
		);
		expect(link.body.sub_issue_id).toBe(applyResult.created[0].issueId);
		expect(link.body.sub_issue_id).toBeGreaterThan(1000000);
		expect(link.body.sub_issue_id).not.toBe(applyResult.created[0].issueNumber);
		expect(applyResult.subIssueFailures).toHaveLength(0);
	});

	test("回帰は「コメント → reopen」の順（逆だと開いた理由が永久に付かない。#1198 §5-D）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { plan, applyResult } = await runApply({ fetchImpl });

		expect(plan.items.find((item) => item.fingerprint === FP.regression).action).toBe("reopen");
		expect(applyResult.reopened).toEqual([{ fingerprint: FP.regression, issueNumber: 1202, commented: true }]);

		const writes = fetchImpl.writes();
		const commentIndex = writes.findIndex((call) => call.path === "/issues/1202/comments");
		const reopenIndex = writes.findIndex((call) => call.method === "PATCH" && call.path === "/issues/1202");
		expect(commentIndex).toBeGreaterThanOrEqual(0);
		expect(reopenIndex).toBeGreaterThan(commentIndex);
		expect(writes[reopenIndex].body).toEqual({ state: "open", state_reason: "reopened" });
	});

	test("同一マーカーのコメントが既にあれば再投稿しない（同日中の再実行が冪等）", async () => {
		const group = buildTestEnvelope().groups.find((entry) => entry.fingerprint === FP.regression);
		const marker = renderRegressionMarker(FP.regression, group.lastSeenUtc);
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			comments: { 1202: [{ id: 7000001, body: `過去の回帰コメント\n${marker}` }] },
		});
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.reopened[0].commented).toBe(false);
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.path === "/issues/1202/comments")).toBe(false);
		// reopen だけはやり直される（コメント投入後・reopen 前に落ちた run の復旧経路）
		expect(fetchImpl.calls.some((call) => call.method === "PATCH" && call.path === "/issues/1202")).toBe(true);
	});

	test("`err/skip` は open / closed を問わず API コールを1回も発行しない（#1198 §6-D）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { plan } = await runApply({ fetchImpl });
		expect(plan.items.find((item) => item.fingerprint === FP.skipped).action).toBe("noop-skip");
		expect(fetchImpl.calls.every((call) => !call.path.startsWith("/issues/1203"))).toBe(true);
	});

	test("`err/skip` は closed でも reopen しない（恒久無視。再発しても起こさない）", async () => {
		// #1203 を「再発条件を満たす closed」に見せかけても、skip が優先される
		const issues = existingIssues.map((issue) =>
			issue.number === 1203 ? { ...issue, state_reason: "completed", closed_at: "2026-07-20T00:00:00Z" } : issue,
		);
		const fetchImpl = makeServer({ issues, subIssues: linkedSubIssues() });
		const { plan, applyResult } = await runApply({ fetchImpl });
		expect(plan.items.find((item) => item.fingerprint === FP.skipped).action).toBe("noop-skip");
		expect(applyResult.reopened.map((entry) => entry.issueNumber)).not.toContain(1203);
	});

	test("close 直後（猶予 24h 以内）の再出現では reopen しない", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { plan } = await runApply({ fetchImpl });
		const item = plan.items.find((entry) => entry.fingerprint === FP.cooldown);
		expect(item.action).toBe("noop-cooldown");
		expect(fetchImpl.calls.some((call) => call.method === "PATCH" && call.path === "/issues/1204")).toBe(false);
	});

	test("closed(not_planned) は reopen せず body だけ更新する", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { plan, applyResult } = await runApply({ fetchImpl });
		expect(plan.items.find((item) => item.fingerprint === FP.wontfix).action).toBe("noop-wontfix");
		expect(applyResult.reopened.map((entry) => entry.issueNumber)).not.toContain(1205);
		const patch = fetchImpl.calls.find((call) => call.method === "PATCH" && call.path === "/issues/1205");
		expect(Object.keys(patch.body)).toEqual(["body"]);
	});

	test("既存 open Issue にはコメントせず、body の自動領域だけを更新する（通知を出さない）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.bodyUpdated.map((entry) => entry.issueNumber)).toContain(1201);
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.path === "/issues/1201/comments")).toBe(false);

		const patch = fetchImpl.calls.find((call) => call.method === "PATCH" && call.path === "/issues/1201");
		// PATCH に labels を含めない（含めると人間が付けたラベルが全置換で消える。#1198 §7-11）
		expect(Object.keys(patch.body)).toEqual(["body"]);
		// 自動領域の外にある人間のメモを1文字も捨てない
		expect(patch.body.body).toContain("人間のメモ: 調査中。ここは絶対に消さないでほしい。");
		// G2: firstSeen は既存 body の値と min() を取る（今日にリセットしない）
		expect(patch.body.body).toContain("<!-- firstSeen:2026-07-01T05:00:00Z -->");
	});

	test("変化が無ければ body を PATCH しない（#1198 §6-C のスロットリング）", async () => {
		const envelope = buildTestEnvelope();
		const group = envelope.groups.find((entry) => entry.fingerprint === FP.openBackend);
		// 昨日この Issue を同じ内容で更新した、という状態を作る
		const issues = existingIssues.map((issue) =>
			issue.number === 1201
				? {
						...issue,
						body: renderIssueBody({
							group,
							window: WINDOW,
							generatedAt: "2026-08-06T00:05:12Z",
							existingBody: issue.body,
						}),
					}
				: issue,
		);
		const fetchImpl = makeServer({ issues, subIssues: linkedSubIssues() });
		const { applyResult } = await runApply({ fetchImpl, envelope });

		expect(applyResult.bodyUpdated.map((entry) => entry.issueNumber)).not.toContain(1201);
		expect(applyResult.bodySkipped.map((entry) => entry.issueNumber)).toContain(1201);
		expect(fetchImpl.calls.some((call) => call.method === "PATCH" && call.path === "/issues/1201")).toBe(false);
	});
});

describe("冪等性", () => {
	test("同じ run を2回流しても重複起票しない（状態を持たず索引から再構成する）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const first = await runApply({ fetchImpl });
		expect(first.applyResult.created).toHaveLength(1);

		const second = await runApply({ fetchImpl });
		expect(second.applyResult.created).toHaveLength(0);
		expect(second.plan.items.find((item) => item.fingerprint === FP.unknown).action).toBe("noop-open");
		expect(fetchImpl.calls.filter((call) => call.method === "POST" && call.path === "/issues")).toHaveLength(1);
	});

	test("計画作成後・起票直前に別 run が起票していたら、索引の再取得で気づいて起票しない", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const client = makeClient(fetchImpl);
		const envelope = buildTestEnvelope();
		const sources = await collectIndexSources({ client });
		const plan = buildPlan({ envelope, issues: sources.issues });
		expect(plan.counts.create).toBe(1);

		// ここで cron / workflow_dispatch の競合相手が先に起票した、という状況を作る
		fetchImpl.state.issues.push({
			number: 1250,
			id: 3000500,
			state: "open",
			state_reason: null,
			labels: [{ name: TRIAGE_LABEL }],
			closed_at: null,
			updated_at: GENERATED_AT,
			body: `<!-- fp:${FP.unknown} -->\n<!-- fpalgo:${FP_ALGO_VERSION} -->`,
		});

		const applyResult = await applyPlan({
			client,
			envelope,
			plan,
			issues: sources.issues,
			subIssues: sources.subIssues,
			sleepImpl: async () => {},
		});

		expect(applyResult.created).toHaveLength(0);
		expect(applyResult.warnings.join("\n")).toContain("索引の再取得で判明");
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.path === "/issues")).toBe(false);
	});

	test("起票 POST がエラーでも実際には作成されていたら、索引の読み直しで成功扱いにする（再送しない）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const original = fetchImpl.state.issues;
		// POST は「作成はされたが 502 を返す」挙動にする
		const wrapped = async (url, init = {}) => {
			const method = (init.method || "GET").toUpperCase();
			if (method === "POST" && new URL(url).pathname.endsWith("/issues")) {
				await fetchImpl(url, init); // 実際には作成される
				return { ok: false, status: 502, text: async () => JSON.stringify({ message: "Bad gateway" }) };
			}
			return fetchImpl(url, init);
		};
		wrapped.calls = fetchImpl.calls;

		const client = makeClient(wrapped);
		const envelope = buildTestEnvelope();
		const sources = await collectIndexSources({ client });
		const plan = buildPlan({ envelope, issues: sources.issues });
		const applyResult = await applyPlan({
			client,
			envelope,
			plan,
			issues: sources.issues,
			subIssues: sources.subIssues,
			sleepImpl: async () => {},
		});

		expect(applyResult.created).toHaveLength(1);
		expect(applyResult.failures).toHaveLength(0);
		expect(applyResult.warnings.join("\n")).toContain("成功扱い");
		// 再送していない（POST /issues は1回だけ）
		expect(fetchImpl.calls.filter((call) => call.method === "POST" && call.path === "/issues")).toHaveLength(1);
		expect(original.filter((issue) => String(issue.body).includes(FP.unknown))).toHaveLength(1);
	});

	test("起票が本当に失敗したら、その run では起票を打ち切って失敗として記録する", async () => {
		const many = [
			...rows,
			{ ...rows[3], groupKey: { ...rows[3].groupKey, pathName: "/another" } },
			{ ...rows[3], groupKey: { ...rows[3].groupKey, pathName: "/yet-another" } },
		];
		const envelope = buildEnvelope({
			rows: many,
			runSummary,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			query: QUERY,
		}).envelope;
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			fail: { "POST /issues": { status: 403, message: "Resource not accessible by integration" } },
		});
		const { plan, applyResult } = await runApply({ fetchImpl, envelope });

		expect(plan.counts.create).toBe(3);
		expect(applyResult.created).toHaveLength(0);
		expect(applyResult.failures).toHaveLength(1);
		// 3件叩き続けず1件で打ち切る（二次レート制限を引き当てない）
		expect(fetchImpl.calls.filter((call) => call.method === "POST" && call.path === "/issues")).toHaveLength(1);
	});

	test("索引を取り直せないときは1件も起票しない（fail-closed）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const client = makeClient(fetchImpl);
		const envelope = buildTestEnvelope();
		const sources = await collectIndexSources({ client });
		const plan = buildPlan({ envelope, issues: sources.issues });

		fetchImpl.state.fail["GET /issues"] = { status: 500 };
		const applyResult = await applyPlan({
			client,
			envelope,
			plan,
			issues: sources.issues,
			subIssues: sources.subIssues,
			sleepImpl: async () => {},
		});

		expect(applyResult.created).toHaveLength(0);
		expect(applyResult.failures.map((entry) => entry.stage)).toContain("create-recheck");
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.path === "/issues")).toBe(false);
	});

	test("fpalgo が既存 Issue と食い違ったら1バイトも書かない（#1198 §8-A）", async () => {
		const issues = existingIssues.map((issue) =>
			issue.number === 1201 ? { ...issue, body: String(issue.body).replace("fpalgo:2", "fpalgo:99") } : issue,
		);
		const fetchImpl = makeServer({ issues, subIssues: linkedSubIssues() });
		const { plan, applyResult } = await runApply({ fetchImpl });

		expect(plan.abort).toBe(true);
		expect(plan.counts.create).toBe(0);
		expect(plan.counts.reopen).toBe(0);
		expect(applyResult.aborted).toBe(true);
		expect(fetchImpl.writes()).toHaveLength(0);
	});

	test("dry-run は書き込みを1つも出さないが、判定結果は本番と同一になる", async () => {
		const wet = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const dry = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const real = await runApply({ fetchImpl: wet });
		const simulated = await runApply({ fetchImpl: dry, dryRun: true });

		expect(dry.writes()).toHaveLength(0);
		expect(simulated.plan.items).toEqual(real.plan.items);
		expect(simulated.applyResult.created.map((entry) => entry.fingerprint)).toEqual(
			real.applyResult.created.map((entry) => entry.fingerprint),
		);
		expect(simulated.applyResult.reopened.map((entry) => entry.issueNumber)).toEqual(
			real.applyResult.reopened.map((entry) => entry.issueNumber),
		);
	});
});

describe("sub-issue 紐付けは best-effort（横断レビュー §6-2 / S11）", () => {
	test("紐付けに失敗しても run は落とさず、失敗件数を残す", async () => {
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			fail: { [`POST /issues/${PARENT_ISSUE_NUMBER}/sub_issues`]: { status: 403, message: "Forbidden" } },
		});
		const { applyResult } = await runApply({ fetchImpl });

		// 起票そのものは成功している（単一 POST で原子的に完了させているため）
		expect(applyResult.created).toHaveLength(1);
		expect(applyResult.failures).toHaveLength(0);
		expect(applyResult.subIssueFailures).toHaveLength(1);
		expect(applyResult.subIssueFailures[0].message).toContain("403");
	});

	test("sub_issues が読めないときは reconcile をスキップし、起票と reopen は続ける", async () => {
		const fetchImpl = makeServer({
			issues: existingIssues,
			fail: { [`GET /issues/${PARENT_ISSUE_NUMBER}/sub_issues`]: { status: 404 } },
		});
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.subIssueIndexOk).toBe(false);
		expect(applyResult.created).toHaveLength(1);
		expect(applyResult.reopened).toHaveLength(1);
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.path.endsWith("/sub_issues"))).toBe(false);
	});

	test("親から未紐付けの既存 Issue を貼り直す（reconcile）。**DELETE は1本も出さない**（S11）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: [] });
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.subIssueLinked.length).toBeGreaterThan(1);
		expect(fetchImpl.calls.every((call) => call.method !== "DELETE")).toBe(true);
	});

	// ★ M-2（PR #1211 レビュー）: reconcile も「`err/skip` は API コールを1回も発行しない」（#1198 §6-D）の対象。
	//   恒久無視と決めた Issue を親へぶら下げると 100 件のソフト上限枠を食い、S11 で自動 DELETE を禁じている以上
	//   その枠は人手でしか回収できない。
	test("M-2: `err/skip` の Issue は reconcile でも親へ紐付けない（§6-D / 上限枠を食わせない）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: [] });
		const { applyResult } = await runApply({ fetchImpl });

		// #1203 = err/skip。他の未紐付け Issue は貼り直されている（reconcile 自体は動いている）
		expect(applyResult.subIssueLinked.length).toBeGreaterThan(1);
		expect(applyResult.subIssueLinked.map((entry) => entry.issueNumber)).not.toContain(1203);
		expect(applyResult.subIssueLinked.map((entry) => entry.issueId)).not.toContain(3000004);
		// POST /sub_issues にも #1203 の id は載らない
		const links = fetchImpl.calls.filter(
			(call) => call.method === "POST" && call.path === `/issues/${PARENT_ISSUE_NUMBER}/sub_issues`,
		);
		expect(links.length).toBeGreaterThan(0);
		expect(links.map((call) => call.body.sub_issue_id)).not.toContain(3000004);
		// #1203 に対する API コールは（GET も含めて）1本も無い
		expect(fetchImpl.calls.every((call) => !call.path.startsWith("/issues/1203"))).toBe(true);
	});

	test("M-2: `err/skip` が sub-issue 索引にも無い状態を何度流しても紐付けは増えない（冪等）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: [] });
		await runApply({ fetchImpl });
		const afterFirst = fetchImpl.calls.filter((call) => call.path.endsWith("/sub_issues") && call.method === "POST");
		const second = await runApply({ fetchImpl });
		const afterSecond = fetchImpl.calls.filter((call) => call.path.endsWith("/sub_issues") && call.method === "POST");

		// 2 run 目に増えるのは「1 run 目で起票した Issue」の分だけで、err/skip は何度でも対象外
		expect(afterSecond.map((call) => call.body.sub_issue_id)).not.toContain(3000004);
		expect(second.applyResult.subIssueLinked.map((entry) => entry.issueNumber)).not.toContain(1203);
		expect(afterSecond.length).toBeGreaterThanOrEqual(afterFirst.length);
	});
});

// ---------------------------------------------------------------------------
// L-1（PR #1211 レビュー）: 回帰コメントの重複抑止
// ---------------------------------------------------------------------------
//
// コメントは古い順にしか読めない（issue comments API は `sort` / `direction` を受け付けない）ので、
// ページ数で頭打ちにすると取れるのは**最も古い 300 件**になる。探しているマーカーは常に**最新側**にある。
// 回帰コメントは通知が飛ぶ操作なので、取り逃がすと重複通知になる。

describe("回帰コメントの重複抑止（L-1）", () => {
	/** #1202（closed_at = 2026-08-04T00:00:00Z）に、close より前の古いコメントを N 件積む。 */
	const oldComments = (count) =>
		Array.from({ length: count }, (_, index) => ({
			id: 7100000 + index,
			body: `古い会話 ${index}`,
			created_at: "2026-07-01T00:00:00Z",
		}));

	test("close より後のコメントだけを読む（`since=closedAt` を必ず付ける）", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		await runApply({ fetchImpl });
		const get = fetchImpl.calls.find((call) => call.method === "GET" && call.path === "/issues/1202/comments");
		expect(get.search).toContain(`since=${encodeURIComponent("2026-08-04T00:00:00Z")}`);
	});

	test("close 前のコメントが 350 件あってもマーカーを見つけ、回帰コメントを重複投稿しない", async () => {
		const group = buildTestEnvelope().groups.find((entry) => entry.fingerprint === FP.regression);
		const marker = renderRegressionMarker(FP.regression, group.lastSeenUtc);
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			comments: {
				1202: [
					...oldComments(350),
					// マーカーは必ず close より後に付く（＝古い順に読むと 351 件目）
					{ id: 7200001, body: `過去の回帰コメント\n${marker}`, created_at: "2026-08-06T23:00:00Z" },
				],
			},
		});
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.reopened[0].commented).toBe(false);
		expect(fetchImpl.calls.some((call) => call.method === "POST" && call.path === "/issues/1202/comments")).toBe(false);
		// reopen 自体はやり直される（コメント投入後・reopen 前に落ちた run の復旧経路）
		expect(fetchImpl.calls.some((call) => call.method === "PATCH" && call.path === "/issues/1202")).toBe(true);
	});

	test("マーカーがまだ無ければ（close 後のコメントが他人のものだけでも）1回だけ投稿する", async () => {
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			comments: {
				1202: [...oldComments(350), { id: 7200002, body: "調査中です", created_at: "2026-08-06T23:00:00Z" }],
			},
		});
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.reopened[0].commented).toBe(true);
		expect(
			fetchImpl.calls.filter((call) => call.method === "POST" && call.path === "/issues/1202/comments"),
		).toHaveLength(1);
	});

	test("同じ run を2回流しても回帰コメントは1回だけ（重複通知にしない）", async () => {
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			comments: { 1202: oldComments(350) },
		});
		await runApply({ fetchImpl });
		// 1 run 目で reopen されるので、2 run 目は回帰にならない。close されたままの状態で再実行する
		const reclosed = fetchImpl.state.issues.find((issue) => issue.number === 1202);
		Object.assign(reclosed, { state: "closed", state_reason: "completed", closed_at: "2026-08-04T00:00:00Z" });
		// 1 run 目に投稿されたコメントには created_at が無い＝時刻不明なので since で落ちない（本物は close 後に付く）
		await runApply({ fetchImpl });

		expect(
			fetchImpl.calls.filter((call) => call.method === "POST" && call.path === "/issues/1202/comments"),
		).toHaveLength(1);
	});
});

describe("親の常駐サマリコメント", () => {
	test("既存コメントがあれば PATCH で上書きする（毎回新規コメントを作らない）", async () => {
		const fetchImpl = makeServer({
			issues: existingIssues,
			subIssues: linkedSubIssues(),
			comments: { [PARENT_ISSUE_NUMBER]: [{ id: 8000001, body: `${PARENT_SUMMARY_MARKER}\n古いサマリ` }] },
		});
		const { applyResult } = await runApply({ fetchImpl });

		expect(applyResult.parentSummary).toBe("updated");
		expect(fetchImpl.calls.some((call) => call.method === "PATCH" && call.path === "/issues/comments/8000001")).toBe(
			true,
		);
		expect(
			fetchImpl.calls.some((call) => call.method === "POST" && call.path === `/issues/${PARENT_ISSUE_NUMBER}/comments`),
		).toBe(false);
	});

	test("初回だけ新規作成する", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		const { applyResult } = await runApply({ fetchImpl });
		expect(applyResult.parentSummary).toBe("created");
	});

	test("G5: 常駐サマリに excludedBreakdown 上位5件と truncated を含める", async () => {
		const fetchImpl = makeServer({ issues: existingIssues, subIssues: linkedSubIssues() });
		await runApply({ fetchImpl });
		const posted = fetchImpl.calls.find(
			(call) => call.method === "POST" && call.path === `/issues/${PARENT_ISSUE_NUMBER}/comments`,
		);
		expect(posted.body.body).toContain(PARENT_SUMMARY_MARKER);
		expect(posted.body.body).toContain("除外内訳（上位5）");
		expect(posted.body.body).toContain("expected_client_error");
		expect(posted.body.body).toMatch(/切り捨て/);
		expect(posted.body.body).toContain("直近 run の書き込み結果");
	});

	test("upsert 単体: マーカーを含むコメントだけを対象にする", async () => {
		const fetchImpl = makeServer({
			comments: {
				[PARENT_ISSUE_NUMBER]: [
					{ id: 1, body: "人間のコメント" },
					{ id: 2, body: `${PARENT_SUMMARY_MARKER}\nサマリ` },
				],
			},
		});
		const outcome = await upsertParentSummaryComment({ client: makeClient(fetchImpl), body: "新しいサマリ" });
		expect(outcome).toBe("updated");
		expect(fetchImpl.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
		expect(fetchImpl.calls.find((call) => call.method === "PATCH").path).toBe("/issues/comments/2");
	});
});

describe("GitHubApiError", () => {
	test("status を持ち、トークンを含まない", async () => {
		const fetchImpl = makeServer({ fail: { "GET /issues": { status: 404, message: "Not Found" } } });
		await expect(makeClient(fetchImpl).listIssuesByLabel()).rejects.toThrow(GitHubApiError);
		await makeClient(fetchImpl)
			.listIssuesByLabel()
			.catch((error) => {
				expect(error.status).toBe(404);
				expect(error.message).not.toContain("dummy-token");
			});
	});

	test("`err/skip` ラベル名と親 Issue 番号は定数で固定されている（新規作成しない）", () => {
		expect(SKIP_LABEL).toBe("err/skip");
		expect(TRIAGE_LABEL).toBe("error-triage");
		expect(PARENT_ISSUE_NUMBER).toBe(1196);
	});
});
