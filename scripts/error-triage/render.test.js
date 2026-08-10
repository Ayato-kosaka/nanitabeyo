"use strict";

const existingIssues = require("./__fixtures__/existing-issues.json");
const rows = require("./__fixtures__/bq-rows.json");
const runSummary = require("./__fixtures__/run-summary.json");
const {
	AUTO_END_MARKER,
	AUTO_START_MARKER,
	PARENT_SUMMARY_MARKER,
	PRESERVED_BODY_NOTICE,
	TITLE_MAX_LENGTH,
	extractAlgoVersion,
	extractAutoUpdatedAtUtc,
	extractFingerprints,
	extractFirstSeenUtc,
	extractRenderedOccurrences,
	findUnrecordedCommit,
	renderApplySummary,
	renderIssueBody,
	renderJobSummary,
	renderParentSummaryComment,
	renderRegressionComment,
	renderRegressionMarker,
	renderTitle,
	sanitizeInlineText,
	shouldUpdateBody,
} = require("./render");
const { FP_ALGO_VERSION } = require("./constants");
const { computeFingerprint } = require("./fingerprint");
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
		expect(extractAlgoVersion(issue1201.body)).toBe(2);
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
		expect(body.split("\n")[1]).toBe(`<!-- fpalgo:${FP_ALGO_VERSION} -->`);
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
		expect(extractAlgoVersion(updated)).toBe(FP_ALGO_VERSION);
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

	it("自動領域が見つからない body（人間が消した）には自動領域を作り直す", () => {
		const rebuilt = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: "マーカーを全部消してしまった本文",
		});
		expect(rebuilt).toContain(AUTO_START_MARKER);
		expect(rebuilt).toContain(AUTO_END_MARKER);
		expect(extractFingerprints(rebuilt)).toEqual([backendGroup.fingerprint]);
	});

	// ★ S-2（PR #1200 レビュー）: 自動領域マーカーが消されていても、人間の記述は絶対に捨てない。
	//   捨てると PR3 の body 更新（PATCH）で担当者の調査メモが黙って消える。
	describe("S-2: 自動領域マーカーが無い body でも人間の記述を保全する", () => {
		const humanBody = [
			`<!-- fp:${backendGroup.fingerprint} -->`,
			"",
			"## 調査メモ",
			"原因は DTO の不整合。PR #1234 で対応中。",
			"",
			"- [ ] api 側の DTO を直す",
			"- [x] 再現手順を確認した",
		].join("\n");
		const rebuilt = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: humanBody,
		});

		it("既存本文を1文字も捨てない（丸ごと含まれる）", () => {
			expect(rebuilt).toContain(humanBody);
			expect(rebuilt).toContain("原因は DTO の不整合。PR #1234 で対応中。");
			expect(rebuilt).toContain("- [x] 再現手順を確認した");
		});

		it("保全したことが人間に分かるよう見出しを添える", () => {
			expect(rebuilt).toContain(PRESERVED_BODY_NOTICE);
			expect(rebuilt.indexOf(PRESERVED_BODY_NOTICE)).toBeGreaterThan(rebuilt.indexOf(AUTO_END_MARKER));
		});

		it("自動領域は先頭に1つだけ作り直される", () => {
			expect(rebuilt.split(AUTO_START_MARKER)).toHaveLength(2);
			expect(rebuilt.split("\n")[0]).toBe(`<!-- fp:${backendGroup.fingerprint} -->`);
			expect(extractFirstSeenUtc(rebuilt)).toBe("2026-08-06T00:14:02Z");
		});

		it("もう一度通しても人間の記述は残り続ける（自動領域が復活するので以後は差し替えになる）", () => {
			const twice = renderIssueBody({
				group: backendGroup,
				window: WINDOW,
				generatedAt: GENERATED_AT,
				existingBody: rebuilt,
			});
			expect(twice.split(AUTO_START_MARKER)).toHaveLength(2);
			expect(twice).toContain("原因は DTO の不整合。PR #1234 で対応中。");
			expect(twice).toBe(rebuilt);
		});

		it("既存 body が空白だけなら保全せず自由記述の案内を出す（新規起票と同じ形）", () => {
			for (const emptyish of [null, "", "   \n\t "]) {
				const body = renderIssueBody({
					group: backendGroup,
					window: WINDOW,
					generatedAt: GENERATED_AT,
					existingBody: emptyish,
				});
				expect(body).not.toContain(PRESERVED_BODY_NOTICE);
				expect(body).toContain("（ここから下は自由記述。スクリプトは触りません）");
			}
		});
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
			groupKey: { ...rows[3].groupKey, pathName: `/auth/signup/${index}` },
			firstSeenUtc: `2026-08-0${index + 1}T00:00:00Z`,
			affectedUsers: 100 - index,
			anonymousOccurrences: 0,
		}));
		const cappedPlan = buildPlan({
			envelope: buildEnvelope({ rows: many, runSummary, window: WINDOW, generatedAt: GENERATED_AT, query: QUERY })
				.envelope,
			issues: [],
			limits: { createLimit: 5 },
		});
		const comment = renderParentSummaryComment({ envelope, plan: cappedPlan });
		expect(comment).toContain("**繰り越し 3 件**");
		expect(comment).toMatch(/最古の初観測: `2026-08-0\dT00:00:00Z`/);
	});
});

describe("body 更新のスロットリング（#1198 §6-C）", () => {
	const yesterdayBody = renderIssueBody({ group: backendGroup, window: WINDOW, generatedAt: "2026-08-06T00:05:12Z" });

	it("自動領域から前回の件数と更新時刻を読み戻せる", () => {
		expect(extractRenderedOccurrences(yesterdayBody)).toBe(backendGroup.occurrences);
		expect(extractAutoUpdatedAtUtc(yesterdayBody)).toBe("2026-08-06T00:05:12Z");
	});

	it("件数も commit も変わらず、7日も経っていなければ叩かない", () => {
		expect(shouldUpdateBody({ existingBody: yesterdayBody, group: backendGroup, generatedAt: GENERATED_AT })).toEqual({
			update: false,
			reason: expect.stringContaining("変化なし"),
		});
	});

	it("件数が2倍以上になったら更新する（桁が変わったときだけ知らせる）", () => {
		const surged = { ...backendGroup, occurrences: backendGroup.occurrences * 2 };
		expect(shouldUpdateBody({ existingBody: yesterdayBody, group: surged, generatedAt: GENERATED_AT }).update).toBe(
			true,
		);
	});

	it("件数が半分以下になっても更新する", () => {
		const calmed = { ...backendGroup, occurrences: Math.floor(backendGroup.occurrences / 2) };
		expect(shouldUpdateBody({ existingBody: yesterdayBody, group: calmed, generatedAt: GENERATED_AT }).update).toBe(
			true,
		);
	});

	it("body 未記載の commit が出たら更新する（新しいビルドでも出ている＝直っていない）", () => {
		const rebuilt = { ...backendGroup, commits: [...backendGroup.commits, { sha: "0123456789ab", count: 3 }] };
		expect(findUnrecordedCommit(yesterdayBody, rebuilt.commits)).toBe("0123456789ab");
		expect(shouldUpdateBody({ existingBody: yesterdayBody, group: rebuilt, generatedAt: GENERATED_AT }).update).toBe(
			true,
		);
	});

	it("7日以上経っていれば変化が無くても更新する", () => {
		expect(
			shouldUpdateBody({ existingBody: yesterdayBody, group: backendGroup, generatedAt: "2026-08-14T00:05:12Z" })
				.update,
		).toBe(true);
	});

	it("前回値を読めない（人間がマーカーを消した）ときは更新する側へ倒す", () => {
		expect(shouldUpdateBody({ existingBody: "自由記述だけ", group: backendGroup, generatedAt: GENERATED_AT })).toEqual({
			update: true,
			reason: expect.stringContaining("前回値を読めない"),
		});
		expect(shouldUpdateBody({ existingBody: null, group: backendGroup, generatedAt: GENERATED_AT }).update).toBe(true);
	});
});

describe("renderApplySummary()", () => {
	const base = {
		dryRun: false,
		parentIssue: 1196,
		created: [{ issueNumber: 1301 }],
		reopened: [{ issueNumber: 1202 }],
		bodyUpdated: [{ issueNumber: 1201 }],
		bodySkipped: [],
		subIssueLinked: [],
		subIssueFailures: [],
		subIssueIndexOk: true,
		subIssueCount: 5,
		failures: [],
		commitLookups: 2,
		parentSummary: "updated",
	};

	it("起票・reopen・body 更新の件数を出す", () => {
		const summary = renderApplySummary({ applyResult: base });
		expect(summary).toContain("起票: **1** 件 #1301");
		expect(summary).toContain("reopen: **1** 件 #1202");
		expect(summary).toContain("body 更新: 1 件");
	});

	it("sub-issue 紐付けの失敗件数を必ず出す（run は落とさないが黙らない。§6-2）", () => {
		const summary = renderApplySummary({
			applyResult: { ...base, subIssueFailures: [{ issueNumber: 1301, message: "HTTP 403" }] },
		});
		expect(summary).toContain("失敗 1 件");
		expect(summary).toContain("| #1301 | HTTP 403 |");
	});

	it("S11: sub-issue が上限に近づいても「自動で外さない」ことを明示する", () => {
		const summary = renderApplySummary({ applyResult: { ...base, subIssueCount: 95 } });
		expect(summary).toContain("95 件");
		expect(summary).toContain("自動で外すことはしません");
		expect(summary).not.toMatch(/DELETE|自動削除/);
	});

	it("sub-issue 索引が取れなかったことを警告として出す", () => {
		const summary = renderApplySummary({
			applyResult: { ...base, subIssueIndexOk: false, subIssueIndexError: "HTTP 403" },
		});
		expect(summary).toContain("sub-issue 一覧を取得できませんでした");
		expect(summary).toContain("ラベル1枚だけで突合");
	});

	it("書き込みの失敗を表に出す（成功したように見えるのが一番まずい）", () => {
		const summary = renderApplySummary({
			applyResult: { ...base, failures: [{ stage: "create", target: "fp:abc", message: "HTTP 403" }] },
		});
		expect(summary).toContain("| create | fp:abc | HTTP 403 |");
	});
});

// ---------------------------------------------------------------------------
// M-1（PR #1211 レビュー）: messagePattern は本番の任意文字列。markdown へ無escape で埋めない
// ---------------------------------------------------------------------------
//
// `messagePattern` は `rawMessage`（サードパーティ API の文言や外部例外も通る値）を正規化しただけで、
// 正規化ルールは `` ` `` / `|` / `<` / `>` / `<!-- -->` を一切触りません。
// レビューが実測した3つの被害をここで固定します。

describe("M-1: messagePattern の無害化（表示直前だけ）", () => {
	/** レビューの再現ケース: 自動領域の終了マーカーそのものがメッセージに混ざる。 */
	const INJECTED_END = `Validation failed ${AUTO_END_MARKER}`;
	const renderOnce = (messagePattern, existingBody = null) =>
		renderIssueBody({
			group: { ...backendGroup, messagePattern },
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody,
		});

	it("`auto:end` を注入した body を6回連続で自己適用しても膨張しない（実測 +717字/run の再現）", () => {
		let body = renderOnce(INJECTED_END);
		const lengths = [body.length];
		for (let run = 0; run < 5; run += 1) {
			body = renderOnce(INJECTED_END, body);
			lengths.push(body.length);
		}
		// 2 run 目以降は完全に同じ body（＝差分なしで PATCH すら出ない）
		expect(new Set(lengths).size).toBe(1);
		// 自動領域は1組だけ。「このIssueの扱い方」も1つだけ
		expect(body.split(AUTO_START_MARKER)).toHaveLength(2);
		expect(body.split("### このIssueの扱い方")).toHaveLength(2);
		// GitHub の body 上限 65,536字に近づかない
		expect(body.length).toBeLessThan(4000);
	});

	it("注入されたマーカー文字列はそのまま本文へ出さない（無害化してから埋める）", () => {
		const body = renderOnce(INJECTED_END);
		// 生の `<!-- error-triage:auto:end -->` は自動領域の終端の1つだけ
		const occurrences = body.split(AUTO_END_MARKER).length - 1;
		expect(occurrences).toBe(1);
		// メッセージ自体は「読める形」で残る（消してしまわない）
		expect(body).toContain("Validation failed");
	});

	it("バックティックを含んでも @ユーザー名 がコードスパンの外へ出ない（通知を飛ばさない）", () => {
		const body = renderOnce("bad name: ` @Ayato-kosaka ` please fix");
		const row = body.split("\n").find((line) => line.includes("**何が**"));
		// 行の中のバックティックはコードスパンの開始・終了の2本だけ（＝閉じない）
		expect((row.match(/`/g) || []).length).toBe(2);
		// `@Ayato-kosaka` はコードスパンの内側に留まる
		expect(row).toMatch(/^\| \*\*何が\*\* \| `[^`]*@Ayato-kosaka[^`]*` \|$/);
	});

	it("`|` を含んでもテーブルの行が崩れない（セルは2つのまま）", () => {
		const body = renderOnce("SELECT a | b FROM t WHERE x | y");
		const row = body.split("\n").find((line) => line.includes("**何が**"));
		// セル区切りとして解釈される `|` は行頭・区切り・行末の3本だけ。中身は `\|` でエスケープ済み
		expect(row.replace(/\\\|/g, "")).toBe("| **何が** | `SELECT a  b FROM t WHERE x  y` |");
		expect(row).toContain("\\|");
	});

	it("改行を含んでも表の行を割らない", () => {
		const body = renderOnce("first line\nsecond | line\n<!-- x -->");
		const rows = body.split("\n").filter((line) => line.includes("**何が**"));
		expect(rows).toHaveLength(1);
	});

	it("正規化の出力（`<n>` / `<uuid>`）は読めるまま残す（`<` `>` を潰さない）", () => {
		expect(renderOnce("location invalid: lat=<n>, lng=<n>")).toContain("lat=<n>, lng=<n>");
	});

	it("メッセージが無いグループは従来どおり「（メッセージなし）」", () => {
		expect(renderOnce(null)).toContain("（メッセージなし）");
	});

	it("無害化は**表示だけ**で、fingerprint の計算入力を変えない（既存 Issue との突合を壊さない）", () => {
		const group = { ...backendGroup, messagePattern: INJECTED_END };
		const before = computeFingerprint(group);
		const body = renderIssueBody({ group, window: WINDOW, generatedAt: GENERATED_AT });
		// 引数のグループを書き換えていない
		expect(group.messagePattern).toBe(INJECTED_END);
		// 同じ入力から同じ fingerprint が出る（render を通しても変わらない）
		expect(computeFingerprint(group)).toBe(before);
		// body に載る fp マーカーも group.fingerprint のまま
		expect(extractFingerprints(body)).toEqual([backendGroup.fingerprint]);
	});

	it("sanitizeInlineText 単体: 潰すのは `<!--` / `-->` / バックティック / `|` だけ", () => {
		expect(sanitizeInlineText("a <!-- b --> c")).toBe("a <!- - b - -> c");
		expect(sanitizeInlineText("a `b` c")).toBe("a 'b' c");
		expect(sanitizeInlineText("a | b")).toBe("a \\| b");
		expect(sanitizeInlineText("  a\n\tb  ")).toBe("a b");
		expect(sanitizeInlineText("lat=<n>")).toBe("lat=<n>");
		expect(sanitizeInlineText(null)).toBe("");
		// 変換後に HTML コメントの開始・終了が復活しない
		expect(sanitizeInlineText("<!--->")).not.toMatch(/<!--|-->/);
		expect(sanitizeInlineText("--->")).not.toMatch(/-->/);
	});
});

describe("M-1: 自動領域マーカーの探索は行アンカー付き（多重防御）", () => {
	it("行の途中にあるマーカーは境界として拾わない", () => {
		const body = [
			`<!-- fp:${backendGroup.fingerprint} -->`,
			AUTO_START_MARKER,
			`| **何が** | 混入 ${AUTO_END_MARKER} |`,
			"自動領域の中身",
			AUTO_END_MARKER,
			"",
			"人間のメモ",
		].join("\n");
		const replaced = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: body,
		});
		expect(replaced).toContain("人間のメモ");
		expect(replaced).not.toContain("自動領域の中身");
		// 行途中の注入も一緒に置き換わって消える（境界を手前で切っていない証拠）
		expect(replaced).not.toContain("| **何が** | 混入");
		expect(replaced.split(AUTO_START_MARKER)).toHaveLength(2);
	});

	it("終了マーカーが開始マーカーより前にしか無ければ作り直す（人間の記述は保全する）", () => {
		const body = [AUTO_END_MARKER, "人間のメモ", AUTO_START_MARKER].join("\n");
		const rebuilt = renderIssueBody({
			group: backendGroup,
			window: WINDOW,
			generatedAt: GENERATED_AT,
			existingBody: body,
		});
		expect(rebuilt).toContain(PRESERVED_BODY_NOTICE);
		expect(rebuilt).toContain("人間のメモ");
	});
});
