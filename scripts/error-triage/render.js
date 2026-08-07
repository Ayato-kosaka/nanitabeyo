// #1196 error-triage / Issue 本文・Job Summary の整形（純関数）と、本文マーカーの読み書き。
//
// 本文フォーマットの唯一の正。突合（triage.js）はここが公開するマーカー抽出関数を使う。
//
// 横断レビュー G2:
//   `firstSeen` の実体は「窓内の最初」であって全期間の初観測ではない。既存 open Issue の body を
//   毎回そのまま上書きすると初観測日が毎日今日にリセットされ、
//   「今日のデプロイで壊れたのか」の判断材料が壊れる。
//   → body 更新時は **既存 body の値と min() を取る**。そのために機械可読な
//     `<!-- firstSeen:... -->` マーカーを自動領域に埋める。
//
// 横断レビュー G3 / G5 / S9:
//   `truncated`（LIMIT 切り捨て）と `excludedBreakdown` は Job Summary だけでなく
//   親 Issue の常駐サマリにも出す。Job Summary は 90 日で消え、誰も遡らない。

"use strict";

const { BODY_STALE_DAYS, FP_ALGO_VERSION, SCHEMA_VERSION, SUB_ISSUE_WARN_THRESHOLD } = require("./constants");
const { FINGERPRINT_PATTERN } = require("./fingerprint");
const { minTimestamp, toDate } = require("./window");

/** 自動領域の開始・終了マーカー。この内側だけをスクリプトが書き換える。 */
const AUTO_START_MARKER = "<!-- error-triage:auto:start -->";
const AUTO_END_MARKER = "<!-- error-triage:auto:end -->";

/** 親 Issue の常駐サマリコメントを識別するマーカー（#1198 §4-B）。 */
const PARENT_SUMMARY_MARKER = "<!-- error-triage:summary -->";

/**
 * fingerprint マーカー。**行全体アンカー + 12桁小文字hex固定**（#1198 §1-C）。
 * 散文中の `fp:xxxx` や桁数違いを拾わないこと自体が仕様。
 */
const FP_MARKER_PATTERN = /^[ \t]*<!-- fp:([0-9a-f]{12}) -->[ \t]*$/gm;
/** fingerprint 世代マーカー。 */
const FPALGO_MARKER_PATTERN = /^[ \t]*<!-- fpalgo:(\d{1,3}) -->[ \t]*$/m;
/** 窓内初観測ではなく「これまでに観測した最古」を保持するマーカー（G2）。 */
const FIRST_SEEN_MARKER_PATTERN = /^[ \t]*<!-- firstSeen:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) -->[ \t]*$/m;

/** Issue タイトルの最大長。 */
const TITLE_MAX_LENGTH = 120;
/** タイトルに載せる正規化済みメッセージの最大長。 */
const TITLE_MESSAGE_MAX_LENGTH = 60;

const renderFpMarker = (fingerprint) => `<!-- fp:${fingerprint} -->`;
const renderFpAlgoMarker = (algoVersion = FP_ALGO_VERSION) => `<!-- fpalgo:${algoVersion} -->`;
const renderFirstSeenMarker = (firstSeenUtc) => `<!-- firstSeen:${firstSeenUtc} -->`;

/**
 * Issue body から fingerprint を全て抽出する（重複は除き、出現順を保つ）。
 *
 * 1つの body に複数の異なる fp があった場合、呼び出し側はその Issue を**全ての fp の索引に登録**する
 * （片方だけ採用すると残りが新規起票され、安全側に倒れないため。#1198 §1-C）。
 *
 * @param {string|null|undefined} body
 * @returns {string[]}
 */
const extractFingerprints = (body) => {
	if (!body) return [];
	const found = [];
	const pattern = new RegExp(FP_MARKER_PATTERN.source, FP_MARKER_PATTERN.flags);
	let matched = pattern.exec(body);
	while (matched !== null) {
		if (!found.includes(matched[1])) found.push(matched[1]);
		matched = pattern.exec(body);
	}
	return found;
};

/**
 * Issue body から fingerprint 世代を読む。マーカーが無ければ 1 とみなす（#1198 §1-B）。
 *
 * @param {string|null|undefined} body
 * @returns {number}
 */
const extractAlgoVersion = (body) => {
	if (!body) return 1;
	const matched = FPALGO_MARKER_PATTERN.exec(body);
	return matched ? Number.parseInt(matched[1], 10) : 1;
};

/**
 * Issue body から、これまでに記録された最古の観測時刻を読む（G2）。
 *
 * @param {string|null|undefined} body
 * @returns {string|null}
 */
const extractFirstSeenUtc = (body) => {
	if (!body) return null;
	const matched = FIRST_SEEN_MARKER_PATTERN.exec(body);
	return matched ? matched[1] : null;
};

/**
 * group の「どこで」を1つの文字列にする。
 *
 * @param {{surface:string, groupKey?:Record<string, unknown>}} group
 * @returns {string}
 */
const describeLocation = (group) => {
	const key = group.groupKey || {};
	if (group.surface === "external") {
		return [key.apiName, key.method, key.endpoint].filter(Boolean).join(" ") || "(unknown)";
	}
	if (group.surface === "backend") {
		return [key.functionName, key.route].filter(Boolean).join(" ") || "(unknown)";
	}
	return [key.pathName, key.route].filter(Boolean).join(" ") || "(unknown)";
};

const truncate = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Issue タイトル。**起票時に固定し、以後スクリプトから変更しない**（#1198 §6-A）。
 *
 * @param {{surface:string, fingerprint:string, groupKey?:Record<string, unknown>, messagePattern?:string|null}} group
 * @returns {string}
 */
const renderTitle = (group) => {
	const key = group.groupKey || {};
	const suffix = ` (fp:${group.fingerprint})`;
	let head;
	if (group.surface === "external") {
		head = `[err/external] ${describeLocation(group)} → ${key.statusCode ?? "?"}`;
	} else {
		const message = truncate(
			String(group.messagePattern || "(no message)").replace(/\s+/g, " "),
			TITLE_MESSAGE_MAX_LENGTH,
		);
		const eventName = key.eventName ? `${key.eventName}: ` : "";
		head = `[err/${group.surface}] ${describeLocation(group)}: ${eventName}${message}`;
	}
	return truncate(head, TITLE_MAX_LENGTH - suffix.length) + suffix;
};

const formatCounts = (group) => {
	const users =
		group.affectedUsers > 0
			? `影響ユーザー ${group.affectedUsers} 人`
			: `**識別ユーザー 0 人 / 匿名 ${group.anonymousOccurrences ?? 0} 件**（未認証経路の可能性）`;
	return `**${group.occurrences} 件** / ${users}`;
};

const formatCommits = (group) =>
	(group.commits || []).map((commit) => `\`${commit.sha}\` (${commit.count}件)`).join(" / ") || "—";

/**
 * Issue body の自動領域を組み立てる。
 *
 * @param {{
 *   group: Record<string, any>,
 *   window: {startUtc:string, endUtc:string, lookbackHours:number},
 *   generatedAt: string,
 *   firstSeenUtc: string,
 *   parentIssue?: number|string,
 *   runUrl?: string|null,
 * }} params
 * @returns {string}
 */
const renderAutoSection = ({ group, window, generatedAt, firstSeenUtc, parentIssue = 1196, runUrl = null }) => {
	const key = group.groupKey || {};
	const rows = [
		["どこで", `\`${group.surface}\` / ${describeLocation(group)}${key.eventName ? ` / \`${key.eventName}\`` : ""}`],
		["何が", group.messagePattern ? `\`${group.messagePattern}\`` : "（メッセージなし）"],
		["どれだけ", formatCounts(group)],
		["いつ", `初観測 \`${firstSeenUtc}\` → 最終観測 \`${group.lastSeenUtc}\``],
		["どのビルド", formatCommits(group)],
		["どの版", (group.appVersions || []).map((v) => `\`${v}\``).join(" / ") || "—"],
		["観測窓", `\`${window.startUtc}\` 〜 \`${window.endUtc}\`（${window.lookbackHours}h スライド窓）`],
	];
	const runLink = runUrl ? ` / <a href="${runUrl}">run</a>` : "";
	return [
		AUTO_START_MARKER,
		renderFirstSeenMarker(firstSeenUtc),
		"",
		"|  |  |",
		"|---|---|",
		...rows.map(([label, value]) => `| **${label}** | ${value} |`),
		"",
		"### このIssueの扱い方",
		"",
		"- **直した** → close（completed）。close から 24h 以降に 3 件以上再出現したら自動で reopen される",
		"- **直さない / ノイズ** → `err/skip` ラベルを付けて close（not planned）。以後このfpは完全に無視される",
		"- **件数だけ知りたい** → この表は自動更新される（本文編集なのでコメント通知は飛ばない）",
		"",
		"> [!IMPORTANT]",
		"> 先頭の `<!-- fp:… -->` 行と `error-triage` ラベルは自動突合のキーです。",
		"> 消すと、同じエラーが**新しいIssueとして重複起票**されます。",
		"",
		`> 件数は**この観測窓の中だけ**の値です。run をまたいで合算されません（窓は ${window.lookbackHours}h で 1h ぶん重複します）。`,
		"",
		`<sub>🤖 自動起票 / 親: #${parentIssue} / 更新: ${generatedAt}${runLink}</sub>`,
		AUTO_END_MARKER,
	].join("\n");
};

/**
 * 既存 body の自動領域だけを差し替える。自動領域の外（人間の作業メモ）は保全する。
 *
 * @param {string|null|undefined} existingBody
 * @param {string} autoSection
 * @returns {string|null} 自動領域が見つからなければ null（＝呼び出し側が新規 body を作る）
 */
const replaceAutoSection = (existingBody, autoSection) => {
	if (!existingBody) return null;
	const start = existingBody.indexOf(AUTO_START_MARKER);
	const end = existingBody.indexOf(AUTO_END_MARKER);
	if (start === -1 || end === -1 || end < start) return null;
	return existingBody.slice(0, start) + autoSection + existingBody.slice(end + AUTO_END_MARKER.length);
};

/** 自動領域を復元したときに、保全した既存本文の前に置く見出し。 */
const PRESERVED_BODY_NOTICE = "（自動領域のマーカーが見つからなかったため作り直しました。以下は既存の本文です）";

/**
 * Issue body を組み立てる。既存 body があれば自動領域だけを差し替える。
 *
 * G2: `firstSeen` は既存 body の値と min() を取る。今回の窓の値で毎日上書きしない。
 * 不変条件 2: `occurrences` / `affectedUsers` は既存 body の値と**合算しない**。今回の窓の値をそのまま出す。
 *
 * S-2（PR #1200 レビュー）:
 *   自動領域マーカーが見つからない場合でも、**既存 body を1文字も捨てない**。
 *   自動領域内の注意書き（renderAutoSection）は `<!-- fp:… -->` を消すなとしか書いておらず、
 *   `auto:start` / `auto:end` については何も言っていないので、人間がマーカーだけ消すことは十分あり得る。
 *   捨てた場合、PR3 がこの戻り値で body を PATCH した瞬間に担当者の調査メモが黙って消える。
 *   保全するかどうかを PR3 に委ねず、ここで決める。
 *
 * @param {{
 *   group: Record<string, any>,
 *   window: {startUtc:string, endUtc:string, lookbackHours:number},
 *   generatedAt: string,
 *   existingBody?: string|null,
 *   parentIssue?: number|string,
 *   runUrl?: string|null,
 * }} params
 * @returns {string}
 */
const renderIssueBody = ({ group, window, generatedAt, existingBody = null, parentIssue = 1196, runUrl = null }) => {
	const firstSeenUtc = minTimestamp(extractFirstSeenUtc(existingBody), group.firstSeenUtc);
	const autoSection = renderAutoSection({ group, window, generatedAt, firstSeenUtc, parentIssue, runUrl });

	const replaced = replaceAutoSection(existingBody, autoSection);
	if (replaced !== null) return replaced;

	const head = [renderFpMarker(group.fingerprint), renderFpAlgoMarker(), autoSection, "", "---", ""];
	// 空白しか無い body（＝新規起票、あるいは実質空）と、人間が書いた本文とを区別する。
	if (existingBody && existingBody.trim() !== "") {
		return [...head, PRESERVED_BODY_NOTICE, "", existingBody, ""].join("\n");
	}
	return [...head, "（ここから下は自由記述。スクリプトは触りません）", ""].join("\n");
};

// ---------------------------------------------------------------------------
// 自動領域の読み戻し（PR3 の body 更新スロットリング用。#1198 §6-C）
// ---------------------------------------------------------------------------
//
// ここに置く理由: 読む対象は `renderAutoSection()` が書いた文字列そのものなので、
// 書式の唯一の正であるこのファイルの外へ出すと、書き手と読み手が別ファイルで静かにドリフトする。

/** 自動領域フッタの `更新: <RFC3339>`（＝前回この Issue を更新した時刻）。 */
const AUTO_UPDATED_AT_PATTERN = /更新: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/;
/** 「どれだけ」行の件数（＝前回 run の occurrences）。 */
const RENDERED_OCCURRENCES_PATTERN = /どれだけ[^|]*\|\s*\*\*(\d+)\s*件\*\*/;

/**
 * 既存 body から前回の `occurrences` を読む。読めなければ null。
 *
 * @param {string|null|undefined} body
 * @returns {number|null}
 */
const extractRenderedOccurrences = (body) => {
	if (!body) return null;
	const matched = RENDERED_OCCURRENCES_PATTERN.exec(body);
	return matched ? Number.parseInt(matched[1], 10) : null;
};

/**
 * 既存 body から自動領域の最終更新時刻を読む。読めなければ null。
 *
 * @param {string|null|undefined} body
 * @returns {string|null}
 */
const extractAutoUpdatedAtUtc = (body) => {
	if (!body) return null;
	const matched = AUTO_UPDATED_AT_PATTERN.exec(body);
	return matched ? matched[1] : null;
};

/**
 * 既存 body に body 未記載の新しい commit sha があるか（#1198 §6-C(3)）。
 *
 * @param {string|null|undefined} body
 * @param {ReadonlyArray<{sha?:string}>} commits
 * @returns {string|null} 未記載の sha（無ければ null）
 */
const findUnrecordedCommit = (body, commits = []) => {
	const text = body || "";
	for (const commit of commits) {
		if (commit && commit.sha && !text.includes(commit.sha)) return commit.sha;
	}
	return null;
};

/**
 * 既存 open / wontfix Issue の body を今回 PATCH すべきか（#1198 §6-C のスロットリング）。
 *
 * 日次 run で毎日全 open を PATCH すると、Issue の編集履歴が汚れ、`updated_at` が毎日動いて
 * Issue 一覧の並びがかき混ぜられ、他の Issue の視認性まで下がる。
 * 次のいずれかを満たすときだけ叩く:
 *   1. 件数が前回値の 2倍以上 / 1/2 以下（＝桁が変わったときだけ知らせる）
 *   2. 自動領域の更新から BODY_STALE_DAYS 日以上経過
 *   3. body 未記載の commit が出た（＝新しいビルドでも出ている＝直っていない証拠）
 * 前回値が読めない（自動領域が無い・人間がマーカーを消した）場合は**更新する**側へ倒す。
 * 更新しても通知は飛ばないので、迷ったら更新する方が情報が古びない。
 *
 * @param {{existingBody?:string|null, group:Record<string, any>, generatedAt:string, staleDays?:number}} params
 * @returns {{update:boolean, reason:string}}
 */
const shouldUpdateBody = ({ existingBody = null, group, generatedAt, staleDays = BODY_STALE_DAYS }) => {
	const previousOccurrences = extractRenderedOccurrences(existingBody);
	if (previousOccurrences === null) return { update: true, reason: "前回値を読めない（自動領域が無い）" };

	const current = group.occurrences ?? 0;
	if (current >= previousOccurrences * 2 || current * 2 <= previousOccurrences) {
		return { update: true, reason: `件数が ${previousOccurrences} → ${current} と桁で変化` };
	}

	const unrecorded = findUnrecordedCommit(existingBody, group.commits);
	if (unrecorded) return { update: true, reason: `未記載の commit \`${unrecorded}\`（新しいビルドでも発生）` };

	const updatedAt = extractAutoUpdatedAtUtc(existingBody);
	if (!updatedAt) return { update: true, reason: "自動領域の更新時刻を読めない" };
	const ageDays = (toDate(generatedAt).getTime() - toDate(updatedAt).getTime()) / 86400000;
	if (ageDays >= staleDays) return { update: true, reason: `自動領域が ${Math.floor(ageDays)} 日前` };

	return { update: false, reason: `変化なし（${previousOccurrences} → ${current} 件 / ${Math.floor(ageDays)} 日前）` };
};

/** 回帰コメントの冪等マーカー（#1198 §5-D）。 */
const renderRegressionMarker = (fingerprint, lastSeenUtc) =>
	`<!-- error-triage:regression:${fingerprint}:${String(lastSeenUtc).slice(0, 10)} -->`;

/**
 * 回帰コメント本文。
 *
 * @param {{group:Record<string, any>, closedAt:string, eventsAfterGrace:number, graceHours:number, latestCommit?:string|null}} params
 * @returns {string}
 */
const renderRegressionComment = ({ group, closedAt, eventsAfterGrace, graceHours, latestCommit = null }) =>
	[
		"🔁 **回帰を検出しました**",
		"",
		`close（\`${closedAt}\`）から ${graceHours}h 以降に **${eventsAfterGrace} 件 / 影響ユーザー ${group.affectedUsers} 人** 再出現しています。`,
		latestCommit ? `直近commit: \`${latestCommit}\`` : "直近commit: 不明",
		"",
		"誤検知の場合は `err/skip` を付けて close（not planned）してください。以後このfpは完全に無視されます。",
		"",
		renderRegressionMarker(group.fingerprint, group.lastSeenUtc),
	].join("\n");

const formatBytes = (bytes) => `${(bytes / 1000000).toFixed(1)} MB`;

/**
 * 除外内訳の上位N件を markdown 表にする（G5 / §6-4: reason だけでなく eventName / httpStatus 単位）。
 *
 * @param {ReadonlyArray<Record<string, any>>} breakdown
 * @param {number} top
 * @returns {string[]}
 */
const renderExcludedBreakdown = (breakdown, top = 5) => {
	if (!breakdown || breakdown.length === 0) return ["（除外なし）"];
	const sorted = [...breakdown].sort((a, b) => b.count - a.count).slice(0, top);
	return [
		"| reason | eventName | httpStatus | 件数 |",
		"|---|---|---|---|",
		...sorted.map((row) => `| \`${row.reason}\` | ${row.eventName ?? "—"} | ${row.httpStatus ?? "—"} | ${row.count} |`),
	];
};

const ACTION_ICONS = Object.freeze({
	create: "🆕 create",
	reopen: "♻️ reopen",
	"noop-open": "⏸ noop(open)",
	"noop-skip": "⏸ noop(skip)",
	"noop-cooldown": "⏸ noop(cooldown)",
	"noop-wontfix": "⏸ noop(wontfix)",
	capped: "⏭ capped",
	invalid: "⚠️ invalid",
});

/**
 * Job Summary（`$GITHUB_STEP_SUMMARY`）用の markdown。
 *
 * G3: `truncated` が true なら `::warning::` 相当の警告を必ず出す（切り捨てを「全件見た」と誤読させない）。
 *
 * @param {{envelope:Record<string, any>, plan:Record<string, any>, mode?:string}} params
 * @returns {string}
 */
const renderJobSummary = ({ envelope, plan, mode = "dry-run" }) => {
	const { window, query, runSummary } = envelope;
	const lines = [
		`## Error Triage — ${mode} — ${envelope.generatedAt}`,
		"",
		`- 集計窓: \`${window.startUtc}\` 〜 \`${window.endUtc}\`（${window.lookbackHours}h）`,
		`- 見積スキャン: **${formatBytes(query.estimatedBytes)}** / 上限 ${formatBytes(query.maxBytesBilled)}`,
		`- 取得行: ${query.totalRows} / エラーグループ: ${runSummary.groupCount}`,
		`- 予定: create **${plan.counts.create}** / reopen **${plan.counts.reopen}** / capped ${plan.counts.capped} / noop ${plan.counts.noop} / invalid ${plan.counts.invalid}`,
		"",
	];

	if (runSummary.truncated) {
		lines.push(
			`> ⚠️ **切り捨てが発生しています**: グループ ${runSummary.groupCount} 件のうち上位 ${runSummary.groupLimit} 件しか見ていません。全件を見たと誤読しないこと。`,
			"",
		);
	}
	if (plan.panic) {
		lines.push(
			`> ⚠️ **PANIC**: 未知 fingerprint が ${plan.counts.create + plan.counts.capped} 件（閾値 ${plan.panicThreshold}）。1件も起票していません。`,
			"",
		);
	}

	lines.push("| # | action | fingerprint | 系統 | 件数 | 既存 | 理由 |", "|---|---|---|---|---|---|---|");
	plan.items.forEach((item, index) => {
		lines.push(
			`| ${index + 1} | ${ACTION_ICONS[item.action] || item.action} | \`${item.fingerprint ?? "—"}\` | ${item.surface ?? "—"} | ${item.occurrences ?? "—"} | ${item.issueNumber ? `#${item.issueNumber}` : "—"} | ${item.reason} |`,
		);
	});

	lines.push("", "### 除外内訳（上位5）", "", ...renderExcludedBreakdown(runSummary.excludedBreakdown), "");
	return lines.join("\n");
};

/**
 * apply（書き込み）の結果を markdown にする。Job Summary の末尾へ足す。
 *
 * **失敗を必ず可視化する**のが目的。成功したように見えるのが一番まずい（#1198 §1-F）。
 * sub-issue 紐付けの失敗は run を落とさない（横断レビュー §6-2）が、件数は必ずここへ出す。
 *
 * @param {{applyResult:Record<string, any>}} params
 * @returns {string}
 */
const renderApplySummary = ({ applyResult }) => {
	const result = applyResult || {};
	const list = (items, format) => (items && items.length > 0 ? items.map(format).join(" / ") : "—");
	const lines = [
		"",
		`### 適用結果（${result.dryRun ? "dry-run: 書き込みなし" : "apply"}）`,
		"",
		`- 起票: **${(result.created || []).length}** 件 ${list(result.created, (item) => `#${item.issueNumber}`)}`,
		`- reopen: **${(result.reopened || []).length}** 件 ${list(result.reopened, (item) => `#${item.issueNumber}`)}`,
		`- body 更新: ${(result.bodyUpdated || []).length} 件 / 抑止 ${(result.bodySkipped || []).length} 件（#1198 §6-C のスロットリング）`,
		`- sub-issue 紐付け: 成功 ${(result.subIssueLinked || []).length} 件 / **失敗 ${(result.subIssueFailures || []).length} 件**（best-effort。失敗しても run は落としません）`,
		`- commit 日時の解決: ${result.commitLookups ?? 0} 回`,
		`- 親の常駐サマリ: ${result.parentSummary ?? "—"}`,
		"",
	];

	if (result.subIssueIndexOk === false) {
		lines.push(
			`> ⚠️ 親 #${result.parentIssue ?? "?"} の sub-issue 一覧を取得できませんでした（${result.subIssueIndexError ?? "理由不明"}）。`,
			"> この run では第2の索引源が使えず、ラベル1枚だけで突合しています。紐付けの reconcile もスキップしました。",
			"",
		);
	}
	if (result.subIssueFailures && result.subIssueFailures.length > 0) {
		lines.push("| 紐付けに失敗した Issue | 理由 |", "|---|---|");
		for (const failure of result.subIssueFailures) {
			lines.push(`| #${failure.issueNumber} | ${failure.message} |`);
		}
		lines.push("");
	}
	if (result.subIssueCount >= SUB_ISSUE_WARN_THRESHOLD) {
		lines.push(
			`> ⚠️ 親の sub-issue が ${result.subIssueCount} 件です（上限は 100 件と認識）。`,
			"> **古い sub-issue を自動で外すことはしません**（S11。reconcile と競合して付け外しが振動するため）。",
			"> 外すかどうかは人間が判断してください。",
			"",
		);
	}
	if (result.failures && result.failures.length > 0) {
		lines.push("| 失敗した書き込み | 対象 | 理由 |", "|---|---|---|");
		for (const failure of result.failures) {
			lines.push(`| ${failure.stage} | ${failure.target ?? "—"} | ${failure.message} |`);
		}
		lines.push("");
	}
	return lines.join("\n");
};

/**
 * 親 Issue の常駐サマリコメント（#1198 §4-B / G5）。毎回 PATCH で上書きする（通知は飛ばない）。
 *
 * @param {{envelope:Record<string, any>, plan:Record<string, any>, applyResult?:Record<string, any>|null}} params
 * @returns {string}
 */
const renderParentSummaryComment = ({ envelope, plan, applyResult = null }) => {
	const { runSummary } = envelope;
	const oldestDeferred = plan.deferred
		.map((item) => item.firstSeenUtc)
		.filter(Boolean)
		.sort()[0];
	return [
		PARENT_SUMMARY_MARKER,
		`## エラートリアージ 常駐サマリ（schemaVersion ${SCHEMA_VERSION} / fpalgo ${FP_ALGO_VERSION}）`,
		"",
		`最終更新: \`${envelope.generatedAt}\` / 窓 \`${envelope.window.startUtc}\` 〜 \`${envelope.window.endUtc}\``,
		"",
		`- 起票 ${plan.counts.create} / reopen ${plan.counts.reopen} / skip中 ${plan.counts["noop-skip"] ?? 0}`,
		`- **繰り越し ${plan.counts.capped} 件**${oldestDeferred ? `（最古の初観測: \`${oldestDeferred}\`）` : ""}`,
		runSummary.truncated
			? `- ⚠️ **切り捨て**: グループ ${runSummary.groupCount} 件 > 上限 ${runSummary.groupLimit} 件`
			: `- 切り捨て: なし（グループ ${runSummary.groupCount} 件 / 上限 ${runSummary.groupLimit} 件）`,
		"",
		"### 除外内訳（上位5）",
		"",
		...renderExcludedBreakdown(runSummary.excludedBreakdown),
		...(applyResult
			? [
					"",
					"### 直近 run の書き込み結果",
					"",
					`- 起票 ${(applyResult.created || []).map((item) => `#${item.issueNumber}`).join(" / ") || "なし"}`,
					`- reopen ${(applyResult.reopened || []).map((item) => `#${item.issueNumber}`).join(" / ") || "なし"}`,
					`- sub-issue 紐付け 失敗 **${(applyResult.subIssueFailures || []).length} 件**（best-effort。run は落としません）`,
					...(applyResult.subIssueCount >= SUB_ISSUE_WARN_THRESHOLD
						? [
								`- ⚠️ sub-issue が ${applyResult.subIssueCount} 件（上限 100 と認識）。**自動では外しません**（S11）。人間が判断してください`,
							]
						: []),
					...(applyResult.failures && applyResult.failures.length > 0
						? [`- ⚠️ 書き込み失敗 ${applyResult.failures.length} 件（詳細は run の Job Summary）`]
						: []),
				]
			: []),
	].join("\n");
};

module.exports = Object.freeze({
	AUTO_START_MARKER,
	AUTO_END_MARKER,
	PARENT_SUMMARY_MARKER,
	PRESERVED_BODY_NOTICE,
	FP_MARKER_PATTERN,
	FPALGO_MARKER_PATTERN,
	FIRST_SEEN_MARKER_PATTERN,
	AUTO_UPDATED_AT_PATTERN,
	RENDERED_OCCURRENCES_PATTERN,
	FINGERPRINT_PATTERN,
	TITLE_MAX_LENGTH,
	renderFpMarker,
	renderFpAlgoMarker,
	renderFirstSeenMarker,
	extractFingerprints,
	extractAlgoVersion,
	extractFirstSeenUtc,
	extractRenderedOccurrences,
	extractAutoUpdatedAtUtc,
	findUnrecordedCommit,
	shouldUpdateBody,
	describeLocation,
	renderTitle,
	renderAutoSection,
	replaceAutoSection,
	renderIssueBody,
	renderRegressionMarker,
	renderRegressionComment,
	renderExcludedBreakdown,
	renderJobSummary,
	renderApplySummary,
	renderParentSummaryComment,
});
