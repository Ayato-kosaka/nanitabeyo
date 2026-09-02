"use strict";

const existingIssues = require("./__fixtures__/existing-issues.json");
const rows = require("./__fixtures__/bq-rows.json");
const runSummary = require("./__fixtures__/run-summary.json");
const { CREATE_LIMIT, FP_ALGO_VERSION, GRACE_HOURS } = require("./constants");
const { computeFingerprint } = require("./fingerprint");
const {
	authoritative,
	buildEnvelope,
	buildIndex,
	buildPlan,
	classifyGroup,
	classifyQueue,
	isRegression,
	pendingAlgoVersions,
	pickCreations,
	validateEnvelope,
} = require("./triage");
const { computeWindow } = require("./window");

const GENERATED_AT = "2026-08-07T00:05:12Z";
const WINDOW = computeWindow({ now: GENERATED_AT });
const QUERY = { estimatedBytes: 78412345, maxBytesBilled: 200000000, totalRows: 1204 };

const makeEnvelope = (overrides = {}) =>
	buildEnvelope({
		rows,
		runSummary,
		window: WINDOW,
		generatedAt: GENERATED_AT,
		query: QUERY,
		...overrides,
	}).envelope;

const fp = Object.fromEntries(
	rows.map((row) => [row.groupKey.eventName ?? row.groupKey.apiName, computeFingerprint(row)]),
);

// #1202 を close した時点より後の commit。これが無いと「旧ビルド滞留」の抑止に落ちる。
const COMMIT_DATES_AFTER_CLOSE = { "9f2c1ab4d7e0": "2026-08-05T11:03:00Z", b7c2e91aa011: "2026-08-06T01:00:00Z" };

describe("buildEnvelope()", () => {
	it("SQL の1行 = 契約の1グループ（不変条件 1: JS 側で再グルーピングしない）", () => {
		const envelope = makeEnvelope();
		expect(envelope.groups).toHaveLength(rows.length);
	});

	it("同じ fingerprint の行が2つ来てもマージしない（affectedUsers を合算しない = B1）", () => {
		const duplicated = [rows[0], { ...rows[0], occurrences: 7, affectedUsers: 3 }];
		const { envelope } = buildEnvelope({
			rows: duplicated,
			runSummary,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			query: QUERY,
		});
		expect(envelope.groups).toHaveLength(2);
		expect(envelope.groups[0].fingerprint).toBe(envelope.groups[1].fingerprint);
		expect(envelope.groups.map((group) => group.affectedUsers)).toEqual([37, 3]);
	});

	it("未知の surface の行は破棄して警告する（不変条件 6）", () => {
		const { envelope, warnings } = buildEnvelope({
			rows: [...rows, { ...rows[0], surface: "mobile" }, { surface: null }],
			runSummary,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			query: QUERY,
		});
		expect(envelope.groups).toHaveLength(rows.length);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toMatch(/未知の surface/);
	});

	it("許可リスト射影なので SQL が余計な列を出しても契約に漏れない", () => {
		const leaky = [
			{
				...rows[0],
				userId: "e0a5f2c8-1111-2222-3333-444455556666",
				payload: { query: "ラーメン", lat: 35.6, lng: 139.7 },
				rawMessage: "生のスタックトレース",
			},
		];
		const { envelope } = buildEnvelope({
			rows: leaky,
			runSummary,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			query: QUERY,
		});
		const serialized = JSON.stringify(envelope.groups);
		expect(serialized).not.toContain("userId");
		expect(serialized).not.toContain("payload");
		expect(serialized).not.toContain("ラーメン");
		expect(serialized).not.toContain("rawMessage");
	});

	it("fpAlgoVersion / schemaVersion は JS が注入する（SQL は知らない = 矛盾B）", () => {
		const envelope = makeEnvelope();
		expect(envelope.schemaVersion).toBe(1);
		expect(envelope.fpAlgoVersion).toBe(FP_ALGO_VERSION);
	});

	it("truncated は LIMIT 適用「前」の総グループ数で判定する（G3 / S6）", () => {
		const notTruncated = buildEnvelope({
			rows,
			runSummary: { ...runSummary, groupCount: 500, groupLimit: 500 },
			window: WINDOW,
			generatedAt: GENERATED_AT,
			query: QUERY,
		}).envelope;
		expect(notTruncated.runSummary.truncated).toBe(false);

		const truncated = buildEnvelope({
			rows,
			runSummary: { ...runSummary, groupCount: 501, groupLimit: 500 },
			window: WINDOW,
			generatedAt: GENERATED_AT,
			query: QUERY,
		}).envelope;
		expect(truncated.runSummary.truncated).toBe(true);
	});

	it("excludedBreakdown は reason だけでなく eventName / httpStatus 単位で保持する（§6-4）", () => {
		const envelope = makeEnvelope();
		expect(envelope.runSummary.excludedBreakdown[0]).toEqual({
			reason: "expected_client_error",
			eventName: "HttpException",
			httpStatus: 404,
			count: 3011,
		});
	});
});

describe("validateEnvelope()", () => {
	it("fixture のエンベロープは妥当", () => {
		expect(validateEnvelope(makeEnvelope())).toMatchObject({ ok: true, errors: [] });
	});

	it("正規化されていない値が混ざっていたら不変条件 3 違反として落とす", () => {
		const envelope = makeEnvelope();
		envelope.groups[0].messagePattern = "TypeError at /v1/dish-media/9c1e77aa-2b31-41d0-9f2e-77aa2b3141d0/likes";
		const result = validateEnvelope(envelope);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toMatch(/messagePattern が正規化後の値ではありません/);
	});

	it("groupKey.route / endpoint / pathName も正規化後でなければ落とす", () => {
		for (const field of ["route", "endpoint", "pathName"]) {
			const envelope = makeEnvelope();
			envelope.groups[0].groupKey[field] = "/v1/items?key=AIzaSySECRET";
			expect(validateEnvelope(envelope).ok).toBe(false);
		}
	});

	it("fingerprint が 12桁小文字hex でなければ落とす", () => {
		const envelope = makeEnvelope();
		envelope.groups[0].fingerprint = "ABCDEF012345";
		expect(validateEnvelope(envelope).ok).toBe(false);
	});
});

describe("buildIndex() — 既存 Issue の索引", () => {
	const { index, warnings } = buildIndex(existingIssues);

	it("PR は索引に入れない（REST の list issues は PR も返す）", () => {
		expect(index.get(fp.UnhandledException).map((entry) => entry.number)).toEqual([1201]);
	});

	it("fp マーカーを持たない Issue（親 #1196 や手動起票）は索引に載らない", () => {
		const numbers = [...index.values()].flat().map((entry) => entry.number);
		expect(numbers).not.toContain(1196);
		expect(numbers).not.toContain(1211);
	});

	it("コードブロック内の桁数違い・大文字・行途中のマーカーを誤検出しない", () => {
		expect(index.has("zzzzzzzzzzzz")).toBe(false);
		expect(index.has("799742528a3")).toBe(false);
	});

	it("1つの body に複数 fp があれば全ての fp に登録して警告する（安全側＝起票しない側）", () => {
		expect(index.get("aaaaaaaaaaaa")[0].number).toBe(1212);
		expect(index.get("bbbbbbbbbbbb")[0].number).toBe(1212);
		expect(warnings.join("\n")).toMatch(/#1212 に複数の fingerprint/);
	});

	it("state / stateReason / labels / closedAt / algoVersion を取り出す", () => {
		const entry = index.get(fp["Claude API"])[0];
		expect(entry).toMatchObject({
			number: 1203,
			id: 3000004,
			state: "closed",
			stateReason: "not_planned",
			closedAt: "2026-07-20T00:00:00Z",
			algoVersion: FP_ALGO_VERSION,
		});
		expect(entry.labels).toContain("err/skip");
	});
});

describe("authoritative() — 同一 fp に複数 Issue（#1198 §1-D）", () => {
	const entries = [
		{ number: 30, state: "open", labels: [] },
		{ number: 10, state: "closed", labels: [] },
		{ number: 20, state: "closed", labels: ["err/skip"] },
		{ number: 40, state: "open", labels: [] },
	];

	it("err/skip → open → closed の順で、同順位は番号の若い方", () => {
		expect(authoritative(entries).number).toBe(20);
		expect(authoritative(entries.filter((e) => e.number !== 20)).number).toBe(30);
	});

	it("空なら null", () => {
		expect(authoritative([])).toBeNull();
		expect(authoritative(undefined)).toBeNull();
	});
});

describe("isRegression() — hourlyCounts ベース（矛盾B / S5）", () => {
	const group = {
		fingerprint: "0011aabbccdd",
		lastSeenUtc: "2026-08-06T23:00:00Z",
		affectedUsers: 9,
		commits: [{ sha: "9f2c1ab4d7e0", count: 58 }],
		hourlyCounts: [
			{ hourUtc: "2026-08-05T20:00:00Z", count: 40 },
			{ hourUtc: "2026-08-06T12:00:00Z", count: 3 },
			{ hourUtc: "2026-08-06T23:00:00Z", count: 15 },
		],
	};
	const entry = {
		number: 1188,
		state: "closed",
		stateReason: "completed",
		closedAt: "2026-08-05T00:00:00Z",
		labels: [],
	};

	it("close + 24h 以降に MIN_EVENTS_REOPEN 件以上出ていれば回帰", () => {
		const result = isRegression({ group, entry, commitDates: COMMIT_DATES_AFTER_CLOSE });
		expect(result.regression).toBe(true);
		// 閾値 2026-08-06T00:00Z 以降のバケットだけ数える（2026-08-05T20:00 の 40 件は数えない）
		expect(result.eventsAfterGrace).toBe(18);
	});

	it("猶予内（close + 24h 以内）の再出現は回帰にしない", () => {
		const cooling = { ...entry, closedAt: "2026-08-06T12:00:00Z" };
		const result = isRegression({ group, entry: cooling, commitDates: COMMIT_DATES_AFTER_CLOSE });
		expect(result.regression).toBe(false);
		expect(result.reason).toMatch(new RegExp(`close \\+ ${GRACE_HOURS}h 以内`));
	});

	it("猶予後の件数がノイズ閾値未満なら回帰にしない", () => {
		const quiet = { ...group, hourlyCounts: [{ hourUtc: "2026-08-06T23:00:00Z", count: 2 }] };
		expect(isRegression({ group: quiet, entry, commitDates: COMMIT_DATES_AFTER_CLOSE }).regression).toBe(false);
	});

	it("時間バケットの境界合わせは切り捨て方向（過小＝reopen しない側）", () => {
		const straddling = {
			...group,
			hourlyCounts: [{ hourUtc: "2026-08-05T23:00:00Z", count: 100 }],
			lastSeenUtc: "2026-08-05T23:59:00Z",
		};
		// 閾値 2026-08-06T00:00Z。バケット開始が閾値より前なので数えない。
		const result = isRegression({ group: straddling, entry, commitDates: COMMIT_DATES_AFTER_CLOSE });
		expect(result.eventsAfterGrace).toBe(0);
		expect(result.regression).toBe(false);
	});

	it("全 commit が close 以前なら旧ビルド滞留として抑止する", () => {
		const result = isRegression({
			group,
			entry,
			commitDates: { "9f2c1ab4d7e0": "2026-08-01T00:00:00Z" },
		});
		expect(result.regression).toBe(false);
		expect(result.reason).toMatch(/旧ビルド滞留/);
	});

	it("commit 日時が1つも解決できないときは時刻ルールだけで判定する", () => {
		expect(isRegression({ group, entry, commitDates: {} }).regression).toBe(true);
	});

	it("closedAt が無ければ回帰にしない（防御的）", () => {
		expect(isRegression({ group, entry: { ...entry, closedAt: null } }).regression).toBe(false);
	});

	it("時刻比較はすべて UTC 基準（JST 表記の closedAt でもずれない）", () => {
		const jst = { ...entry, closedAt: "2026-08-05T09:00:00+09:00" }; // = 2026-08-05T00:00:00Z
		expect(isRegression({ group, entry: jst, commitDates: COMMIT_DATES_AFTER_CLOSE })).toEqual(
			isRegression({ group, entry, commitDates: COMMIT_DATES_AFTER_CLOSE }),
		);
	});
});

describe("classifyGroup() — 状態遷移表（#1198 §1-E）", () => {
	const envelope = makeEnvelope();
	const { index } = buildIndex(existingIssues);
	const classify = (eventNameOrApi) => {
		const group = envelope.groups.find((g) => (g.groupKey.eventName ?? g.groupKey.apiName) === eventNameOrApi);
		return classifyGroup({
			group,
			entry: authoritative(index.get(group.fingerprint)),
			commitDates: COMMIT_DATES_AFTER_CLOSE,
		});
	};

	it("未知 fingerprint → create", () => {
		expect(classify("signup_failed")).toMatchObject({
			action: "create",
			reason: "unknown-fingerprint",
			issueNumber: null,
		});
	});

	it("既知かつ open → noop-open（コメントしない）", () => {
		expect(classify("UnhandledException")).toMatchObject({ action: "noop-open", issueNumber: 1201 });
	});

	it("closed(completed) かつ close から 24h 超で再出現 → reopen", () => {
		expect(classify("api_call_error")).toMatchObject({ action: "reopen", issueNumber: 1202 });
	});

	it("closed かつ猶予内 → noop-cooldown", () => {
		expect(classify("JSONParseError")).toMatchObject({ action: "noop-cooldown", issueNumber: 1204 });
	});

	it("err/skip ラベル付きは open / closed いずれでも常に noop-skip", () => {
		expect(classify("Claude API")).toMatchObject({ action: "noop-skip", issueNumber: 1203 });
		const group = envelope.groups[0];
		expect(
			classifyGroup({ group, entry: { number: 9, state: "open", labels: ["err/skip"], closedAt: null } }),
		).toMatchObject({ action: "noop-skip" });
	});

	it("closed(not planned) は reopen しない", () => {
		expect(classify("UnknownException")).toMatchObject({ action: "noop-wontfix", issueNumber: 1205 });
	});
});

describe("pickCreations() — S4: 識別済み / 匿名 のラウンドロビン", () => {
	const candidate = (fingerprint, affectedUsers, anonymousOccurrences, occurrences) => ({
		fingerprint,
		surface: "frontend",
		affectedUsers,
		anonymousOccurrences,
		occurrences,
		firstSeenUtc: "2026-08-06T00:00:00Z",
	});

	// 未認証経路（サインアップ・ログイン）の障害は user_id が NULL なので affectedUsers = 0 になる。
	// 影響ユーザー数だけで並べると、新規ユーザー全員に影響する最悪のバグが常に最下位に沈む。
	const candidates = [
		candidate("i1aaaaaaaaaa", 100, 0, 100),
		candidate("i2aaaaaaaaaa", 50, 0, 50),
		candidate("i3aaaaaaaaaa", 10, 0, 10),
		candidate("a1aaaaaaaaaa", 0, 500, 500),
		candidate("a2aaaaaaaaaa", 0, 300, 300),
	];

	it("affectedUsers == 0 && anonymousOccurrences > 0 は別キューになる", () => {
		expect(classifyQueue(candidates[0])).toBe("identified");
		expect(classifyQueue(candidates[3])).toBe("anonymous");
	});

	it("枠を識別済み / 匿名 で交互に配る", () => {
		const { picked } = pickCreations(candidates, { limit: 4 });
		expect(picked.map((c) => c.fingerprint)).toEqual(["i1aaaaaaaaaa", "a1aaaaaaaaaa", "i2aaaaaaaaaa", "a2aaaaaaaaaa"]);
	});

	it("枠が2件しかなくても匿名キューが1件は取れる（最下位に沈まない）", () => {
		const { picked } = pickCreations(candidates, { limit: 2 });
		expect(picked.map((c) => classifyQueue(c))).toEqual(["identified", "anonymous"]);
	});

	it("識別済みキュー内は 影響ユーザー数 → 件数 → 初観測 → fingerprint の順", () => {
		const tie = [
			candidate("bbbbbbbbbbbb", 10, 0, 10),
			candidate("aaaaaaaaaaaa", 10, 0, 10),
			candidate("cccccccccccc", 10, 0, 99),
		];
		const { picked } = pickCreations(tie, { limit: 3 });
		expect(picked.map((c) => c.fingerprint)).toEqual(["cccccccccccc", "aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
	});

	it("匿名キュー内は anonymousOccurrences の降順", () => {
		const anonymousOnly = [candidate("a2aaaaaaaaaa", 0, 300, 300), candidate("a1aaaaaaaaaa", 0, 500, 500)];
		const { picked } = pickCreations(anonymousOnly, { limit: 2 });
		expect(picked.map((c) => c.fingerprint)).toEqual(["a1aaaaaaaaaa", "a2aaaaaaaaaa"]);
	});

	it("片方のキューが空でももう片方で枠を埋めきる", () => {
		const identifiedOnly = candidates.slice(0, 3);
		const { picked, deferred } = pickCreations(identifiedOnly, { limit: 5 });
		expect(picked).toHaveLength(3);
		expect(deferred).toHaveLength(0);
	});

	it("溢れた分は deferred（黙って切り捨てない）", () => {
		const { picked, deferred } = pickCreations(candidates, { limit: 2 });
		expect(picked).toHaveLength(2);
		expect(deferred).toHaveLength(3);
	});

	it("既定の上限は CREATE_LIMIT", () => {
		expect(pickCreations(candidates).picked).toHaveLength(Math.min(CREATE_LIMIT, candidates.length));
	});

	it("同じ入力に対して決定的", () => {
		const first = pickCreations(candidates, { limit: 3 }).picked.map((c) => c.fingerprint);
		const second = pickCreations([...candidates].reverse(), { limit: 3 }).picked.map((c) => c.fingerprint);
		expect(second).toEqual(first);
	});
});

describe("buildPlan()", () => {
	const plan = buildPlan({
		envelope: makeEnvelope(),
		issues: existingIssues,
		commitDates: COMMIT_DATES_AFTER_CLOSE,
	});

	it("全グループが必ずどれか1つの action に落ちる", () => {
		expect(plan.items).toHaveLength(rows.length);
	});

	it("fixture の期待どおりに分類される", () => {
		const byFingerprint = Object.fromEntries(plan.items.map((item) => [item.fingerprint, item.action]));
		expect(byFingerprint[fp.signup_failed]).toBe("create");
		expect(byFingerprint[fp.UnhandledException]).toBe("noop-open");
		expect(byFingerprint[fp.api_call_error]).toBe("reopen");
		expect(byFingerprint[fp.JSONParseError]).toBe("noop-cooldown");
		expect(byFingerprint[fp["Claude API"]]).toBe("noop-skip");
		expect(byFingerprint[fp.UnknownException]).toBe("noop-wontfix");
	});

	it("counts に action 別と集計の両方が入る", () => {
		expect(plan.counts).toMatchObject({ create: 1, reopen: 1, capped: 0, invalid: 0, noop: 4 });
		expect(plan.counts["noop-skip"]).toBe(1);
	});

	it("起票上限を超えた分は capped として必ず可視化され、次回 run へ繰り越される", () => {
		const many = Array.from({ length: 8 }, (_, index) => ({
			...rows[3],
			groupKey: { ...rows[3].groupKey, pathName: `/auth/signup/${index}` },
			affectedUsers: 100 - index,
			anonymousOccurrences: 0,
		}));
		// 上限は明示的に渡す。CREATE_LIMIT の実値（オーナー判断で 5 → 20）を変えても、
		// 「溢れた分は capped として可視化される」という性質のテストは壊れてはいけない。
		const capped = buildPlan({
			envelope: buildEnvelope({ rows: many, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY })
				.envelope,
			issues: [],
			limits: { createLimit: 5 },
		});
		expect(capped.counts.create).toBe(5);
		expect(capped.counts.capped).toBe(3);
		expect(capped.deferred).toHaveLength(3);
	});

	it("既定の CREATE_LIMIT は 20（オーナー判断。実データの 21 グループを初回20件・翌日1件で捌く）", () => {
		expect(CREATE_LIMIT).toBe(20);
	});

	it("未知 fingerprint が PANIC 閾値を超えたら1件も起票しない（#1198 §3）", () => {
		const many = Array.from({ length: 12 }, (_, index) => ({
			...rows[3],
			groupKey: { ...rows[3].groupKey, pathName: `/auth/signup/${index}` },
		}));
		const panicked = buildPlan({
			envelope: buildEnvelope({ rows: many, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY })
				.envelope,
			issues: [],
			limits: { panicThreshold: 10 },
		});
		expect(panicked.panic).toBe(true);
		expect(panicked.counts.create).toBe(0);
		expect(panicked.counts.capped).toBe(12);
		expect(panicked.items[0].reason).toMatch(/PANIC/);
	});

	it("reopen 上限を超えた分も capped になる（回帰は起票より優先だが黙って落とさない）", () => {
		const regressing = Array.from({ length: 3 }, (_, index) => ({
			...rows[1],
			groupKey: { ...rows[1].groupKey, pathName: `/p/${index}` },
			affectedUsers: 30 - index,
		}));
		const issues = regressing.map((row, index) => ({
			number: 2000 + index,
			id: 4000 + index,
			state: "closed",
			state_reason: "completed",
			labels: [{ name: "error-triage" }],
			closed_at: "2026-08-04T00:00:00Z",
			body: `<!-- fp:${computeFingerprint(row)} -->\n<!-- fpalgo:1 -->`,
		}));
		const plan2 = buildPlan({
			envelope: buildEnvelope({ rows: regressing, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY })
				.envelope,
			issues,
			commitDates: COMMIT_DATES_AFTER_CLOSE,
			limits: { reopenLimit: 2 },
		});
		expect(plan2.counts.reopen).toBe(2);
		expect(plan2.counts.capped).toBe(1);
	});

	it("エンベロープの検証結果を計画に持ち回る（書き込み前に気づけるようにする）", () => {
		expect(plan.valid).toBe(true);
		expect(plan.errors).toEqual([]);
	});

	it("索引の警告を計画に持ち回る", () => {
		expect(plan.warnings.join("\n")).toMatch(/#1212 に複数の fingerprint/);
	});

	// ★ N-2（PR #1200 レビュー）: 旧テストは `JSON.parse(JSON.stringify(plan))` が
	//   throw しないことだけを見ており、循環参照が無いことしか示していなかった（副作用の有無と無関係）。
	//   入力のディープコピーを取って前後比較する形にして、名前どおりの意味を持たせる。
	it("書き込み系の副作用を一切持たない（入力を1バイトも書き換えない）", () => {
		const envelope = makeEnvelope();
		const commitDates = { ...COMMIT_DATES_AFTER_CLOSE };
		const inputs = { envelope, issues: existingIssues, commitDates };
		const before = JSON.parse(JSON.stringify(inputs));

		buildPlan(inputs);

		expect(JSON.parse(JSON.stringify(inputs))).toEqual(before);
	});

	it("戻り値は入力とオブジェクトを共有しない（あとで書き換えても入力へ波及しない）", () => {
		const envelope = makeEnvelope();
		const built = buildPlan({ envelope, issues: existingIssues, commitDates: COMMIT_DATES_AFTER_CLOSE });
		const target = built.items.find((item) => item.fingerprint === envelope.groups[0].fingerprint);

		target.reason = "書き換えた";
		target.occurrences = -1;

		expect(envelope.groups[0].occurrences).toBe(rows[0].occurrences);
		expect(envelope.groups[0].reason).toBeUndefined();
	});

	it("同じ入力で2回呼んでも同じ計画になる（1回目の呼び出しが状態を残さない）", () => {
		const envelope = makeEnvelope();
		const args = { envelope, issues: existingIssues, commitDates: COMMIT_DATES_AFTER_CLOSE };
		expect(buildPlan(args)).toEqual(buildPlan(args));
	});
});

describe("checkAlgoVersions()（#1198 §8-A の安全装置）", () => {
	const { checkAlgoVersions } = require("./triage");

	it("索引が空（初回）なら不一致にしない", () => {
		expect(checkAlgoVersions(new Map())).toEqual({ ok: true, versions: [], message: null });
	});

	it("全部が現行世代なら通す", () => {
		const { index } = buildIndex(existingIssues);
		expect(checkAlgoVersions(index).ok).toBe(true);
	});

	it("移行可能な旧世代（SUPPORTED_ALGO_VERSIONS）は止めない — 旧 fingerprint を復元して突合できるため", () => {
		const tampered = existingIssues.map((issue) =>
			issue.number === 1201 ? { ...issue, body: String(issue.body).replace("fpalgo:2", "fpalgo:1") } : issue,
		);
		const { index } = buildIndex(tampered);
		const result = checkAlgoVersions(index);
		expect(result.ok).toBe(true);
		expect(result.versions).toEqual([1, 2]);
		// 止めはしないが「移行待ちが残っている」ことは必ず見える
		expect(pendingAlgoVersions(index)).toEqual([1]);
	});

	it("復元器を持たない世代（未知の世代）が1件でもあれば止める（全件再起票を構造的に防ぐ）", () => {
		const tampered = existingIssues.map((issue) =>
			issue.number === 1201 ? { ...issue, body: String(issue.body).replace("fpalgo:2", "fpalgo:99") } : issue,
		);
		const { index } = buildIndex(tampered);
		const result = checkAlgoVersions(index);
		expect(result.ok).toBe(false);
		expect(result.versions).toEqual([2, 99]);
		expect(result.message).toContain("未知の世代 99");
	});

	it("buildPlan は不一致のとき abort を立て、create も reopen も 0 件にする", () => {
		const tampered = existingIssues.map((issue) =>
			issue.number === 1202 ? { ...issue, body: String(issue.body).replace("fpalgo:2", "fpalgo:99") } : issue,
		);
		const plan = buildPlan({
			envelope: buildEnvelope({ rows, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY }).envelope,
			issues: tampered,
		});
		expect(plan.abort).toBe(true);
		expect(plan.abortReason).toContain("fpalgo 不一致");
		expect(plan.counts.create).toBe(0);
		expect(plan.counts.reopen).toBe(0);
		expect(plan.warnings.join("\n")).toContain("fpalgo 不一致");
	});

	it("通常時は abort が立たない", () => {
		const plan = buildPlan({
			envelope: buildEnvelope({ rows, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY }).envelope,
			issues: existingIssues,
		});
		expect(plan.abort).toBe(false);
		expect(plan.abortReason).toBeNull();
	});
});
