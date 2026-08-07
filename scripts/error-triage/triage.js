// #1196 error-triage / 契約エンベロープの組み立て・検証と、突合〜起票計画（純関数）。
//
// 入力は引数だけ、出力は戻り値だけ。ネットワークもファイルシステムも触らない。
// BigQuery からの取得（bq.js）と GitHub への書き込み（github.js）は PR2 / PR3 の担当で、
// このモジュールは「取れたもの」と「読めたもの」だけを受け取る。

"use strict";

const {
	CREATE_LIMIT,
	GRACE_HOURS,
	GROUP_LIMIT,
	MIN_EVENTS_REOPEN,
	PANIC_THRESHOLD,
	REOPEN_LIMIT,
	SCHEMA_VERSION,
	SKIP_LABEL,
	SURFACES,
	FP_ALGO_VERSION,
} = require("./constants");
const { attachFingerprints, FINGERPRINT_PATTERN } = require("./fingerprint");
const { isNormalized } = require("./normalize-rules");
const { extractAlgoVersion, extractFingerprints } = require("./render");
const { addHours, minTimestamp, toDate } = require("./window");

/** 契約 §7 の groupKey に載ってよいフィールド（許可リスト）。 */
const GROUP_KEY_FIELDS = Object.freeze([
	"eventName",
	"pathName",
	"functionName",
	"apiName",
	"endpoint",
	"method",
	"statusCode",
	"httpStatus",
	"route",
	"errorCode",
]);

/** 契約 §7 の group に載ってよいフィールド（許可リスト。fingerprint は JS が後から載せる）。 */
const GROUP_FIELDS = Object.freeze([
	"surface",
	"groupKey",
	"messagePattern",
	"occurrences",
	"affectedUsers",
	"anonymousOccurrences",
	"firstSeenUtc",
	"lastSeenUtc",
	"hourlyCounts",
	"commits",
	"appVersions",
	"representativeCommit",
]);

/**
 * 契約に絶対に現れてはいけないフィールド名（不変条件 4）。
 * `user_id` の値そのもの、payload 各種、緯度経度、検索クエリ。
 */
const FORBIDDEN_FIELDS = Object.freeze([
	"userId",
	"user_id",
	"payload",
	"requestPayload",
	"request_payload",
	"responsePayload",
	"response_payload",
	"samplePayload",
	"sampleMessage",
	"rawMessage",
	"raw_message",
	"lat",
	"lng",
	"latitude",
	"longitude",
	"query",
]);

/** 正規化後の値でなければならないフィールド（不変条件 3）。 */
const NORMALIZED_FIELDS = Object.freeze(["messagePattern", "route", "endpoint", "pathName"]);

const pick = (source, fields) => {
	const out = {};
	for (const field of fields) {
		if (source && Object.prototype.hasOwnProperty.call(source, field)) out[field] = source[field];
		else out[field] = null;
	}
	return out;
};

/**
 * SQL の1出力行を契約の group 形へ**許可リストで**射影する。
 *
 * 拒否リストではなく許可リストにするのが要点（#1197 §6）。SQL が将来うっかり生 payload を
 * 出すようになっても、ここを通った時点で落ちる。
 *
 * @param {Record<string, any>} row
 * @returns {Record<string, any>}
 */
const projectGroup = (row) => {
	const group = pick(row, GROUP_FIELDS);
	group.groupKey = pick(row.groupKey, GROUP_KEY_FIELDS);
	group.hourlyCounts = (row.hourlyCounts || []).map((bucket) => ({
		hourUtc: bucket.hourUtc,
		count: bucket.count,
	}));
	group.commits = (row.commits || []).map((commit) => ({ sha: commit.sha, count: commit.count }));
	group.appVersions = [...(row.appVersions || [])];
	group.occurrences = row.occurrences ?? 0;
	group.affectedUsers = row.affectedUsers ?? 0;
	group.anonymousOccurrences = row.anonymousOccurrences ?? 0;
	return group;
};

/**
 * SQL の出力行群から契約エンベロープを組み立てる。
 *
 * - **再グルーピングしない**。1行 ⇔ 1グループ（不変条件 1）。
 * - 未知 surface の行は破棄して警告（不変条件 6）。
 * - fingerprint は JS がここで注入する（`fpAlgoVersion` も同様。SQL は知らない = 矛盾B）。
 *
 * @param {{
 *   rows: ReadonlyArray<Record<string, any>>,
 *   runSummary: Record<string, any>,
 *   window: {startUtc:string, endUtc:string, lookbackHours:number},
 *   generatedAt: string,
 *   query: {estimatedBytes:number, maxBytesBilled:number, totalRows:number},
 * }} params
 * @returns {{envelope: Record<string, any>, warnings: string[]}}
 */
const buildEnvelope = ({ rows, runSummary, window, generatedAt, query }) => {
	const warnings = [];
	const accepted = [];
	for (const row of rows) {
		if (!SURFACES.includes(row && row.surface)) {
			warnings.push(`未知の surface を破棄しました: ${JSON.stringify(row && row.surface)}`);
			continue;
		}
		accepted.push(projectGroup(row));
	}

	const groupCount = runSummary.groupCount ?? accepted.length;
	const groupLimit = runSummary.groupLimit ?? GROUP_LIMIT;

	const envelope = {
		schemaVersion: SCHEMA_VERSION,
		fpAlgoVersion: FP_ALGO_VERSION,
		generatedAt,
		window: { ...window },
		query: { ...query },
		runSummary: {
			groupCount,
			groupLimit,
			// G3: LIMIT 適用「前」の総グループ数と比較する。適用後から数えると原理的に検知できない。
			truncated: groupCount > groupLimit,
			keptRows: runSummary.keptRows ?? 0,
			excludedRows: runSummary.excludedRows ?? 0,
			excludedBreakdown: (runSummary.excludedBreakdown || []).map((entry) => ({
				reason: entry.reason,
				eventName: entry.eventName ?? null,
				httpStatus: entry.httpStatus ?? null,
				count: entry.count,
			})),
		},
		groups: attachFingerprints(accepted),
	};
	return { envelope, warnings };
};

/**
 * 再帰的に禁止フィールドを探す（不変条件 4 の検査）。
 *
 * @param {unknown} node
 * @param {string} path
 * @param {string[]} found
 * @returns {string[]}
 */
const findForbiddenFields = (node, path = "$", found = []) => {
	if (Array.isArray(node)) {
		node.forEach((item, index) => findForbiddenFields(item, `${path}[${index}]`, found));
		return found;
	}
	if (node && typeof node === "object") {
		for (const [key, value] of Object.entries(node)) {
			if (FORBIDDEN_FIELDS.includes(key)) found.push(`${path}.${key}`);
			findForbiddenFields(value, `${path}.${key}`, found);
		}
	}
	return found;
};

/**
 * 契約エンベロープを検証する。§7 の不変条件を実行時にも守らせる。
 *
 * @param {Record<string, any>} envelope
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
const validateEnvelope = (envelope) => {
	const errors = [];
	const warnings = [];

	if (envelope.schemaVersion !== SCHEMA_VERSION) {
		errors.push(`schemaVersion 不一致: ${envelope.schemaVersion} (期待 ${SCHEMA_VERSION})`);
	}
	if (envelope.fpAlgoVersion !== FP_ALGO_VERSION) {
		errors.push(`fpAlgoVersion 不一致: ${envelope.fpAlgoVersion} (期待 ${FP_ALGO_VERSION})`);
	}

	// 検査対象は `groups`（＝ SQL 由来のデータが載る唯一の場所）に限る。
	// エンベロープ直下の `query` は BigQuery ジョブの見積り情報であって、
	// 禁止された「ユーザーの検索文字列（payload.$.query）」とは別物。
	for (const path of findForbiddenFields(envelope.groups || [], "$.groups")) {
		errors.push(`契約に現れてはいけないフィールドです（不変条件 4）: ${path}`);
	}

	for (const group of envelope.groups || []) {
		if (!SURFACES.includes(group.surface)) {
			errors.push(`未知の surface: ${JSON.stringify(group.surface)}`);
			continue;
		}
		if (!FINGERPRINT_PATTERN.test(String(group.fingerprint))) {
			errors.push(`fingerprint が 12桁小文字hex ではありません: ${group.fingerprint}`);
		}
		const candidates = {
			messagePattern: group.messagePattern,
			route: group.groupKey && group.groupKey.route,
			endpoint: group.groupKey && group.groupKey.endpoint,
			pathName: group.groupKey && group.groupKey.pathName,
		};
		for (const field of NORMALIZED_FIELDS) {
			if (!isNormalized(candidates[field])) {
				errors.push(
					`${field} が正規化後の値ではありません（不変条件 3。生値を契約へ出していないか確認すること）: ${JSON.stringify(candidates[field])}`,
				);
			}
		}
		if (group.affectedUsers === 0 && group.anonymousOccurrences === 0 && group.occurrences > 0) {
			warnings.push(
				`fp:${group.fingerprint} は affectedUsers も anonymousOccurrences も 0 です（SQL 側の集計を確認すること）`,
			);
		}
	}

	return { ok: errors.length === 0, errors, warnings };
};

// ---------------------------------------------------------------------------
// 索引（既存 Issue → fingerprint）
// ---------------------------------------------------------------------------

/**
 * GitHub から取得済みの Issue 一覧（生 JSON の配列）から fingerprint 索引を作る。
 *
 * 取得そのものは PR3 の github.js。ここは受け取った配列を捌くだけの純関数。
 * - PR（`pull_request` を持つ要素）は捨てる。REST の list issues は PR も返す。
 * - fp マーカーを持たない Issue は捨てる。親 #1196 や設計 Sub-issue はこれで自然に外れる
 *   （ラベルだけで判定しないのが要点。#1198 §7-10）。
 * - 1 body に複数 fp があれば**全ての fp の索引に登録**する（安全側 = 起票しない側）。
 *
 * @param {ReadonlyArray<Record<string, any>>} issues
 * @returns {{index: Map<string, Array<Record<string, any>>>, warnings: string[]}}
 */
const buildIndex = (issues) => {
	const index = new Map();
	const warnings = [];
	for (const issue of issues) {
		if (issue.pull_request) continue;
		const fingerprints = extractFingerprints(issue.body);
		if (fingerprints.length === 0) continue;
		if (fingerprints.length > 1) {
			warnings.push(`#${issue.number} に複数の fingerprint があります: ${fingerprints.join(", ")}`);
		}
		const entry = {
			number: issue.number,
			id: issue.id,
			state: issue.state,
			stateReason: issue.state_reason ?? null,
			labels: (issue.labels || []).map((label) => (typeof label === "string" ? label : label.name)),
			closedAt: issue.closed_at ?? null,
			updatedAt: issue.updated_at ?? null,
			algoVersion: extractAlgoVersion(issue.body),
			body: issue.body ?? "",
		};
		for (const fingerprint of fingerprints) {
			if (!index.has(fingerprint)) index.set(fingerprint, []);
			index.get(fingerprint).push(entry);
		}
	}
	return { index, warnings };
};

const hasSkipLabel = (entry) => entry.labels.includes(SKIP_LABEL);

/**
 * 索引に載っている既存 Issue の `fpalgo` が、現行の `FP_ALGO_VERSION` と揃っているかを見る（#1198 §8-A）。
 *
 * fingerprint 定義を変えると既存 Issue との突合が全部外れ、**全件が新規起票**になる。
 * PANIC ブレーカーでも起票は止まるが、「なぜ止まったのか」が分からない。
 * `fpalgo` が1件でも食い違ったら、その run は**1件も書かずに止める**。
 * 索引が空（初回）のときは不一致にしない。
 *
 * @param {Map<string, Array<Record<string, any>>>} index
 * @returns {{ok:boolean, versions:number[], message:string|null}}
 */
const checkAlgoVersions = (index) => {
	const versions = new Set();
	for (const entries of index.values()) {
		for (const entry of entries) versions.add(entry.algoVersion);
	}
	const sorted = [...versions].sort((a, b) => a - b);
	if (sorted.length === 0 || (sorted.length === 1 && sorted[0] === FP_ALGO_VERSION)) {
		return { ok: true, versions: sorted, message: null };
	}
	return {
		ok: false,
		versions: sorted,
		message: `fpalgo 不一致: 既存 Issue は ${sorted.join(", ")} / 現行は ${FP_ALGO_VERSION}。移行 run を先に実行してください（#1198 §8-B）。この run では1件も書き込みません`,
	};
};

/**
 * 同一 fp に複数 Issue があるとき、決定的に1件を選ぶ（#1198 §1-D）。
 * `err/skip` 付き → open → closed の順。同順位は issue number 昇順（＝古い方）。
 *
 * @param {ReadonlyArray<Record<string, any>>} entries
 * @returns {Record<string, any>|null}
 */
const authoritative = (entries) => {
	if (!entries || entries.length === 0) return null;
	const rank = (entry) => (hasSkipLabel(entry) ? 0 : entry.state === "open" ? 1 : 2);
	return [...entries].sort((a, b) => rank(a) - rank(b) || a.number - b.number)[0];
};

// ---------------------------------------------------------------------------
// 再発（regression）判定
// ---------------------------------------------------------------------------

/**
 * 再発判定（#1198 §5-A。`dailyCounts` ではなく `hourlyCounts` を使う = 矛盾B / S5）。
 *
 * @param {{
 *   group: Record<string, any>,
 *   entry: Record<string, any>,
 *   graceHours?: number,
 *   minEventsReopen?: number,
 *   commitDates?: Record<string, string>,
 * }} params
 * @returns {{regression:boolean, reason:string, eventsAfterGrace:number, thresholdUtc:string|null}}
 */
const isRegression = ({
	group,
	entry,
	graceHours = GRACE_HOURS,
	minEventsReopen = MIN_EVENTS_REOPEN,
	commitDates = {},
}) => {
	if (!entry.closedAt) {
		return { regression: false, reason: "closedAt が無い", eventsAfterGrace: 0, thresholdUtc: null };
	}
	const threshold = addHours(entry.closedAt, graceHours);
	const thresholdUtc = threshold.toISOString().slice(0, 19) + "Z";

	if (toDate(group.lastSeenUtc).getTime() <= threshold.getTime()) {
		return { regression: false, reason: `close + ${graceHours}h 以内`, eventsAfterGrace: 0, thresholdUtc };
	}

	// 時間バケットの境界合わせは切り捨て方向（バケット開始が閾値以降のものだけ数える）。
	// 過小に数えるが、過小 = reopen しない側なので安全。
	const eventsAfterGrace = (group.hourlyCounts || [])
		.filter((bucket) => toDate(bucket.hourUtc).getTime() >= threshold.getTime())
		.reduce((sum, bucket) => sum + bucket.count, 0);

	if (eventsAfterGrace < minEventsReopen) {
		return {
			regression: false,
			reason: `猶予後 ${eventsAfterGrace} 件 < ${minEventsReopen}`,
			eventsAfterGrace,
			thresholdUtc,
		};
	}

	// 旧ビルド由来だけなら抑止する。日時が1つも解決できないときはこの検査をスキップする。
	const knownDates = (group.commits || [])
		.map((commit) => commitDates[commit.sha])
		.filter(Boolean)
		.map((date) => toDate(date).getTime());
	if (knownDates.length > 0 && knownDates.every((date) => date < toDate(entry.closedAt).getTime())) {
		return {
			regression: false,
			reason: "全 commit が close 以前＝旧ビルド滞留",
			eventsAfterGrace,
			thresholdUtc,
		};
	}

	return {
		regression: true,
		reason: `猶予後 ${eventsAfterGrace} 件 / 新しい build 由来`,
		eventsAfterGrace,
		thresholdUtc,
	};
};

// ---------------------------------------------------------------------------
// 状態遷移（#1198 §1-E）
// ---------------------------------------------------------------------------

/**
 * 1グループの行き先を決める。書き込みは一切しない。
 *
 * @param {{group:Record<string, any>, entry:Record<string, any>|null, graceHours?:number, minEventsReopen?:number, commitDates?:Record<string,string>}} params
 * @returns {{action:string, reason:string, issueNumber:number|null, regression?:Record<string, any>}}
 */
const classifyGroup = ({
	group,
	entry,
	graceHours = GRACE_HOURS,
	minEventsReopen = MIN_EVENTS_REOPEN,
	commitDates = {},
}) => {
	if (!entry) return { action: "create", reason: "unknown-fingerprint", issueNumber: null };
	// err/skip は open / closed どちらでも常に skip（人間がラベルだけ付けて閉じ忘れることは普通にある）。
	if (hasSkipLabel(entry)) return { action: "noop-skip", reason: "err/skip により恒久無視", issueNumber: entry.number };
	if (entry.state === "open") return { action: "noop-open", reason: "既に open", issueNumber: entry.number };
	if (entry.stateReason === "not_planned") {
		return {
			action: "noop-wontfix",
			reason: "closed(not planned)。`err/skip` の付与を推奨",
			issueNumber: entry.number,
		};
	}
	const regression = isRegression({ group, entry, graceHours, minEventsReopen, commitDates });
	if (regression.regression) {
		return { action: "reopen", reason: regression.reason, issueNumber: entry.number, regression };
	}
	return { action: "noop-cooldown", reason: regression.reason, issueNumber: entry.number, regression };
};

// ---------------------------------------------------------------------------
// 起票の優先順位付け（横断レビュー S4）
// ---------------------------------------------------------------------------

/**
 * ラウンドロビンの軸。**surface 間ではなく「識別済み / 匿名」間**で回す。
 *
 * 横断レビュー S4:
 *   `user_id` は未認証リクエストで NULL になるため、サインアップ・ログイン経路の障害は
 *   `affectedUsers = 0` になり、影響ユーザー数を主キーにした優先順位付けで常に最下位に沈む。
 *   **新規ユーザー全員に影響する最悪のバグが最下位**という反転が起きる。
 *   `anonymousOccurrences` を別キューとして扱い、枠を交互に配ることでこれを救う。
 *   （#1198 §4-A の「surface 間ラウンドロビン」は、そもそも
 *     `external でも affectedUsers は取れる`（logger.service.ts:108）ので前提が誤り。）
 */
const QUEUE_ORDER = Object.freeze(["identified", "anonymous"]);

/**
 * グループがどちらのキューに属するか。
 *
 * `affectedUsers > 0` なら識別済み。それ以外（`affectedUsers === 0`）は匿名キュー。
 * 契約上 `occurrences > 0` なら `affectedUsers` か `anonymousOccurrences` のどちらかは正なので、
 * 「両方 0」は SQL 側の異常。validateEnvelope が warning を出したうえで匿名キューへ入れる。
 *
 * @param {Record<string, any>} group
 * @returns {"identified"|"anonymous"}
 */
const classifyQueue = (group) => (group.affectedUsers > 0 ? "identified" : "anonymous");

const compareIdentified = (a, b) =>
	b.affectedUsers - a.affectedUsers ||
	b.occurrences - a.occurrences ||
	String(a.firstSeenUtc).localeCompare(String(b.firstSeenUtc)) ||
	a.fingerprint.localeCompare(b.fingerprint);

const compareAnonymous = (a, b) =>
	b.anonymousOccurrences - a.anonymousOccurrences ||
	b.occurrences - a.occurrences ||
	String(a.firstSeenUtc).localeCompare(String(b.firstSeenUtc)) ||
	a.fingerprint.localeCompare(b.fingerprint);

const QUEUE_COMPARATORS = Object.freeze({
	identified: compareIdentified,
	anonymous: compareAnonymous,
});

/**
 * 起票候補から今回の枠ぶんを選ぶ。溢れた分は `deferred`（次回に回す。状態は持たない）。
 *
 * @param {ReadonlyArray<Record<string, any>>} candidates
 * @param {{limit?: number}} options
 * @returns {{picked: Array<Record<string, any>>, deferred: Array<Record<string, any>>}}
 */
const pickCreations = (candidates, { limit = CREATE_LIMIT } = {}) => {
	const queues = { identified: [], anonymous: [] };
	for (const candidate of candidates) queues[classifyQueue(candidate)].push(candidate);
	for (const name of QUEUE_ORDER) queues[name].sort(QUEUE_COMPARATORS[name]);

	const picked = [];
	while (picked.length < limit && QUEUE_ORDER.some((name) => queues[name].length > 0)) {
		for (const name of QUEUE_ORDER) {
			if (picked.length >= limit) break;
			if (queues[name].length > 0) picked.push(queues[name].shift());
		}
	}
	const pickedSet = new Set(picked);
	const deferred = candidates.filter((candidate) => !pickedSet.has(candidate));
	return { picked, deferred };
};

// ---------------------------------------------------------------------------
// 起票計画
// ---------------------------------------------------------------------------

const summarizeItem = (group, decision) => ({
	action: decision.action,
	reason: decision.reason,
	fingerprint: group.fingerprint,
	surface: group.surface,
	occurrences: group.occurrences,
	affectedUsers: group.affectedUsers,
	anonymousOccurrences: group.anonymousOccurrences,
	firstSeenUtc: group.firstSeenUtc,
	lastSeenUtc: group.lastSeenUtc,
	issueNumber: decision.issueNumber,
	queue: classifyQueue(group),
});

/**
 * 起票計画を作る。**書き込み API を一切含まない**（#1198 Phase 0〜3）。
 *
 * dry-run と execute の差は「この計画を適用するかどうか」だけで、計画そのものは同一になる。
 *
 * @param {{
 *   envelope: Record<string, any>,
 *   issues?: ReadonlyArray<Record<string, any>>,
 *   commitDates?: Record<string, string>,
 *   limits?: {createLimit?:number, reopenLimit?:number, panicThreshold?:number, graceHours?:number, minEventsReopen?:number},
 * }} params
 * @returns {Record<string, any>}
 */
const buildPlan = ({ envelope, issues = [], commitDates = {}, limits = {} }) => {
	const createLimit = limits.createLimit ?? CREATE_LIMIT;
	const reopenLimit = limits.reopenLimit ?? REOPEN_LIMIT;
	const panicThreshold = limits.panicThreshold ?? PANIC_THRESHOLD;
	const graceHours = limits.graceHours ?? GRACE_HOURS;
	const minEventsReopen = limits.minEventsReopen ?? MIN_EVENTS_REOPEN;

	const validation = validateEnvelope(envelope);
	const { index, warnings: indexWarnings } = buildIndex(issues);
	const warnings = [...validation.warnings, ...indexWarnings];

	// #1198 §8-A: fingerprint 世代が食い違ったら、この run は1件も書かない。
	// PANIC と同じく「起票候補を全部 capped にする」形で計画へ表現し、
	// `abort` フラグで呼び出し側（main.js の apply）に書き込みを止めさせる。
	const algo = checkAlgoVersions(index);
	if (!algo.ok) warnings.push(algo.message);

	const decisions = [];
	const createCandidates = [];
	for (const group of envelope.groups || []) {
		if (!SURFACES.includes(group.surface)) {
			decisions.push({ group, decision: { action: "invalid", reason: "未知の surface", issueNumber: null } });
			continue;
		}
		const entry = authoritative(index.get(group.fingerprint));
		const decision = classifyGroup({ group, entry, graceHours, minEventsReopen, commitDates });
		if (decision.action === "create") createCandidates.push(group);
		else decisions.push({ group, decision });
	}

	const panic = createCandidates.length > panicThreshold;
	const { picked, deferred } =
		panic || !algo.ok
			? { picked: [], deferred: [...createCandidates] }
			: pickCreations(createCandidates, { limit: createLimit });

	for (const group of picked) {
		decisions.push({ group, decision: { action: "create", reason: "unknown-fingerprint", issueNumber: null } });
	}
	for (const group of deferred) {
		decisions.push({
			group,
			decision: {
				action: "capped",
				reason: !algo.ok
					? algo.message
					: panic
						? `PANIC: 未知 fingerprint ${createCandidates.length} 件 > 閾値 ${panicThreshold}`
						: `1 run の起票上限 ${createLimit} 件を超過。次回 run へ繰り越し`,
				issueNumber: null,
			},
		});
	}

	// 回帰は起票より優先（#1198 §1-F）。上限で溢れた分は黙って落とさず capped として可視化する。
	// 溢れる順序が run ごとにぶれないよう、識別済みキューと同じ比較関数で決定的に並べる。
	const reopens = decisions
		.filter(({ decision }) => decision.action === "reopen")
		.sort((a, b) => compareIdentified(a.group, b.group));
	// fpalgo 不一致のときは reopen も含めて1件も書かない（起票だけ止めても状態機械は壊れたまま）。
	reopens.slice(algo.ok ? reopenLimit : 0).forEach(({ decision }) => {
		decision.action = "capped";
		decision.reason = algo.ok ? `1 run の reopen 上限 ${reopenLimit} 件を超過。次回 run へ繰り越し` : algo.message;
	});

	const items = decisions.map(({ group, decision }) => summarizeItem(group, decision));

	const counts = { create: 0, reopen: 0, capped: 0, invalid: 0, noop: 0 };
	for (const item of items) {
		counts[item.action] = (counts[item.action] || 0) + 1;
		if (item.action.startsWith("noop")) counts.noop += 1;
	}

	return {
		schemaVersion: envelope.schemaVersion,
		fpAlgoVersion: envelope.fpAlgoVersion,
		generatedAt: envelope.generatedAt,
		window: { ...envelope.window },
		panic,
		panicThreshold,
		// 書き込みを丸ごと止めるべき理由があるか（#1198 §8-A）。apply はこれを見て何も書かずに exit 1 する。
		abort: !algo.ok,
		abortReason: algo.ok ? null : algo.message,
		algoVersions: algo.versions,
		limits: { createLimit, reopenLimit, panicThreshold, graceHours, minEventsReopen },
		valid: validation.ok,
		errors: validation.errors,
		warnings,
		counts,
		items,
		deferred: deferred.map((group) =>
			summarizeItem(group, { action: "capped", reason: "繰り越し", issueNumber: null }),
		),
	};
};

module.exports = Object.freeze({
	GROUP_FIELDS,
	GROUP_KEY_FIELDS,
	FORBIDDEN_FIELDS,
	NORMALIZED_FIELDS,
	QUEUE_ORDER,
	projectGroup,
	buildEnvelope,
	findForbiddenFields,
	validateEnvelope,
	buildIndex,
	checkAlgoVersions,
	authoritative,
	hasSkipLabel,
	isRegression,
	classifyGroup,
	classifyQueue,
	pickCreations,
	buildPlan,
	minTimestamp,
});
