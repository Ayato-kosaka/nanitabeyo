"use strict";

const existingIssues = require("./__fixtures__/existing-issues.json");
const rows = require("./__fixtures__/bq-rows.json");
const runSummary = require("./__fixtures__/run-summary.json");
const {
	AUTO_END_MARKER,
	AUTO_START_MARKER,
	PARENT_SUMMARY_MARKER,
	TITLE_MAX_LENGTH,
	extractAlgoVersion,
	extractFingerprints,
	extractFirstSeenUtc,
	renderIssueBody,
	renderJobSummary,
	renderParentSummaryComment,
	renderRegressionComment,
	renderRegressionMarker,
	renderTitle,
} = require("./render");
const { buildEnvelope, buildPlan } = require("./triage");
const { computeWindow } = require("./window");

const GENERATED_AT = "2026-08-07T00:05:12Z";
const WINDOW = computeWindow({ now: GENERATED_AT });
const QUERY = { estimatedBytes: 78412345, maxBytesBilled: 200000000, totalRows: 1204 };

const envelope = buildEnvelope({ rows, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY }).envelope;
const [backendGroup, frontendGroup, externalGroup] = envelope.groups;
const issue1201 = existingIssues.find((issue) => issue.number === 1201);

describe("本文マーカーの抽出", () => {
	it("行全体アンカーの HTML コメントだけを拾う", () => {
		expect(extractFingerprints(issue1201.body)).toEqual(["799742528a3a"]);
	});

	it("散文・桁数違い・大文字・行途中のものは拾わない（#1199 §7-3-A ケース18）", () => {
		const noisy = existingIssues.find((issue) => issue.number === 1211);
		expect(extractFingerprints(noisy.body)).toEqual([]);
	});

	it("複数 fp があれば全部返す（重複は除く）", () => {
		const multi = existingIssues.find((issue) => issue.number === 1212);
		expect(extractFingerprints(multi.body)).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
		expect(extractFingerprints("<!-- fp:aaaaaaaaaaaa -->\n<!-- fp:aaaaaaaaaaaa -->")).toEqual(["aaaaaaaaaaaa"]);
	});

	it("空・null でも例外にならない", () => {
		expect(extractFingerprints(null)).toEqual([]);
		expect(extractFingerprints("")).toEqual([]);
	});

	it("グローバル正規表現の lastIndex を持ち越さない（2回呼んでも同じ結果）", () => {
		expect(extractFingerprints(issue1201.body)).toEqual(extractFingerprints(issue1201.body));
	});

	it("fpalgo マーカーが無ければ 1 とみなす", () => {
		expect(extractAlgoVersion(issue1201.body)).toBe(1);
		expect(extractAlgoVersion("<!-- fp:aaaaaaaaaaaa -->")).toBe(1);
		expect(extractAlgoVersion("<!-- fpalgo:2 -->")).toBe(2);
	});

	it("firstSeen マーカーを読み取れる", () => {
		expect(extractFirstSeenUtc(issue1201.body)).toBe("2026-07-01T05:00:00Z");
		expect(extractFirstSeenUtc("なにもない")).toBeNull();
	});
});

describe("renderTitle()", () => {
	it("surface / どこで / 何が / fp を1行に入れる", () => {
		expect(renderTitle(backendGroup)).toBe(
			`[err/backend] ApiExceptionFilter /v<n>/dishes/bulk-import: UnhandledException: TypeError: Cannot read… (fp:${backendGroup.fingerprint})`,
		);
	});

	it("external は apiName / method / endpoint / statusCode の形", () => {
		expect(renderTitle(externalGroup)).toBe(
			`[err/external] Claude API POST https://api.anthropic.com/v<n>/messages → 529 (fp:${externalGroup.fingerprint})`,
		);
	});

	it("必ず 120 文字以内で、fingerprint が末尾に残る", () => {
		const long = {
			...frontendGroup,
			messagePattern: "とても長いメッセージ".repeat(50),
			groupKey: { ...frontendGroup.groupKey, pathName: "/ja/".padEnd(300, "x") },
		};
		const title = renderTitle(long);
		expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
		expect(title.endsWith(`(fp:${long.fingerprint})`)).toBe(true);
	});

	it("messagePattern が null でも壊れない", () => {
		expect(renderTitle({ ...frontendGroup, messagePattern: null })).toContain("(no message)");
	});
});

describe("renderIssueBody() — 新規起票", () => {
	const body = renderIssueBody({ group: backendGroup, window: WINDOW, generatedAt: GENERATED_AT });

	it("先頭に fp / fpalgo マーカーを置く", () => {
		expect(body.split("\n")[0]).toBe(`<!-- fp:${backendGroup.fingerprint} -->`);
		expect(body.split("\n")[1]).toBe("<!-- fpalgo:1 -->");
		expect(extractFingerprints(body)).toEqual([backendGroup.fingerprint]);
	});

	it("自動領域と人間の自由記述領域を分ける", () => {
		expect(body).toContain(AUTO_START_MARKER);
		expect(body).toContain(AUTO_END_MARKER);
		expect(body.indexOf(AUTO_END_MARKER)).toBeLessThan(body.indexOf("（ここから下は自由記述"));
	});

	it("5秒で判断するための情報（どこで/何が/どれだけ/いつ/どのビルド）が入る", () => {
		expect(body).toContain("ApiExceptionFilter");
		expect(body).toContain("TypeError: Cannot read properties of undefined");
		expect(body).toContain("**142 件** / 影響ユーザー 37 人");
		expect(body).toContain("2026-08-06T00:14:02Z");
		expect(body).toContain("9f2c1ab4d7e0");
	});

	it("匿名オンリーのグループは「識別ユーザー 0 人 / 匿名 N 件」と出す（S4）", () => {
		const anonymous = envelope.groups.find((group) => group.affectedUsers === 0);
		const anonymousBody = renderIssueBody({ group: anonymous, window: WINDOW, generatedAt: GENERATED_AT });
		expect(anonymousBody).toContain("識別ユーザー 0 人 / 匿名 40 件");
	});

	it("窓の重複（G6）を本文に明記する", () => {
		expect(body).toContain("run をまたいで合算されません");
	});

	it("firstSeen マーカーは今回の観測値になる", () => {
		expect(extractFirstSeenUtc(body)).toBe("2026-08-06T00:14:02Z");
	});
});

describe("renderIssueBody() — 既存 body の更新", () => {
	const updated = renderIssueBody({
		group: backendGroup,
		window: WINDOW,
		generatedAt: GENERATED_AT,
		existingBody: issue1201.body,
	});

	it("G2: firstSeen は既存値と min() を取る（毎日今日にリセットしない）", () => {
		expect(extractFirstSeenUtc(issue1201.body)).toBe("2026-07-01T05:00:00Z");
		expect(extractFirstSeenUtc(updated)).toBe("2026-07-01T05:00:00Z");
		expect(updated).toContain("初観測 `2026-07-01T05:00:00Z`");
	});

	it("G2: 今回の観測の方が古ければそちらを採る", () => {
		const older = renderIssueBody({
			group: { ...backendGroup, firstSeenUtc: "2026-01-01T00:00:00Z" },
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: issue1201.body,
		});
		expect(extractFirstSeenUtc(older)).toBe("2026-01-01T00:00:00Z");
	});

	it("G2: 既存 body に firstSeen マーカーが無ければ今回の値を使う", () => {
		const fresh = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: `<!-- fp:${backendGroup.fingerprint} -->\n${AUTO_START_MARKER}\n古い内容\n${AUTO_END_MARKER}`,
		});
		expect(extractFirstSeenUtc(fresh)).toBe("2026-08-06T00:14:02Z");
	});

	it("不変条件 2: 既存 body の件数と合算しない（run をまたいで足さない）", () => {
		expect(issue1201.body).toContain("**9000 件**");
		expect(updated).toContain("**142 件**");
		expect(updated).not.toContain("9142");
		expect(updated).not.toContain("9000");
	});

	it("自動領域の外（人間の作業メモ）を保全する", () => {
		expect(updated).toContain("人間のメモ: 調査中。ここは絶対に消さないでほしい。");
	});

	it("先頭の fp / fpalgo マーカーを壊さない", () => {
		expect(extractFingerprints(updated)).toEqual(["799742528a3a"]);
		expect(extractAlgoVersion(updated)).toBe(1);
	});

	it("自動領域が2つに増えない（何度更新しても1つ）", () => {
		const twice = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: updated,
		});
		expect(twice.split(AUTO_START_MARKER)).toHaveLength(2);
		expect(twice).toBe(updated);
	});

	it("自動領域が見つからない body（人間が消した）には新規 body を作り直す", () => {
		const rebuilt = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: "マーカーを全部消してしまった本文",
		});
		expect(rebuilt).toContain(AUTO_START_MARKER);
		expect(extractFingerprints(rebuilt)).toEqual([backendGroup.fingerprint]);
	});
});

describe("renderRegressionComment()", () => {
	const comment = renderRegressionComment({
		group: frontendGroup,
		closedAt: "2026-08-04T00:00:00Z",
		eventsAfterGrace: 58,
		graceHours: 24,
		latestCommit: "9f2c1ab4d7e0",
	});

	it("close 時刻・猶予後の件数・影響ユーザー数を出す", () => {
		expect(comment).toContain("2026-08-04T00:00:00Z");
		expect(comment).toContain("**58 件 / 影響ユーザー 22 人**");
	});

	it("誤検知時の逃げ道（err/skip）を案内する", () => {
		expect(comment).toContain("err/skip");
	});

	it("冪等マーカーは fp + lastSeen の日付（同日再実行で重複投稿しない）", () => {
		expect(comment).toContain(renderRegressionMarker(frontendGroup.fingerprint, frontendGroup.lastSeenUtc));
		expect(renderRegressionMarker("aaaaaaaaaaaa", "2026-08-06T22:10:48Z")).toBe(
			"<!-- error-triage:regression:aaaaaaaaaaaa:2026-08-06 -->",
		);
	});

	it("翌日の再発では別のマーカーになる", () => {
		expect(renderRegressionMarker("aaaaaaaaaaaa", "2026-08-07T01:00:00Z")).not.toBe(
			renderRegressionMarker("aaaaaaaaaaaa", "2026-08-06T22:10:48Z"),
		);
	});
});

describe("renderJobSummary() / renderParentSummaryComment()", () => {
	const plan = buildPlan({ envelope, issues: existingIssues, commitDates: { "9f2c1ab4d7e0": "2026-08-05T11:03:00Z" } });

	it("窓・見積り・件数・action 内訳を出す", () => {
		const summary = renderJobSummary({ envelope, plan });
		expect(summary).toContain(WINDOW.startUtc);
		expect(summary).toContain("78.4 MB");
		expect(summary).toContain("create **1**");
		expect(summary).toContain("reopen **1**");
	});

	it("G5: 除外内訳を reason / eventName / httpStatus 単位で上位5件出す", () => {
		const summary = renderJobSummary({ envelope, plan });
		expect(summary).toContain("expected_client_error");
		expect(summary).toContain("HttpException");
		expect(summary).toContain("404");
		// 6件目（最小の transient_status）は上位5件に入らない
		expect(summary).not.toContain("transient_status");
	});

	it("G3: 切り捨てが起きたら必ず警告を出す", () => {
		const truncated = { ...envelope, runSummary: { ...envelope.runSummary, groupCount: 900, truncated: true } };
		const summary = renderJobSummary({ envelope: truncated, plan });
		expect(summary).toContain("切り捨てが発生しています");
		expect(summary).toContain("全件を見たと誤読しないこと");
	});

	it("切り捨てが無ければ警告を出さない", () => {
		expect(renderJobSummary({ envelope, plan })).not.toContain("切り捨てが発生しています");
	});

	it("PANIC 時はその旨を出す", () => {
		const panicked = { ...plan, panic: true };
		expect(renderJobSummary({ envelope, plan: panicked })).toContain("PANIC");
	});

	it("G5: 親の常駐サマリにも切り捨てと除外内訳を含める（Job Summary は 90 日で消える）", () => {
		const comment = renderParentSummaryComment({ envelope, plan });
		expect(comment.startsWith(PARENT_SUMMARY_MARKER)).toBe(true);
		expect(comment).toContain("除外内訳");
		expect(comment).toContain("expected_client_error");
		expect(comment).toContain("切り捨て: なし");
	});

	it("常駐サマリに繰り越し件数と最古の初観測を出す（starvation を隠さない）", () => {
		const many = Array.from({ length: 8 }, (_, index) => ({
			...rows[3],
			groupKey: { ...rows[3].groupKey, pathName: `/ja/auth/signup/${index}` },
			firstSeenUtc: `2026-08-0${index + 1}T00:00:00Z`,
			affectedUsers: 100 - index,
			anonymousOccurrences: 0,
		}));
		const cappedPlan = buildPlan({
			envelope: buildEnvelope({ rows: many, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY })
				.envelope,
			issues: [],
		});
		const comment = renderParentSummaryComment({ envelope, plan: cappedPlan });
		expect(comment).toContain("**繰り越し 3 件**");
		expect(comment).toMatch(/最古の初観測: `2026-08-0\dT00:00:00Z`/);
	});
});
