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
	MIGRATABLE_ALGO_VERSIONS,
	MIN_EVENTS_REOPEN,
	PANIC_THRESHOLD,
	REKEY_LIMIT,
	REOPEN_LIMIT,
	SCHEMA_VERSION,
	SKIP_LABEL,
	SUPPORTED_ALGO_VERSIONS,
	SURFACES,
	FP_ALGO_VERSION,
} = require("./constants");
const { attachFingerprints, computeLegacyFingerprints, FINGERPRINT_PATTERN } = require("./fingerprint");
const { isNormalized, isPathLocaleStripped } = require("./normalize-rules");
const { extractAlgoVersion, extractFingerprints, extractSurface } = require("./render");
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
	// fpalgo 2: pathName から剥がしたロケールの内訳。剥がした情報をここへ移す（CLUSTERING.md 類型1）。
	"localeCounts",
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
	// ロケール内訳は frontend にしか意味が無い（SQL 側では他 surface も NULL 1件として出てくる）。
	group.localeCounts =
		row.surface === "frontend"
			? (row.localeCounts || []).map((entry) => ({ locale: entry.locale ?? null, count: entry.count ?? 0 }))
			: [];
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
 * 戻り値は2階建てになっている（PR #1256 レビュー Minor-2）:
 *   - `errors`      … **エンベロープ全体**が壊れている（run 全体を止める）
 *   - `groupErrors` … **そのグループだけ**が壊れている（そのグループを `invalid` にして先へ進む）
 * 後者は「1つの奇妙なパスのためにその日のトリアージ全体（起票も body 更新も）を止める」のを避けるため。
 * 今のところ groupErrors に落とすのは pathName のロケール剥がし検査だけで、
 * 他の検査（禁止フィールド / 正規化 / fingerprint 形式 / surface）は従来どおり run 全体を止める。
 *
 * @param {Record<string, any>} envelope
 * @returns {{ok:boolean, errors:string[], warnings:string[], groupErrors:Array<{fingerprint:string, reason:string}>}}
 */
const validateEnvelope = (envelope) => {
	const errors = [];
	const warnings = [];
	const groupErrors = [];

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
		// fpalgo 2: pathName は先頭ロケールを剥がした値でなければならない。
		// SQL 側（PATH_LOCALE_RULES から生成した REGEXP_REPLACE）と JS 側がズレると、
		// 同じ画面が再びロケールごとに割れて重複起票される（B-1 と同じ事故の再来）。
		//
		// ★ Minor-2（PR #1256 レビュー）: これは**そのグループだけ**の invalid にする。
		//   `stripPathLocale()` は PATH_LOCALE_RULES を各1回しか掛けないので、ロケール2段のパス
		//   （`/ja/en/foo` → `/en/foo`）では冪等にならず、この検査が false になる。
		//   実在確率は低い（`app-expo/app/` にロケール直下の2文字小文字セグメントは無い）が、
		//   `+not-found.tsx` が任意 URL を拾うのでゼロではない。run 全体を止めると
		//   **その日のトリアージが丸ごと停止**する（起票も body 更新も 0 件）ので、被害が釣り合わない。
		if (group.surface === "frontend" && !isPathLocaleStripped(group.groupKey && group.groupKey.pathName)) {
			groupErrors.push({
				fingerprint: String(group.fingerprint),
				reason: `pathName の先頭ロケールが剥がれていません（fpalgo ${FP_ALGO_VERSION}。SQL と normalize-rules.js のズレ、またはロケール2段のパスを疑うこと）: ${JSON.stringify(group.groupKey.pathName)}`,
			});
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

	return { ok: errors.length === 0, errors, warnings, groupErrors };
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
			// タイトル先頭の `[err/<surface>]`。読めなければ null（＝不明。安全側へ倒す）。
			// Major-1 の「移行が終わるまで frontend の起票を保留する」判定に使う。
			surface: extractSurface(issue.title),
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
	// ★ fpalgo 2 以降: 「現行と違う＝即 abort」ではない。
	//   SUPPORTED_ALGO_VERSIONS に載っている旧世代は `computeLegacyFingerprints()` が
	//   旧 fingerprint を復元して突合するので、**重複起票は起きない**（移行の項を参照）。
	//   abort すべきなのは「復元器を持っていない世代」が混ざったときだけ。
	//   これを区別せず一律 abort にすると、移行のために fingerprint を変えた瞬間に
	//   run が永久に止まり、誰も移行できない（＝旧実装の行き止まり）。
	const unsupported = sorted.filter((version) => !SUPPORTED_ALGO_VERSIONS.includes(version));
	if (unsupported.length === 0) return { ok: true, versions: sorted, message: null };
	return {
		ok: false,
		versions: sorted,
		message: `fpalgo 不一致: 既存 Issue に未知の世代 ${unsupported.join(", ")} があります（現行は ${FP_ALGO_VERSION} / 移行可能な旧世代は ${SUPPORTED_ALGO_VERSIONS.join(", ")}）。この run では1件も書き込みません（#1198 §8-A）`,
	};
};

/**
 * 索引に残っている旧世代（＝リキー待ち）の一覧。
 *
 * `checkAlgoVersions` と違い**止めない**。移行が進行中であることを Job Summary へ出すためだけに使う。
 *
 * @param {Map<string, Array<Record<string, any>>>} index
 * @returns {number[]} 昇順
 */
const pendingAlgoVersions = (index) => {
	const versions = new Set();
	for (const entries of index.values()) {
		for (const entry of entries) {
			if (entry.algoVersion !== FP_ALGO_VERSION && SUPPORTED_ALGO_VERSIONS.includes(entry.algoVersion)) {
				versions.add(entry.algoVersion);
			}
		}
	}
	return [...versions].sort((a, b) => a - b);
};

/**
 * **移行中に frontend の起票を保留すべき理由になっている既存 Issue**（PR #1256 レビュー Major-1）。
 *
 * ■ なぜ保留が要るのか
 *   `computeLegacyFingerprints()` が復元できる旧 fingerprint は、**その run の `localeCounts` に
 *   載っているロケールぶんだけ**である。旧 Issue が持つロケール（例 #1250 の `ar`）がその窓に
 *   1件も出ていなければ復元候補が当たらず、`matchedBy: none` → **新規起票**になる。
 *   起票された瞬間から現行 fingerprint が先に当たるので、**旧 Issue は永久に孤児化する**。
 *   取りこぼし（起票が1日遅れる）は翌日回復できるが、孤児化は人手でしか回復できない。非対称なので保留する。
 *
 * ■ なぜ `pendingAlgoVersions` が空かどうかでは判定できないのか（レビュー提案からの逸脱点）
 *   backend / external の既存 Issue は `keyPathName` が常に NULL で v1 = v2 なので、
 *   **現行 fingerprint でそのまま当たり**（`matchedBy: "current"`）、リキー計画に載らない。
 *   つまりマーカーは fpalgo 1 のまま**永久に残る**。同じことが「もう再発しない frontend の Issue」にも起きる。
 *   `pendingAlgoVersions` が空になるのを待つと **frontend の起票が永久に止まる**（実データで backend 12 / external 1 が該当）。
 *
 * ■ 判定
 *   「この run で突合できなかった」× 「旧世代」× 「open」× 「backend / external と判っていない」
 *   の4条件が揃った Issue だけを保留の理由にする。
 *   - 突合できた旧 Issue は今まさにリキーされるので、もう孤児化しない
 *   - closed の旧 Issue は、孤児化しても「重複 Issue が1件立つ」だけで人手で close できる。
 *     これを保留の理由に含めると、二度と再発しない過去の Issue が起票を永久に止める
 *   - surface が読めない（人間がタイトルを変えた）Issue は frontend 扱い＝安全側
 *
 * @param {{index:Map<string, Array<Record<string, any>>>, matchedNumbers?:Set<number>}} params
 * @returns {Array<Record<string, any>>} issue number 昇順
 */
const migrationBlockers = ({ index, matchedNumbers = new Set() }) => {
	const byNumber = new Map();
	for (const entries of index.values()) {
		for (const entry of entries) {
			if (!MIGRATABLE_ALGO_VERSIONS.includes(entry.algoVersion)) continue;
			if (matchedNumbers.has(entry.number)) continue;
			if (entry.state !== "open") continue;
			if (entry.surface === "backend" || entry.surface === "external") continue;
			byNumber.set(entry.number, entry);
		}
	}
	return [...byNumber.values()].sort((a, b) => a.number - b.number);
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

/**
 * group に対応する既存 Issue を決める。**旧世代 fingerprint での突合をここで吸収する。**
 *
 * ■ これが移行の中核（CLUSTERING.md 末尾「移行方針を決めてから行う」への答え）
 *   1. まず現行 fingerprint で索引を引く。当たればそれで終わり（定常状態）。
 *   2. 当たらなければ `computeLegacyFingerprints()` が復元した**旧 fingerprint 全部**で引く。
 *      ロケールで割れていた既存 Issue（`/ja-JP/...` `/en-US/...` …）はここで見つかる。
 *   3. 複数見つかったら `authoritative()` で決定的に1件へ寄せる（err/skip > open > closed、次に番号昇順）。
 *
 *   **この関数だけで「重複起票しない」は成立する。** マーカーの書き換え（リキー）は
 *   後片付けであって、失敗しても・上限で溢れても重複起票にはならない。
 *
 * ■ 旧世代側の安全弁
 *   復元した旧 fingerprint で当てにいくのは、**まだ旧世代のマーカーを持っている Issue だけ**
 *   （`entry.algoVersion < FP_ALGO_VERSION`）。現行世代の Issue を旧 fingerprint で拾わないので、
 *   万一ハッシュが衝突しても他グループの Issue を奪わない。
 *
 * @param {{index:Map<string, Array<Record<string, any>>>, group:Record<string, any>}} params
 * @returns {{entry:Record<string, any>|null, matchedBy:"current"|"legacy"|"none",
 *            legacyMatches:Array<{fingerprint:string, locale:string, entry:Record<string, any>}>}}
 */
const resolveEntry = ({ index, group }) => {
	const current = authoritative(index.get(group.fingerprint));
	if (current) return { entry: current, matchedBy: "current", legacyMatches: [] };

	const legacyMatches = [];
	const seenNumbers = new Set();
	for (const legacy of computeLegacyFingerprints(group)) {
		for (const entry of index.get(legacy.fingerprint) || []) {
			if (entry.algoVersion >= FP_ALGO_VERSION) continue;
			if (seenNumbers.has(entry.number)) continue;
			seenNumbers.add(entry.number);
			legacyMatches.push({ fingerprint: legacy.fingerprint, locale: legacy.locale, entry });
		}
	}
	if (legacyMatches.length === 0) return { entry: null, matchedBy: "none", legacyMatches: [] };
	return {
		entry: authoritative(legacyMatches.map((match) => match.entry)),
		matchedBy: "legacy",
		legacyMatches,
	};
};

/**
 * 旧世代マーカーの書き換え（リキー）計画を1グループぶん作る。
 *
 * 旧 fingerprint で当たった Issue は**全件**リキー対象にする。1件だけ書き換えて残りを放置すると、
 *   - 索引に旧世代がいつまでも残って「移行が終わった」が判定できない
 *   - 放置された側は誰からも参照されない孤児 fingerprint になる
 * ため。書き換え後は同じ fingerprint を持つ Issue が複数になるが、これは
 * `authoritative()` が元から扱える状態（#1198 §1-D）で、**そもそも同じエラーなので正しい**。
 *
 * ★ Minor-3（PR #1256 レビュー）: 各リキーに**代表 Issue 番号**（`authoritativeNumber`）を載せる。
 *   これが無いと、統合される全員の本文に同じ「このIssueに統合されます」が出て、
 *   人間が「duplicate として close せよ」と言われてもどれを残すか判断できない。
 *   代表は `authoritative()` が決定的に選ぶので、計画の時点で確定できる。
 *
 * @param {{group:Record<string, any>, legacyMatches:ReadonlyArray<Record<string, any>>, authoritativeNumber?:number|null}} params
 * @returns {Array<Record<string, any>>}
 */
const planRekeys = ({ group, legacyMatches, authoritativeNumber = null }) =>
	legacyMatches
		.map((match) => ({
			issueNumber: match.entry.number,
			from: match.fingerprint,
			to: group.fingerprint,
			fromAlgoVersion: match.entry.algoVersion,
			toAlgoVersion: FP_ALGO_VERSION,
			locale: match.locale,
			surface: group.surface,
			// 統合先（代表）の Issue 番号。自分自身が代表なら自分の番号が入る。
			authoritativeNumber,
			// ★ err/skip は「この fingerprint を恒久無視する」宣言。統合先へ引き継ぐと、
			//   1ロケールぶんの無視がクラスタ全体の無視へ**静かに拡大**する。
			//   止めはしない（止めると移行が終わらない）が、必ず可視化する。
			skipLabel: hasSkipLabel(match.entry),
		}))
		.sort((a, b) => a.issueNumber - b.issueNumber);

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
	// 突合が現行 fingerprint / 旧 fingerprint のどちらで成立したか（移行の進み具合が読める）
	matchedBy: decision.matchedBy ?? "none",
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

	// #1196 CLUSTERING.md 末尾の課題への対処。旧世代が残っているなら、それを見えるようにする。
	const pendingVersions = pendingAlgoVersions(index);
	if (pendingVersions.length > 0) {
		warnings.push(
			`fpalgo ${pendingVersions.join(", ")} の Issue が索引に残っています（現行 ${FP_ALGO_VERSION}）。旧 fingerprint を復元して突合するので**重複起票にはなりません**。マーカーはこの run のリキーで順次書き換えます`,
		);
	}

	// そのグループだけを invalid にする検査（Minor-2）。fingerprint → 理由。
	const groupErrors = new Map((validation.groupErrors || []).map((entry) => [entry.fingerprint, entry.reason]));
	for (const [fingerprint, reason] of groupErrors) {
		warnings.push(
			`fp:${fingerprint} をこの run では invalid として扱います（他のグループは処理を続けます）: ${reason}`,
		);
	}

	// --- パス1: 突合と分類。起票するかどうかはまだ決めない ---
	//     「この run でどの旧 Issue に突合できたか」が全グループを見終わるまで確定しないため、
	//     保留（Major-1）の判定はパス2へ回す。
	const resolvedGroups = [];
	const decisions = [];
	const rekeys = [];
	const matchedNumbers = new Set();
	for (const group of envelope.groups || []) {
		if (!SURFACES.includes(group.surface)) {
			decisions.push({ group, decision: { action: "invalid", reason: "未知の surface", issueNumber: null } });
			continue;
		}
		// グループ単位の契約違反。突合も起票も body 更新もせず、可視化だけして次へ進む。
		if (groupErrors.has(group.fingerprint)) {
			decisions.push({
				group,
				decision: { action: "invalid", reason: groupErrors.get(group.fingerprint), issueNumber: null },
			});
			continue;
		}
		const resolved = resolveEntry({ index, group });
		if (resolved.entry) matchedNumbers.add(resolved.entry.number);
		if (resolved.matchedBy === "legacy") {
			for (const match of resolved.legacyMatches) matchedNumbers.add(match.entry.number);
			rekeys.push(
				...planRekeys({
					group,
					legacyMatches: resolved.legacyMatches,
					authoritativeNumber: resolved.entry ? resolved.entry.number : null,
				}),
			);
		}
		const decision = classifyGroup({
			group,
			entry: resolved.entry,
			graceHours,
			minEventsReopen,
			commitDates,
		});
		decision.matchedBy = resolved.matchedBy;
		if (resolved.matchedBy === "legacy") {
			decision.reason = `${decision.reason}（旧 fingerprint fp:${resolved.legacyMatches[0].fingerprint} で突合。リキー対象 ${resolved.legacyMatches.length} 件）`;
		}
		resolvedGroups.push({ group, decision });
	}

	// --- パス2: 移行中の起票保留（Major-1）---
	//     まだ突合できていない旧世代 Issue が残っている間、frontend の起票を止める。
	//     判定条件の根拠は migrationBlockers() のコメントを参照（`pendingAlgoVersions` では判定できない）。
	const blockers = migrationBlockers({ index, matchedNumbers });
	const migrationPending = blockers.length > 0;
	if (migrationPending) {
		warnings.push(
			`移行中のため frontend の新規起票を保留します。この run で突合できなかった fpalgo ${MIGRATABLE_ALGO_VERSIONS.join(", ")} の open Issue が ${blockers.length} 件あります: ${blockers.map((entry) => `#${entry.number}`).join(", ")}。` +
				`これらのロケールが窓に出ていない状態で起票すると、同じエラーの Issue が二重に立ち、旧 Issue が**永久に孤児化**します。` +
				`全件がリキーされる（＝\`--dry-run\` のリキー表に載る）か、人間が close すれば自動的に再開します。backend / external は v1 = v2 なので保留しません`,
		);
	}
	const createCandidates = [];
	// 移行中に保留した起票候補（数えられるようにしておく。人間が「いつ移行が終わったか」を判定する材料）。
	const withheld = [];
	for (const { group, decision } of resolvedGroups) {
		if (decision.action === "create" && migrationPending && group.surface === "frontend") {
			// PANIC / CREATE_LIMIT と違い「次回 run へ繰り越し」ではなく「移行完了まで保留」。
			decision.action = "withheld";
			decision.reason = `fpalgo ${MIGRATABLE_ALGO_VERSIONS.join(", ")} → ${FP_ALGO_VERSION} の移行中のため起票を保留（未突合の旧 Issue ${blockers.map((entry) => `#${entry.number}`).join(", ")} を孤児化させないため）。移行完了後の run で起票されます`;
			withheld.push(group);
			decisions.push({ group, decision });
			continue;
		}
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

	// リキーは「マーカーの後片付け」なので、計画としては abort（未知世代）のときだけ落とす。
	// PANIC / 契約違反のときに実際に PATCH するかどうかは main.js が決める
	// （`applyPlan({ dryRun: dryRun || blocked })` により、止めた run では1バイトも書かない）。
	// 上限で抑えるのは、body の PATCH が数十件走ると Issue 一覧の updated_at が一斉に動くため。
	const rekeyLimit = limits.rekeyLimit ?? REKEY_LIMIT;
	const plannedRekeys = algo.ok ? rekeys.slice(0, rekeyLimit) : [];
	const deferredRekeys = algo.ok ? rekeys.slice(rekeyLimit) : [...rekeys];
	if (deferredRekeys.length > 0) {
		warnings.push(
			`fingerprint リキーが 1 run の上限 ${rekeyLimit} 件を超えました（残り ${deferredRekeys.length} 件は次回 run）。重複起票にはなりません（突合は旧 fingerprint の復元で成立しています）`,
		);
	}
	for (const rekey of plannedRekeys.filter((entry) => entry.skipLabel)) {
		warnings.push(
			`#${rekey.issueNumber} は \`${SKIP_LABEL}\` 付きのまま fp:${rekey.from} → fp:${rekey.to} へ統合されます。統合先（ロケール横断のクラスタ全体）が恒久無視になります。意図しない場合は \`${SKIP_LABEL}\` を外してください`,
		);
	}

	const items = decisions.map(({ group, decision }) => summarizeItem(group, decision));

	// `withheld` は「移行中なので起票しない」。0 のときもキーを出す（＝毎 run 数えられる）。
	const counts = { create: 0, reopen: 0, capped: 0, invalid: 0, noop: 0, withheld: 0 };
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
		// 索引に残っている旧世代（＝リキー待ち）。空になったら移行完了。
		pendingAlgoVersions: pendingVersions,
		// 移行中か（＝frontend の起票を保留しているか）。
		migrationPending,
		// 保留の理由になっている既存 Issue（Major-1）。空になったら保留は自動的に解除される。
		migrationBlockers: blockers.map((entry) => ({
			number: entry.number,
			state: entry.state,
			surface: entry.surface,
			algoVersion: entry.algoVersion,
		})),
		// 移行中に保留した起票候補（Major-1）。`counts.withheld` と同じ件数。
		withheld: withheld.map((group) =>
			summarizeItem(group, {
				action: "withheld",
				reason: `fpalgo ${MIGRATABLE_ALGO_VERSIONS.join(", ")} → ${FP_ALGO_VERSION} の移行中のため保留`,
				issueNumber: null,
			}),
		),
		// グループ単位の契約違反（Minor-2）。run 全体は止めない。
		invalidGroups: [...groupErrors].map(([fingerprint, reason]) => ({ fingerprint, reason })),
		// 旧世代マーカーの書き換え計画。**この run で実際に PATCH するぶんだけ**が rekeys。
		rekeys: plannedRekeys,
		deferredRekeys,
		limits: { createLimit, reopenLimit, panicThreshold, graceHours, minEventsReopen, rekeyLimit },
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
	pendingAlgoVersions,
	migrationBlockers,
	authoritative,
	resolveEntry,
	planRekeys,
	hasSkipLabel,
	isRegression,
	classifyGroup,
	classifyQueue,
	pickCreations,
	buildPlan,
	minTimestamp,
});
