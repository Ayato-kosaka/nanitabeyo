// #1196 error-triage / fingerprint 世代の移行（fpalgo 1 → 2）のテスト。
//
// CLUSTERING.md 末尾の未解決課題:
//   > fingerprint の定義を変えると FP_ALGO_VERSION を上げることになり、
//   > **既存 Issue との突合が全部外れて全件が新規起票される**。移行方針を決めてから行う。
//
// このファイルが守る不変条件は1つだけ:
//   **既存 Issue（ロケールで割れていた #1214〜#1241 のような群）を1件も重複起票しない。**
//
// 併せて、移行処理の冪等性（何度実行しても同じ結果 / 2回目は API を叩かない）と、
// `--dry-run` で移行の影響を事前に読めることを固定する。

"use strict";

const { CREATE_LIMIT, FP_ALGO_VERSION, REKEY_LIMIT, SKIP_LABEL, TRIAGE_LABEL } = require("./constants");
const { computeFingerprint, computeLegacyFingerprints } = require("./fingerprint");
const { applyPlan } = require("./github");
const { normalizePathName, restorePathLocale } = require("./normalize-rules");
const {
	extractAlgoVersion,
	extractFingerprints,
	rekeyIssueBody,
	renderIssueBody,
	renderJobSummary,
} = require("./render");
const { buildEnvelope, buildIndex, buildPlan, resolveEntry } = require("./triage");
const { computeWindow } = require("./window");

const GENERATED_AT = "2026-08-07T00:05:12Z";
const WINDOW = computeWindow({ now: GENERATED_AT });
const QUERY = { estimatedBytes: 665800, maxBytesBilled: 200000000, totalRows: 4 };

/** CLUSTERING.md 類型1 の実例（#1221 / #1226 / #1229 / #1236）と同じ形。 */
const LOCALES = [
	{ locale: "ja-JP", count: 40 },
	{ locale: "en-IE", count: 20 },
	{ locale: "ja", count: 8 },
	{ locale: "en-US", count: 5 },
];

const GROUP_ROW = {
	surface: "frontend",
	groupKey: {
		eventName: "api_call_error",
		pathName: normalizePathName("/ja-JP/search/result"),
		functionName: null,
		apiName: null,
		endpoint: null,
		method: null,
		statusCode: null,
		httpStatus: 500,
		route: "/v<n>/dishes/bulk-import",
		errorCode: null,
	},
	messagePattern: "Internal server error",
	occurrences: 73,
	affectedUsers: 51,
	anonymousOccurrences: 0,
	firstSeenUtc: "2026-08-06T01:00:00Z",
	lastSeenUtc: "2026-08-06T23:00:00Z",
	hourlyCounts: [{ hourUtc: "2026-08-06T01:00:00Z", count: 73 }],
	commits: [{ sha: "9f2c1ab4d7e0", count: 73 }],
	appVersions: ["1.4.3"],
	localeCounts: LOCALES,
	representativeCommit: "9f2c1ab4d7e0",
};

const RUN_SUMMARY = { groupCount: 1, groupLimit: 500, keptRows: 73, excludedRows: 0, excludedBreakdown: [] };

const makeEnvelope = (rows = [GROUP_ROW]) =>
	buildEnvelope({ rows, runSummary: RUN_SUMMARY, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY }).envelope;

const NEW_FP = computeFingerprint(GROUP_ROW);

/** v1（fpalgo 1）で、この group がロケールごとに持っていたはずの fingerprint。 */
const legacyFingerprintOf = (locale) =>
	computeFingerprint({
		...GROUP_ROW,
		groupKey: { ...GROUP_ROW.groupKey, pathName: restorePathLocale(locale, GROUP_ROW.groupKey.pathName) },
	});

/**
 * 移行前（fpalgo 1）の既存 Issue 群。ロケールごとに1件ずつ割れている＝初回起票の実態。
 *
 * @param {{overrides?: Record<number, Record<string, any>>}} params
 */
const legacyIssues = ({ overrides = {} } = {}) =>
	LOCALES.map((entry, index) => {
		const number = 1221 + index;
		return {
			number,
			id: 3100000 + index,
			state: "open",
			state_reason: null,
			// 実際の Issue は renderTitle() が付けた `[err/<surface>]` を先頭に持つ。
			// buildIndex がここから surface を読む（Major-1 の保留判定に使う）。
			title: `[err/frontend] /${entry.locale}/search/result: api_call_error: Internal server error (fp:${legacyFingerprintOf(entry.locale)})`,
			labels: [{ name: TRIAGE_LABEL }],
			closed_at: null,
			updated_at: "2026-08-06T00:00:00Z",
			body: [
				`<!-- fp:${legacyFingerprintOf(entry.locale)} -->`,
				"<!-- fpalgo:1 -->",
				"<!-- error-triage:auto:start -->",
				"<!-- firstSeen:2026-08-01T00:00:00Z -->",
				"",
				"|  |  |",
				"|---|---|",
				"| **どれだけ** | **20 件** / 影響ユーザー 12 人 |",
				"<!-- error-triage:auto:end -->",
				"",
				"---",
				"",
				`人間のメモ: ${entry.locale} の調査中。消さないこと。`,
			].join("\n"),
			...(overrides[number] || {}),
		};
	});

// ---------------------------------------------------------------------------
// 1) 旧 fingerprint の復元
// ---------------------------------------------------------------------------

describe("computeLegacyFingerprints() — v1 の fingerprint を出力だけから復元する", () => {
	const group = { ...GROUP_ROW, fingerprint: NEW_FP };

	it("localeCounts のロケールぶんだけ復元する", () => {
		expect(computeLegacyFingerprints(group).map((entry) => entry.locale)).toEqual(["ja-JP", "en-IE", "ja", "en-US"]);
	});

	it("復元した fingerprint は「ロケール付き pathName で計算した v1 の値」と一致する", () => {
		for (const { locale } of LOCALES) {
			const restored = computeLegacyFingerprints(group).find((entry) => entry.locale === locale);
			expect(restored.fingerprint).toBe(legacyFingerprintOf(locale));
			expect(restored.pathName).toBe(`/${locale}/search/result`);
		}
	});

	it("件数の多いロケール順（決定的。run ごとに順序がぶれない）", () => {
		expect(computeLegacyFingerprints(group).map((entry) => entry.count)).toEqual([40, 20, 8, 5]);
	});

	it("現行 fingerprint と同じものは返さない（自分自身をリキー対象にしない）", () => {
		expect(computeLegacyFingerprints(group).map((entry) => entry.fingerprint)).not.toContain(NEW_FP);
	});

	it("backend / external は復元対象が無い（v1 と v2 で fingerprint が同一）", () => {
		expect(computeLegacyFingerprints({ ...group, surface: "backend" })).toEqual([]);
		expect(computeLegacyFingerprints({ ...group, surface: "external" })).toEqual([]);
	});

	it("ロケール接頭辞が無かったグループ（locale: null）は復元しない", () => {
		expect(computeLegacyFingerprints({ ...group, localeCounts: [{ locale: null, count: 73 }] })).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 2) ★ 中核の要件: 重複起票しない
// ---------------------------------------------------------------------------

describe("★ 既存 Issue が重複起票されない（マージできない変更の唯一の条件）", () => {
	const plan = buildPlan({ envelope: makeEnvelope(), issues: legacyIssues() });

	it("新規起票は0件（4件の旧 Issue が新 fingerprint に対応づく）", () => {
		expect(plan.counts.create).toBe(0);
		expect(plan.items.map((item) => item.action)).toEqual(["noop-open"]);
	});

	it("突合は旧 fingerprint の復元で成立している", () => {
		expect(plan.items[0].matchedBy).toBe("legacy");
		expect(plan.items[0].fingerprint).toBe(NEW_FP);
		// 決定的に1件へ寄せる: 全部 open なので issue number の昇順で最古（#1221）
		expect(plan.items[0].issueNumber).toBe(1221);
		expect(plan.items[0].reason).toContain("旧 fingerprint");
	});

	it("旧世代が残っていても abort しない（abort したら誰も移行できない）", () => {
		expect(plan.abort).toBe(false);
		expect(plan.pendingAlgoVersions).toEqual([1]);
		expect(plan.warnings.join("\n")).toContain("重複起票にはなりません");
	});

	it("移行前の実装（旧 fingerprint を復元しない）なら重複起票になっていた、の裏取り", () => {
		const { index } = buildIndex(legacyIssues());
		// 現行 fingerprint だけで索引を引くと当たらない ＝ 「未知」＝ 新規起票
		expect(index.get(NEW_FP)).toBeUndefined();
		// 復元を通すと当たる
		expect(resolveEntry({ index, group: makeEnvelope().groups[0] }).entry.number).toBe(1221);
	});

	it("旧 Issue が1件も無ければ普通に新規起票する（移行機構が起票を止めてしまわない）", () => {
		const fresh = buildPlan({ envelope: makeEnvelope(), issues: [] });
		expect(fresh.counts.create).toBe(1);
		expect(fresh.items[0].matchedBy).toBe("none");
	});

	it("現行世代の Issue を旧 fingerprint で横取りしない（衝突時の安全弁）", () => {
		// 旧 fingerprint を持つが、マーカーは既に現行世代 ＝ 別グループの Issue とみなす
		const migrated = legacyIssues().map((issue) => ({
			...issue,
			body: String(issue.body).replace("fpalgo:1", `fpalgo:${FP_ALGO_VERSION}`),
		}));
		const plan2 = buildPlan({ envelope: makeEnvelope(), issues: migrated });
		expect(plan2.counts.create).toBe(1);
		expect(plan2.rekeys).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 2-b) ★ Major-1（PR #1256 レビュー）: 旧 Issue のロケールがその run に無いとき
// ---------------------------------------------------------------------------
//
// レビューが実行して確かめた事実:
//   旧 fingerprint の復元は **その run の `localeCounts` に載っているロケールぶんだけ**。
//     ar が窓に含まれる       => matchedBy: legacy | create:0 | rekeys:1
//     hi だけ（ar が窓に無い） => matchedBy: none   | create:1 | rekeys:0  ← 重複起票
//   起票された瞬間から現行 fingerprint が先に当たるので、**旧 Issue は永久に孤児化する**。
//   同じ穴は `LOCALE_BREAKDOWN_LIMIT` でロケールが溢れたときにも開く。

describe("★ 旧 Issue のロケールが localeCounts に無い run（Major-1 の穴）", () => {
	/** 実データの #1250（`/ar/contribution-tasks/dish-ranking-summary`）と同じ形の旧 Issue。 */
	const arIssue = (overrides = {}) => ({
		number: 1250,
		id: 3200000,
		state: "open",
		state_reason: null,
		title: `[err/frontend] /search/result: api_call_error: Internal server error (fp:${legacyFingerprintOf("ar")})`,
		labels: [{ name: TRIAGE_LABEL }],
		closed_at: null,
		updated_at: "2026-08-06T00:00:00Z",
		body: `<!-- fp:${legacyFingerprintOf("ar")} -->\n<!-- fpalgo:1 -->\n人間のメモ`,
		...overrides,
	});

	/** この run の窓には `hi` しか出ていない ＝ `ar` の旧 fingerprint は復元候補にすら入らない。 */
	const hiOnly = makeEnvelope([{ ...GROUP_ROW, localeCounts: [{ locale: "hi", count: 5 }] }]);

	it("前提: 復元候補は localeCounts のロケールぶんだけなので、#1250 には当たらない", () => {
		expect(computeLegacyFingerprints(hiOnly.groups[0]).map((entry) => entry.locale)).toEqual(["hi"]);
		const { index } = buildIndex([arIssue()]);
		expect(resolveEntry({ index, group: hiOnly.groups[0] }).matchedBy).toBe("none");
	});

	it("★ それでも新規起票しない（保留する）。#1250 を孤児化させないことが要件", () => {
		const plan = buildPlan({ envelope: hiOnly, issues: [arIssue()] });
		expect(plan.counts.create).toBe(0);
		expect(plan.items.map((item) => item.action)).toEqual(["withheld"]);
	});

	it("保留したことは必ず数えられ、理由になっている Issue 番号まで出る（移行完了を人間が判定できる）", () => {
		const plan = buildPlan({ envelope: hiOnly, issues: [arIssue()] });
		expect(plan.counts.withheld).toBe(1);
		expect(plan.migrationPending).toBe(true);
		expect(plan.migrationBlockers.map((entry) => entry.number)).toEqual([1250]);
		expect(plan.withheld).toHaveLength(1);
		expect(plan.warnings.join("\n")).toContain("#1250");

		const summary = renderJobSummary({ envelope: hiOnly, plan, mode: "apply" });
		expect(summary).toContain("withheld 1");
		expect(summary).toContain("#1250");
		expect(summary).toContain("保留");
	});

	it("apply しても GitHub には1件も起票されない", async () => {
		const issues = [arIssue()];
		const client = makeClient(issues);
		const plan = buildPlan({ envelope: hiOnly, issues });
		const applyResult = await applyPlan({
			client,
			envelope: hiOnly,
			plan,
			issues,
			subIssues: { ok: true, ids: new Set(), numbers: new Set(), count: 0, error: null },
			parentIssue: 1196,
			sleepImpl: async () => {},
		});
		expect(applyResult.created).toHaveLength(0);
		expect(client.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
	});

	it("旧 Issue が1件も無ければ普通に起票する（保留が定常状態を止めてしまわない）", () => {
		expect(buildPlan({ envelope: hiOnly, issues: [] }).counts.create).toBe(1);
	});

	it("backend の起票は保留しない（keyPathName が常に NULL で v1 = v2 なので孤児化し得ない）", () => {
		const backend = makeEnvelope([
			{ ...GROUP_ROW, surface: "backend", groupKey: { ...GROUP_ROW.groupKey, functionName: "ApiExceptionFilter" } },
		]);
		const plan = buildPlan({ envelope: backend, issues: [arIssue()] });
		expect(plan.migrationPending).toBe(true);
		expect(plan.counts.create).toBe(1);
		expect(plan.counts.withheld).toBe(0);
	});

	it("旧 Issue が全て突合できた run では保留しない（＝保留は勝手に解ける）", () => {
		// `ar` が窓に出た run。#1250 は legacy 突合されるので、別の未知グループは普通に起票される。
		const withAr = makeEnvelope([
			{ ...GROUP_ROW, localeCounts: [{ locale: "ar", count: 5 }] },
			{
				...GROUP_ROW,
				groupKey: { ...GROUP_ROW.groupKey, pathName: "/profile/settings" },
				localeCounts: [{ locale: "hi", count: 2 }],
			},
		]);
		const plan = buildPlan({ envelope: withAr, issues: [arIssue()] });
		expect(plan.migrationBlockers).toEqual([]);
		expect(plan.migrationPending).toBe(false);
		expect(plan.counts.withheld).toBe(0);
		expect(plan.counts.create).toBe(1);
		expect(plan.rekeys.map((rekey) => rekey.issueNumber)).toEqual([1250]);
	});

	// ↓ ここから下は「保留が永久に解けなくなる」経路を塞ぐためのテスト。
	//   起票が永久に止まる方が、旧 Issue 1件の孤児化よりはるかに被害が大きい。

	it("backend / external の旧 Issue は保留の理由にしない（マーカーは永久に fpalgo 1 のまま残るため）", () => {
		// backend は現行 fingerprint でそのまま当たる（matchedBy: current）ので**リキー計画に載らない**。
		// つまり `pendingAlgoVersions` はこの Issue のせいで永久に空にならない。
		// ここを保留条件にすると frontend の起票が永久に止まる。
		const backendOld = arIssue({
			number: 1230,
			title: "[err/backend] ApiExceptionFilter /v<n>/dishes/bulk-import: UnhandledException (fp:ffffffffffff)",
			body: "<!-- fp:ffffffffffff -->\n<!-- fpalgo:1 -->",
		});
		const plan = buildPlan({ envelope: hiOnly, issues: [backendOld] });
		expect(plan.pendingAlgoVersions).toEqual([1]); // マーカーは残っている
		expect(plan.migrationBlockers).toEqual([]); // が、保留の理由にはしない
		expect(plan.counts.create).toBe(1);
	});

	it("closed の旧 Issue は保留の理由にしない（二度と再発しない Issue が起票を永久に止めるのを避ける）", () => {
		const plan = buildPlan({
			envelope: hiOnly,
			issues: [arIssue({ state: "closed", state_reason: "completed", closed_at: "2026-07-01T00:00:00Z" })],
		});
		expect(plan.migrationBlockers).toEqual([]);
		expect(plan.counts.create).toBe(1);
	});

	it("タイトルから surface が読めない旧 Issue は安全側（frontend 扱い）で保留する", () => {
		const plan = buildPlan({ envelope: hiOnly, issues: [arIssue({ title: "人間が書き換えたタイトル" })] });
		expect(plan.migrationBlockers.map((entry) => entry.number)).toEqual([1250]);
		expect(plan.counts.withheld).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// 3) リキー計画（--dry-run で読めること）
// ---------------------------------------------------------------------------

describe("リキー計画 — --dry-run で移行の影響を事前に読める", () => {
	const plan = buildPlan({ envelope: makeEnvelope(), issues: legacyIssues() });

	it("旧 fingerprint で当たった Issue を**全件**リキー対象にする（片方だけ書き換えて孤児を残さない）", () => {
		expect(plan.rekeys.map((rekey) => rekey.issueNumber)).toEqual([1221, 1222, 1223, 1224]);
		for (const rekey of plan.rekeys) {
			expect(rekey.to).toBe(NEW_FP);
			expect(rekey.fromAlgoVersion).toBe(1);
			expect(rekey.toAlgoVersion).toBe(FP_ALGO_VERSION);
		}
	});

	it("Job Summary に「どの Issue がどこへ統合されるか」の表が出る", () => {
		const summary = renderJobSummary({ envelope: makeEnvelope(), plan, mode: "apply --dry-run" });
		expect(summary).toContain("fingerprint のリキー");
		expect(summary).toContain("新規起票されません");
		for (const rekey of plan.rekeys) {
			expect(summary).toContain(`#${rekey.issueNumber}`);
			expect(summary).toContain(`\`${rekey.from}\``);
		}
	});

	// ★ Minor-3（PR #1256 レビュー）: 全員に同じ「このIssueに統合されます」を出すと、
	//   人間は「duplicate として close せよ」と言われてもどれを残すか判断できない。
	it("リキー計画は代表 Issue 番号を持つ（authoritative() が決定的に選ぶ #1221）", () => {
		for (const rekey of plan.rekeys) expect(rekey.authoritativeNumber).toBe(1221);
	});

	it("Job Summary のリキー表に統合先の列が出て、代表がどれか分かる", () => {
		const summary = renderJobSummary({ envelope: makeEnvelope(), plan, mode: "apply --dry-run" });
		expect(summary).toContain("統合先");
		expect(summary).toContain("**このIssueが代表**"); // #1221 の行
		expect(summary).toContain("| #1222 |");
		const row1222 = summary.split("\n").find((line) => line.startsWith("| #1222 |"));
		expect(row1222).toContain("#1221");
	});

	it("1 run のリキー件数には上限がある。溢れても重複起票にはならない", () => {
		const capped = buildPlan({ envelope: makeEnvelope(), issues: legacyIssues(), limits: { rekeyLimit: 2 } });
		expect(capped.rekeys).toHaveLength(2);
		expect(capped.deferredRekeys).toHaveLength(2);
		expect(capped.counts.create).toBe(0); // ← ここが要点
		expect(capped.warnings.join("\n")).toContain("次回 run");
		expect(REKEY_LIMIT).toBeGreaterThan(CREATE_LIMIT);
	});

	it("`err/skip` 付きの旧 Issue を統合するときは必ず警告する（恒久無視が静かに拡大するため）", () => {
		const withSkip = buildPlan({
			envelope: makeEnvelope(),
			issues: legacyIssues({ overrides: { 1222: { labels: [{ name: TRIAGE_LABEL }, { name: SKIP_LABEL }] } } }),
		});
		expect(withSkip.rekeys.find((rekey) => rekey.issueNumber === 1222).skipLabel).toBe(true);
		expect(withSkip.warnings.join("\n")).toContain(SKIP_LABEL);
		expect(withSkip.warnings.join("\n")).toContain("恒久無視");
		// `err/skip` が付いている Issue が代表に選ばれる（authoritative の順位。#1198 §1-D）
		expect(withSkip.items[0].action).toBe("noop-skip");
	});

	it("未知世代（復元器を持たない fpalgo）が混ざったら1件も書かない", () => {
		const broken = buildPlan({
			envelope: makeEnvelope(),
			issues: legacyIssues({ overrides: { 1221: { body: `<!-- fp:${NEW_FP} -->\n<!-- fpalgo:99 -->` } } }),
		});
		expect(broken.abort).toBe(true);
		expect(broken.rekeys).toEqual([]);
		expect(broken.counts.create).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 4) 本文の書き換え（純関数レベルの冪等性）
// ---------------------------------------------------------------------------

describe("rekeyIssueBody() — マーカーの書き換えは冪等", () => {
	const [issue] = legacyIssues();
	const from = legacyFingerprintOf("ja-JP");
	const rekeyed = rekeyIssueBody({ body: issue.body, from, to: NEW_FP, locale: "ja-JP" });

	it("fp マーカーが新世代に置き換わる", () => {
		expect(extractFingerprints(rekeyed)).toEqual([NEW_FP]);
		expect(extractAlgoVersion(rekeyed)).toBe(FP_ALGO_VERSION);
	});

	it("人間のメモも自動領域も壊さない", () => {
		expect(rekeyed).toContain("人間のメモ: ja-JP の調査中。消さないこと。");
		expect(rekeyed).toContain("<!-- error-triage:auto:start -->");
		expect(rekeyed).toContain("<!-- firstSeen:2026-08-01T00:00:00Z -->");
	});

	it("なぜ fingerprint が変わったのかを本文に残す（err/skip の扱いも含めて）", () => {
		expect(rekeyed).toContain(`\`fp:${from}\``);
		expect(rekeyed).toContain(`\`fp:${NEW_FP}\``);
		expect(rekeyed).toContain("`err/skip` を付けずに");
	});

	// ★ Minor-3: どれを残すのかが本文だけで分かること。
	it("重複側の本文には代表 Issue 番号（統合先）が入る", () => {
		const duplicate = rekeyIssueBody({
			body: legacyIssues()[1].body,
			from: legacyFingerprintOf("en-IE"),
			to: NEW_FP,
			locale: "en-IE",
			issueNumber: 1222,
			authoritativeNumber: 1221,
		});
		expect(duplicate).toContain("統合先: #1221");
		expect(duplicate).toContain("このIssueは重複側です");
		expect(duplicate).toContain("`err/skip` を付けずに");
	});

	it("代表自身の本文には「このIssueが統合先である」と分かる文面が入る", () => {
		const authoritativeBody = rekeyIssueBody({
			body: legacyIssues()[0].body,
			from,
			to: NEW_FP,
			locale: "ja-JP",
			issueNumber: 1221,
			authoritativeNumber: 1221,
		});
		expect(authoritativeBody).toContain("このIssueが統合先（代表）です");
		expect(authoritativeBody).not.toContain("このIssueは重複側です");
	});

	it("2回目は null を返す（＝書き込み不要。同じ run を何度流しても同じ結果）", () => {
		expect(rekeyIssueBody({ body: rekeyed, from, to: NEW_FP, locale: "ja-JP" })).toBeNull();
	});

	it("対象の fp マーカーが無い body には触らない", () => {
		expect(rekeyIssueBody({ body: "<!-- fp:ffffffffffff -->\n<!-- fpalgo:1 -->", from, to: NEW_FP })).toBeNull();
		expect(rekeyIssueBody({ body: "", from, to: NEW_FP })).toBeNull();
	});

	it("fpalgo マーカーが無い body（#1198 §1-B）にも世代を書き足す", () => {
		const out = rekeyIssueBody({ body: `<!-- fp:${from} -->\n\n人間のメモ`, from, to: NEW_FP });
		expect(extractAlgoVersion(out)).toBe(FP_ALGO_VERSION);
		expect(out).toContain("人間のメモ");
	});

	it("リキー後の理由書きは、その後の body 自動更新でも消えない（自動領域の外にある）", () => {
		const group = { ...makeEnvelope().groups[0] };
		const updated = renderIssueBody({ group, window: WINDOW, generatedAt: GENERATED_AT, existingBody: rekeyed });
		expect(updated).toContain(`\`fp:${from}\``);
		expect(updated).toContain("人間のメモ: ja-JP の調査中。消さないこと。");
		expect(extractFingerprints(updated)).toEqual([NEW_FP]);
	});
});

// ---------------------------------------------------------------------------
// 5) applyPlan での適用（冪等性 / dry-run）
// ---------------------------------------------------------------------------

/**
 * applyPlan が使う API だけを持つ最小の偽 GitHub。状態を持ち、PATCH を実際に反映する。
 *
 * @param {Array<Record<string, any>>} issues
 */
const makeClient = (issues) => {
	const state = new Map(issues.map((issue) => [issue.number, { ...issue }]));
	const calls = [];
	return {
		calls,
		state,
		async listIssuesByLabel() {
			calls.push({ op: "listIssuesByLabel" });
			return [...state.values()];
		},
		async listSubIssues() {
			return [];
		},
		async createIssue({ title, body }) {
			calls.push({ op: "createIssue", title });
			const number = 9000 + state.size;
			const created = { number, id: 4000000 + number, state: "open", labels: [{ name: TRIAGE_LABEL }], body };
			state.set(number, created);
			return created;
		},
		async updateIssueBody({ issueNumber, body }) {
			calls.push({ op: "updateIssueBody", issueNumber });
			state.get(issueNumber).body = body;
			return state.get(issueNumber);
		},
		async reopenIssue({ issueNumber }) {
			calls.push({ op: "reopenIssue", issueNumber });
			return state.get(issueNumber);
		},
		async listIssueComments() {
			return [];
		},
		async createComment({ issueNumber }) {
			calls.push({ op: "createComment", issueNumber });
			return {};
		},
		async updateComment() {
			return {};
		},
		async addSubIssue() {
			return {};
		},
	};
};

const runOnce = async (client, { dryRun = false } = {}) => {
	const issues = await client.listIssuesByLabel();
	client.calls.length = 0;
	const envelope = makeEnvelope();
	const plan = buildPlan({ envelope, issues });
	const applyResult = await applyPlan({
		client,
		envelope,
		plan,
		issues,
		subIssues: { ok: true, ids: new Set(), numbers: new Set(), count: 0, error: null },
		parentIssue: 1196,
		dryRun,
		sleepImpl: async () => {},
	});
	return { plan, applyResult };
};

describe("applyPlan() — 移行の適用は冪等", () => {
	it("1回目: 4件をリキーし、新規起票は0件", async () => {
		const client = makeClient(legacyIssues());
		const { applyResult } = await runOnce(client);

		expect(applyResult.created).toHaveLength(0);
		expect(applyResult.rekeyed.map((entry) => entry.issueNumber)).toEqual([1221, 1222, 1223, 1224]);
		expect(applyResult.failures).toEqual([]);
		for (const number of [1221, 1222, 1223, 1224]) {
			expect(extractFingerprints(client.state.get(number).body)).toEqual([NEW_FP]);
			expect(extractAlgoVersion(client.state.get(number).body)).toBe(FP_ALGO_VERSION);
		}
		// Minor-3: 実際に書き込まれた本文でも代表がどれか分かる
		expect(client.state.get(1221).body).toContain("このIssueが統合先（代表）です");
		for (const number of [1222, 1223, 1224]) {
			expect(client.state.get(number).body).toContain("統合先: #1221");
		}
	});

	it("2回目: 1件もリキーせず、1件も起票しない（何度実行しても同じ結果）", async () => {
		const client = makeClient(legacyIssues());
		await runOnce(client);
		const { plan, applyResult } = await runOnce(client);

		expect(plan.pendingAlgoVersions).toEqual([]); // 移行完了
		expect(plan.rekeys).toEqual([]);
		expect(plan.counts.create).toBe(0);
		expect(applyResult.rekeyed).toEqual([]);
		expect(applyResult.created).toHaveLength(0);
		expect(client.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
	});

	it("3回目も同じ（収束していて振動しない）", async () => {
		const client = makeClient(legacyIssues());
		await runOnce(client);
		await runOnce(client);
		const before = new Map([...client.state].map(([number, issue]) => [number, issue.body]));
		const { applyResult } = await runOnce(client);
		expect(applyResult.rekeyed).toEqual([]);
		for (const [number, body] of before) expect(client.state.get(number).body).toBe(body);
	});

	it("--dry-run は1バイトも書かない（移行の影響を先に読める）", async () => {
		const client = makeClient(legacyIssues());
		const { plan, applyResult } = await runOnce(client, { dryRun: true });

		expect(plan.rekeys).toHaveLength(4);
		expect(applyResult.rekeyed).toHaveLength(4); // 計画としては4件
		expect(client.calls.filter((call) => call.op === "updateIssueBody")).toHaveLength(0);
		expect(client.calls.filter((call) => call.op === "createIssue")).toHaveLength(0);
		// 状態は移行前のまま
		expect(extractAlgoVersion(client.state.get(1221).body)).toBe(1);
	});

	it("途中でクラッシュしても（一部だけリキー済みでも）重複起票にならない", async () => {
		// #1221 だけ先にリキーされた状態を作る
		const partial = legacyIssues().map((issue) =>
			issue.number === 1221
				? {
						...issue,
						body: rekeyIssueBody({
							body: issue.body,
							from: legacyFingerprintOf("ja-JP"),
							to: NEW_FP,
							locale: "ja-JP",
						}),
					}
				: issue,
		);
		const client = makeClient(partial);
		const { plan, applyResult } = await runOnce(client);

		// #1221 は現行 fingerprint で当たるので、残り3件はリキーされない
		// （現行 fingerprint で当たった時点で旧 fingerprint を引きにいかない）
		expect(plan.counts.create).toBe(0);
		expect(applyResult.created).toHaveLength(0);
		expect(plan.items[0].matchedBy).toBe("current");
		expect(plan.items[0].issueNumber).toBe(1221);
	});

	it("リキーの PATCH が失敗しても、起票は止まらず重複もしない（リキーは後片付け）", async () => {
		const client = makeClient(legacyIssues());
		client.updateIssueBody = async ({ issueNumber }) => {
			throw new Error(`boom #${issueNumber}`);
		};
		const { applyResult } = await runOnce(client);

		expect(applyResult.rekeyed).toEqual([]);
		expect(applyResult.failures.map((failure) => failure.stage)).toContain("rekey");
		expect(applyResult.created).toHaveLength(0); // ← 重複起票していない
	});
});
