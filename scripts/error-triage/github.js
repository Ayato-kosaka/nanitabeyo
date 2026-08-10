// #1196 error-triage / GitHub API 層（唯一の**不可逆な副作用**の置き場所）と、起票計画の適用。
//
// 依存パッケージは1つも増やしません。Node 組み込み `fetch` のみ（`@octokit/*` を入れない）。
// `fetch` は差し替え可能で、テストは本物の GitHub を叩きません。
//
// ■ 索引は `list_issues` のラベルフィルタで作る（#1196 確定 / #1198 §1-B）
//   `search_issues` は**使いません**。検索インデックスの反映が遅れるため、起票直後の run で
//   「まだ検索に出てこない」→「未知 fingerprint」→ **重複起票**、が普通に起きます。
//   `GET /repos/{o}/{r}/issues?labels=error-triage&state=all` は検索インデックス非依存です。
//   `sort=created&direction=asc` を明示するのは、既定の `created desc` だとページング中に
//   新規 Issue ができた瞬間に全体が後ろへずれて1件読み飛ばすためです（昇順なら末尾に付く）。
//   `since` も使いません（`updated_at` フィルタなので、半年前に close されて以後触られていない
//   Issue が索引から落ち、再発判定が「未知 fp → 新規起票」に化けます）。
//
// ■ 第2の索引源（横断レビュー §4）
//   `GET /repos/{o}/{r}/issues/{親}/sub_issues` を和集合に入れます。ラベルに一切依存しないので、
//   人間が `error-triage` ラベルを外しても救われます（`err/auto` の2枚目ラベルは §4 で却下）。
//   **これが失敗しても run は落としません**。落ちるのは第2索引源と reconcile だけで、
//   起票・reopen・コメント・body 更新・ラベル付与は全て通常の Issues API です（§6-2）。
//
// ■ 書き込みの原則
//   - 起票は**単一 POST で原子的に完了**させる（title / body / labels / fp マーカーを1回で入れる）。
//     sub-issue 紐付けは後続の best-effort（§6-2 / #1198 §7-3）。
//   - **POST / PATCH / DELETE は自動リトライしない**（#1198 §7-4）。結果不明になったら
//     バックオフして索引を読み直し、「読めた事実」で判断します。推測でリトライしません。
//   - ラベル追加は `POST /issues/{n}/labels`（追加専用）。`PATCH` に `labels` を含めません
//     （含めると人間が付けたラベルを全置換で消します。#1198 §7-11）。
//   - 既存 open Issue へ**コメントしません**。body の自動領域だけを更新します
//     （本文編集では通知が飛びません）。通知が飛ぶ操作は「新規起票」と「回帰 reopen + コメント」の2つだけ。
//
// ■ S11: **上限接近時に古い sub-issue を親から自動 DELETE しません。**
//   紐付けが best-effort な状態で付け外しを自動化すると reconcile と競合して振動します。
//   このモジュールに DELETE は1本もありません。警告だけ出して、外すかどうかは人間が決めます。

"use strict";

const {
	BODY_UPDATE_LIMIT,
	COMMIT_LOOKUP_LIMIT,
	CREATE_RECHECK_DELAY_MS,
	GET_RETRY_LIMIT,
	MAX_INDEX_PAGES,
	PARENT_ISSUE_NUMBER,
	SUB_ISSUE_LINK_LIMIT,
	TRIAGE_LABEL,
} = require("./constants");
const {
	PARENT_SUMMARY_MARKER,
	rekeyIssueBody,
	renderIssueBody,
	renderParentSummaryComment,
	renderRegressionComment,
	renderRegressionMarker,
	renderTitle,
	shouldUpdateBody,
} = require("./render");
const { authoritative, buildIndex, hasSkipLabel, isRegression, resolveEntry } = require("./triage");

const GITHUB_API_ROOT = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

/** 1ページの件数。GitHub の上限。 */
const PER_PAGE = 100;
/**
 * 回帰コメントの重複検査で読むコメントのページ数上限。
 *
 * 検査は `since=closedAt`（＝マーカーが付き得る範囲）で絞ってから読むので、
 * ここに当たるのは「close 後に 300 件以上コメントが付いた Issue」だけ（L-1）。
 */
const MAX_COMMENT_PAGES = 3;
/** 親の常駐サマリコメントを探すときのページ数上限。 */
const MAX_PARENT_COMMENT_PAGES = 20;
/** GET のリトライ対象ステータス。 */
const RETRYABLE_STATUSES = Object.freeze([429, 500, 502, 503, 504]);

/** GitHub API がエラーを返したことを表す。`status` で分岐できるようにする。 */
class GitHubApiError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {string} path
	 */
	constructor(message, status, path) {
		super(message);
		this.name = "GitHubApiError";
		this.status = status;
		this.path = path;
	}
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `owner/repo` を分解する（`GITHUB_REPOSITORY` の形）。
 *
 * @param {string} fullName
 * @returns {{owner:string, repo:string}}
 */
const parseRepository = (fullName) => {
	const [owner, repo, ...rest] = String(fullName || "").split("/");
	if (!owner || !repo || rest.length > 0) {
		throw new Error(`GITHUB_REPOSITORY が owner/repo の形ではありません: ${JSON.stringify(fullName)}`);
	}
	return { owner, repo };
};

/**
 * sub-issues API へ渡す値が **issue の `id`（number ではない）** であることを検査する。
 *
 * #1198 §9 の注記どおり、ここは取り違えが起きやすい箇所です。`number` は4桁程度、
 * `id` は7〜10桁なので、値域で機械的に弾けます。取り違えたまま POST すると、
 * 存在しない Issue を親へぶら下げようとして毎回 404 になります。
 *
 * @param {unknown} value
 * @returns {number}
 */
const assertSubIssueId = (value) => {
	if (!Number.isInteger(value) || value < 1000000) {
		throw new TypeError(
			`sub_issue_id には issue の id（7〜10桁）を渡してください。number を渡していませんか: ${JSON.stringify(value)}`,
		);
	}
	return value;
};

/**
 * GitHub のエラーレスポンスから人間が読める1行を作る。**トークンは絶対に載せない。**
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {string}
 */
const describeApiError = (status, body) => {
	const message = body && typeof body === "object" && body.message ? body.message : "(メッセージなし)";
	const details =
		body && typeof body === "object" && Array.isArray(body.errors) && body.errors.length > 0
			? `: ${body.errors.map((error) => error.message || error.code || JSON.stringify(error)).join(", ")}`
			: "";
	return `GitHub API が HTTP ${status} を返しました: ${message}${details}`;
};

/** 書き込みを打ち切るべきレート制限か（#1198 §7-15: バックオフで押し切らない）。 */
const isRateLimited = (error) =>
	error instanceof GitHubApiError &&
	(error.status === 429 || (error.status === 403 && /rate limit/i.test(error.message)));

/**
 * GitHub API クライアント。
 *
 * @param {{token:string, owner:string, repo:string, apiRoot?:string, fetchImpl?:Function, sleepImpl?:Function, retryLimit?:number}} params
 */
const createGitHubClient = ({
	token,
	owner,
	repo,
	apiRoot = GITHUB_API_ROOT,
	fetchImpl,
	sleepImpl = defaultSleep,
	retryLimit = GET_RETRY_LIMIT,
}) => {
	const doFetch = fetchImpl || globalThis.fetch;
	if (typeof doFetch !== "function") throw new Error("fetch が使えません（Node 18 以上が必要です）");
	if (!token) throw new Error("GITHUB_TOKEN がありません（triage Job の permissions に issues: write が必要です）");

	const base = `${apiRoot.replace(/\/$/, "")}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

	/**
	 * 1回叩く。**リトライするのは GET だけ**（#1198 §7-4）。
	 *
	 * @param {{method?:string, path:string, body?:unknown, absolute?:boolean}} params
	 * @returns {Promise<{status:number, body:any}>}
	 */
	const request = async ({ method = "GET", path, body = null, absolute = false }) => {
		const url = absolute ? path : `${base}${path}`;
		const attempts = method === "GET" ? retryLimit : 1;
		let lastError = null;

		for (let attempt = 0; attempt < attempts; attempt += 1) {
			if (attempt > 0) await sleepImpl(1000 * 2 ** (attempt - 1));
			let response;
			try {
				response = await doFetch(url, {
					method,
					headers: {
						authorization: `Bearer ${token}`,
						accept: "application/vnd.github+json",
						"x-github-api-version": GITHUB_API_VERSION,
						"content-type": "application/json",
						"user-agent": "nanitabeyo-error-triage",
					},
					body: body === null ? undefined : JSON.stringify(body),
				});
			} catch (error) {
				// ネットワーク断。GET なら再試行、書き込みなら即座に呼び出し側へ返す（結果不明のため）。
				lastError = new GitHubApiError(`GitHub API への接続に失敗しました: ${error.message}`, 0, path);
				if (method !== "GET") throw lastError;
				continue;
			}

			const text = await response.text();
			let parsed = null;
			if (text) {
				try {
					parsed = JSON.parse(text);
				} catch {
					parsed = null;
				}
			}
			if (response.ok) return { status: response.status, body: parsed };

			lastError = new GitHubApiError(describeApiError(response.status, parsed), response.status, path);
			if (method === "GET" && RETRYABLE_STATUSES.includes(response.status)) continue;
			throw lastError;
		}
		throw lastError;
	};

	return Object.freeze({
		owner,
		repo,
		request,

		/**
		 * ラベルで Issue を全件取る（PR は除かない。捨てるのは `buildIndex`）。
		 *
		 * ページング途中で失敗したら例外を投げて**1件も書かせない**。部分索引のまま起票すると、
		 * 既存 Issue がある fingerprint を新規起票します（#1198 §1-B）。
		 *
		 * @param {string} label
		 * @returns {Promise<Array<Record<string, any>>>}
		 */
		async listIssuesByLabel(label = TRIAGE_LABEL) {
			const collected = [];
			for (let page = 1; page <= MAX_INDEX_PAGES; page += 1) {
				const params = new URLSearchParams({
					labels: label,
					state: "all",
					per_page: String(PER_PAGE),
					page: String(page),
					sort: "created",
					direction: "asc",
				});
				const { body } = await request({ path: `/issues?${params.toString()}` });
				const items = Array.isArray(body) ? body : [];
				collected.push(...items);
				if (items.length < PER_PAGE) return collected;
			}
			throw new Error(
				`索引が ${MAX_INDEX_PAGES} ページを超えました。全件を読めていないため書き込みを中止します（#1198 §1-B）`,
			);
		},

		/**
		 * 親の sub-issue 一覧（第2の索引源）。**呼び出し側で best-effort に包むこと。**
		 *
		 * @param {number} parentNumber
		 * @returns {Promise<Array<Record<string, any>>>}
		 */
		async listSubIssues(parentNumber = PARENT_ISSUE_NUMBER) {
			const collected = [];
			for (let page = 1; page <= MAX_INDEX_PAGES; page += 1) {
				const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
				const { body } = await request({ path: `/issues/${parentNumber}/sub_issues?${params.toString()}` });
				const items = Array.isArray(body) ? body : [];
				collected.push(...items);
				if (items.length < PER_PAGE) return collected;
			}
			return collected;
		},

		/**
		 * 起票。**単一 POST で原子的に完了**させる（fp マーカーは body、ラベルは同じ POST に載せる）。
		 *
		 * `err/skip` / `error-triage` はオーナーが作成済みなので、ここで新しいラベルは作られません。
		 *
		 * @param {{title:string, body:string, labels?:string[]}} params
		 * @returns {Promise<Record<string, any>>}
		 */
		async createIssue({ title, body, labels = [TRIAGE_LABEL] }) {
			const response = await request({ method: "POST", path: "/issues", body: { title, body, labels } });
			return response.body;
		},

		/**
		 * sub-issue として親へぶら下げる。**best-effort**（失敗しても run を落とさない）。
		 *
		 * @param {{parentNumber?:number, subIssueId:number}} params
		 */
		async addSubIssue({ parentNumber = PARENT_ISSUE_NUMBER, subIssueId }) {
			const response = await request({
				method: "POST",
				path: `/issues/${parentNumber}/sub_issues`,
				body: { sub_issue_id: assertSubIssueId(subIssueId) },
			});
			return response.body;
		},

		/**
		 * body だけを PATCH する。**`labels` を絶対に含めない**（全置換で人間のラベルが消える）。
		 *
		 * @param {{issueNumber:number, body:string}} params
		 */
		async updateIssueBody({ issueNumber, body }) {
			const response = await request({ method: "PATCH", path: `/issues/${issueNumber}`, body: { body } });
			return response.body;
		},

		/**
		 * reopen する。回帰コメントの**後**に呼ぶこと（#1198 §5-D）。
		 *
		 * @param {{issueNumber:number}} params
		 */
		async reopenIssue({ issueNumber }) {
			const response = await request({
				method: "PATCH",
				path: `/issues/${issueNumber}`,
				body: { state: "open", state_reason: "reopened" },
			});
			return response.body;
		},

		/**
		 * Issue のコメントを**古い順**（API の既定。`sort` / `direction` は受け付けない）に
		 * 最大 maxPages ページ取る。
		 *
		 * ★ L-1（PR #1211 レビュー）: ページ数で頭打ちにすると、取れるのは**最も古い** maxPages×100 件になる。
		 *   探しているマーカー（回帰コメント）は常に**最新側**にあるので、コメントが多い Issue では
		 *   マーカーを取り逃がして重複コメント（＝重複通知）になる。
		 *   回帰コメントのマーカーは必ず `closedAt` より後に付くので、呼び出し側は `since` を渡すこと。
		 *   `since` を渡せば残るのは close 以降のコメントだけになり、ページ上限に当たらない。
		 *
		 * @param {{issueNumber:number, maxPages?:number, since?:string|null}} params
		 * @returns {Promise<Array<Record<string, any>>>}
		 */
		async listIssueComments({ issueNumber, maxPages = MAX_COMMENT_PAGES, since = null }) {
			const collected = [];
			for (let page = 1; page <= maxPages; page += 1) {
				const params = new URLSearchParams({ per_page: String(PER_PAGE), page: String(page) });
				if (since) params.set("since", since);
				const { body } = await request({ path: `/issues/${issueNumber}/comments?${params.toString()}` });
				const items = Array.isArray(body) ? body : [];
				collected.push(...items);
				if (items.length < PER_PAGE) break;
			}
			return collected;
		},

		/** @param {{issueNumber:number, body:string}} params */
		async createComment({ issueNumber, body }) {
			const response = await request({ method: "POST", path: `/issues/${issueNumber}/comments`, body: { body } });
			return response.body;
		},

		/** @param {{commentId:number, body:string}} params */
		async updateComment({ commentId, body }) {
			const response = await request({ method: "PATCH", path: `/issues/comments/${commentId}`, body: { body } });
			return response.body;
		},

		/**
		 * commit の日時。再発判定 (3)「旧ビルド滞留の抑止」にだけ使う。
		 * force-push 済み等で 404 なら **null（不明）**。不明しかない場合は (3) 自体がスキップされる。
		 *
		 * @param {string} sha
		 * @returns {Promise<string|null>}
		 */
		async getCommitDate(sha) {
			try {
				const { body } = await request({ path: `/commits/${encodeURIComponent(sha)}` });
				return (body && body.commit && body.commit.committer && body.commit.committer.date) || null;
			} catch (error) {
				if (error instanceof GitHubApiError && (error.status === 404 || error.status === 422)) return null;
				throw error;
			}
		},
	});
};

// ---------------------------------------------------------------------------
// 索引の収集（ラベル ∪ 親の sub-issues）
// ---------------------------------------------------------------------------

/**
 * 索引の材料を集める。
 *
 * ラベル索引が取れなければ**例外**（部分索引で起票すると重複する）。
 * sub-issue 索引が取れなければ**警告だけ**で続行する（横断レビュー §6-2）。
 *
 * @param {{client:Record<string, any>, parentIssue?:number, label?:string}} params
 * @returns {Promise<{issues:Array<Record<string, any>>, subIssues:{ok:boolean, ids:Set<number>, numbers:Set<number>, count:number, error:string|null}, warnings:string[]}>}
 */
const collectIndexSources = async ({ client, parentIssue = PARENT_ISSUE_NUMBER, label = TRIAGE_LABEL }) => {
	const warnings = [];
	const byNumber = new Map();
	for (const issue of await client.listIssuesByLabel(label)) byNumber.set(issue.number, issue);

	const subIssues = { ok: true, ids: new Set(), numbers: new Set(), count: 0, error: null };
	try {
		const items = await client.listSubIssues(parentIssue);
		subIssues.count = items.length;
		for (const issue of items) {
			subIssues.ids.add(issue.id);
			subIssues.numbers.add(issue.number);
			// ラベルを人間が外していても、ここで索引へ戻る（§4 が `err/auto` の代わりに置いた保険）。
			if (!byNumber.has(issue.number)) byNumber.set(issue.number, issue);
		}
	} catch (error) {
		subIssues.ok = false;
		subIssues.error = error.message;
		warnings.push(
			`親 #${parentIssue} の sub-issue 一覧を取得できませんでした（${error.message}）。第2の索引源と紐付けの reconcile をスキップします。起票・reopen・body 更新は続行します`,
		);
	}

	return { issues: [...byNumber.values()], subIssues, warnings };
};

/**
 * 再発判定 (3) に要る commit 日時をまとめて解決する（run 内キャッシュ・件数上限つき）。
 *
 * 解決するのは**reopen 候補の commit だけ**。commitDates は「旧ビルド由来なら抑止する」方向にしか
 * 効かないので、それ以外のグループに対して API を叩く意味がありません。
 *
 * @param {{client:Record<string, any>, shas:ReadonlyArray<string>, limit?:number}} params
 * @returns {Promise<{commitDates:Record<string, string>, lookups:number, warnings:string[]}>}
 */
const resolveCommitDates = async ({ client, shas, limit = COMMIT_LOOKUP_LIMIT }) => {
	const commitDates = {};
	const warnings = [];
	let lookups = 0;
	for (const sha of [...new Set(shas)]) {
		if (lookups >= limit) {
			warnings.push(`commit 日時の解決が上限 ${limit} 件に達しました。残りは「不明」として扱います`);
			break;
		}
		lookups += 1;
		try {
			const date = await client.getCommitDate(sha);
			if (date) commitDates[sha] = date;
		} catch (error) {
			warnings.push(`commit ${sha} の日時を解決できませんでした（${error.message}）。「不明」として扱います`);
		}
	}
	return { commitDates, lookups, warnings };
};

// ---------------------------------------------------------------------------
// 適用（Phase 4 / 5）
// ---------------------------------------------------------------------------

/**
 * 親 Issue の常駐サマリコメントを upsert する（#1198 §4-B）。
 *
 * **毎回新しいコメントを作らない。** 日次で1年回せば365件が積もって親 Issue が読めなくなるうえ、
 * 新規コメントは通知が飛びます。既存コメントの PATCH なら通知は飛びません。
 *
 * @param {{client:Record<string, any>, parentIssue?:number, body:string}} params
 * @returns {Promise<"created"|"updated">}
 */
const upsertParentSummaryComment = async ({ client, parentIssue = PARENT_ISSUE_NUMBER, body }) => {
	const comments = await client.listIssueComments({ issueNumber: parentIssue, maxPages: MAX_PARENT_COMMENT_PAGES });
	const existing = comments.find((comment) => String(comment.body || "").includes(PARENT_SUMMARY_MARKER));
	if (existing) {
		await client.updateComment({ commentId: existing.id, body });
		return "updated";
	}
	await client.createComment({ issueNumber: parentIssue, body });
	return "created";
};

/**
 * 起票計画を適用する。**書き込みが起きるのはこの関数の中だけ。**
 *
 * 順序は #1198 §1-F のとおり: 回帰 → 起票 → body 更新 → sub-issue reconcile → 親の常駐サマリ。
 * 回帰を先にするのは「一度直したものが壊れた」の方が緊急度が高く、レート制限で溢れたときに
 * 落としたくないためです。
 *
 * @param {{
 *   client: Record<string, any>,
 *   envelope: Record<string, any>,
 *   plan: Record<string, any>,
 *   issues: ReadonlyArray<Record<string, any>>,
 *   subIssues: {ok:boolean, ids:Set<number>, count:number, error?:string|null},
 *   commitDates?: Record<string, string>,
 *   parentIssue?: number,
 *   runUrl?: string|null,
 *   dryRun?: boolean,
 *   parentSummaryDryRun?: boolean,
 *   sleepImpl?: Function,
 *   commitLookups?: number,
 * }} params
 * @returns {Promise<Record<string, any>>}
 */
const applyPlan = async ({
	client,
	envelope,
	plan,
	issues,
	subIssues,
	commitDates = {},
	parentIssue = PARENT_ISSUE_NUMBER,
	runUrl = null,
	dryRun = false,
	// L-3（PR #1211 レビュー）: PANIC / 契約違反は「起票・reopen・body 更新はしないが、
	// 何が起きたかは親の常駐サマリへ残す」（#1198 G5）。そのため Phase 5 だけは dryRun と別軸で制御する。
	// 既定は dryRun に追随するので、呼び出し側が何も渡さなければ従来どおり（--dry-run は1バイトも書かない）。
	// なお `plan.abort`（fpalgo 不一致）はこの関数の入口で return するので、Phase 5 にも到達しない。
	parentSummaryDryRun = dryRun,
	sleepImpl = defaultSleep,
	commitLookups = 0,
}) => {
	const result = {
		dryRun,
		parentIssue,
		created: [],
		reopened: [],
		rekeyed: [],
		rekeySkipped: [],
		bodyUpdated: [],
		bodySkipped: [],
		subIssueLinked: [],
		subIssueFailures: [],
		subIssueIndexOk: subIssues.ok,
		subIssueIndexError: subIssues.error ?? null,
		subIssueCount: subIssues.count,
		failures: [],
		warnings: [],
		commitLookups,
		parentSummary: null,
		rateLimited: false,
	};

	// 書き込む前の最後の関門。fpalgo 不一致は「1件も書かない」（#1198 §8-A）。
	if (plan.abort) {
		result.aborted = true;
		result.abortReason = plan.abortReason;
		return result;
	}

	const { index } = buildIndex(issues);
	const groupsByFingerprint = new Map((envelope.groups || []).map((group) => [group.fingerprint, group]));
	const { window, generatedAt } = envelope;
	// 現行 fingerprint で引けなければ旧世代 fingerprint の復元で引く（移行中はこちらで当たる）。
	// buildPlan と同じ resolveEntry を使うので、計画と適用で違う Issue を触ることがない。
	const entryOf = (fingerprint) => {
		const direct = authoritative(index.get(fingerprint));
		if (direct) return direct;
		const group = groupsByFingerprint.get(fingerprint);
		return group ? resolveEntry({ index, group }).entry : null;
	};

	/** sub-issue の紐付け。best-effort（失敗しても例外を投げない）。 */
	const linkSubIssue = async ({ issueNumber, issueId }) => {
		if (!subIssues.ok) return false;
		if (issueId === undefined || issueId === null) {
			result.subIssueFailures.push({ issueNumber, message: "issue の id が取れませんでした" });
			return false;
		}
		if (subIssues.ids.has(issueId)) return false;
		if (dryRun) {
			result.subIssueLinked.push({ issueNumber, issueId, dryRun: true });
			subIssues.ids.add(issueId);
			return true;
		}
		try {
			await client.addSubIssue({ parentNumber: parentIssue, subIssueId: issueId });
			subIssues.ids.add(issueId);
			subIssues.count += 1;
			result.subIssueLinked.push({ issueNumber, issueId });
			return true;
		} catch (error) {
			// ★ 紐付けの失敗で run を落とさない（横断レビュー §6-2）。壊れるのはナビゲーションだけで、
			//   Issue 自体は body に `親: #1196` を持ち、ラベル索引にも載っている。
			result.subIssueFailures.push({ issueNumber, message: error.message });
			return false;
		}
	};

	// ---- 0) fingerprint のリキー（旧世代マーカーの書き換え / #1196 CLUSTERING.md 末尾の課題） ----
	//
	// ★ これは**後片付け**であって、突合そのものではない。
	//   「重複起票しない」は triage.js の resolveEntry（旧 fingerprint の復元）だけで既に成立している。
	//   ここが1件も成功しなくても、失敗しても、上限で溢れても、重複起票は起きない。
	//   だからこそ**起票より先**に置ける（body の PATCH なので通知は飛ばない）。
	//
	// 冪等性: `rekeyIssueBody()` が「既にリキー済み」「対象 fp マーカーが無い」で null を返すので、
	//   同じ run を何度流しても2回目以降は API を1回も叩かない。
	for (const rekey of plan.rekeys || []) {
		const entry = [...index.values()].flat().find((candidate) => candidate.number === rekey.issueNumber);
		if (!entry) {
			result.rekeySkipped.push({ issueNumber: rekey.issueNumber, reason: "索引に見つかりません" });
			continue;
		}
		const body = rekeyIssueBody({
			body: entry.body,
			from: rekey.from,
			to: rekey.to,
			locale: rekey.locale,
			fromAlgoVersion: rekey.fromAlgoVersion,
			// Minor-3: 本文に「どれが代表なのか」を書くために必要（計画側で決定済み）。
			issueNumber: rekey.issueNumber,
			authoritativeNumber: rekey.authoritativeNumber ?? null,
		});
		if (body === null) {
			result.rekeySkipped.push({ issueNumber: rekey.issueNumber, reason: "既にリキー済み（冪等）" });
			continue;
		}
		try {
			if (!dryRun) await client.updateIssueBody({ issueNumber: rekey.issueNumber, body });
			// 後続フェーズ（body 更新など）が同じ run 内で読む索引にも反映しておく。
			entry.body = body;
			result.rekeyed.push({ issueNumber: rekey.issueNumber, from: rekey.from, to: rekey.to, locale: rekey.locale });
			if (rekey.skipLabel) {
				result.warnings.push(
					`#${rekey.issueNumber} は \`err/skip\` 付きのまま fp:${rekey.to} へ統合しました。統合先のクラスタ全体が恒久無視になります`,
				);
			}
		} catch (error) {
			result.failures.push({ stage: "rekey", target: `#${rekey.issueNumber}`, message: error.message });
			if (isRateLimited(error)) {
				result.rateLimited = true;
				break;
			}
		}
	}

	// ---- 1) 回帰（reopen）: コメント → reopen の順（#1198 §5-D） ----
	for (const item of plan.items.filter((entry) => entry.action === "reopen")) {
		const group = groupsByFingerprint.get(item.fingerprint);
		const entry = entryOf(item.fingerprint);
		if (!group || !entry) {
			result.failures.push({
				stage: "reopen",
				target: `fp:${item.fingerprint}`,
				message: "計画にある fingerprint が envelope / 索引に見つかりません",
			});
			continue;
		}
		const detail = isRegression({
			group,
			entry,
			graceHours: plan.limits.graceHours,
			minEventsReopen: plan.limits.minEventsReopen,
			commitDates,
		});
		const marker = renderRegressionMarker(group.fingerprint, group.lastSeenUtc);
		try {
			let commented = false;
			// 同一マーカーのコメントが既にあればコメントは打たない（同日中の再実行を冪等にする）。
			// `since=closedAt` で絞る（L-1）。マーカーは必ず close より後に付くので取りこぼさず、
			// コメントが数百件ある長寿命 Issue でもページ上限に食われない。
			const comments = dryRun
				? []
				: await client.listIssueComments({ issueNumber: entry.number, since: entry.closedAt });
			if (!comments.some((comment) => String(comment.body || "").includes(marker))) {
				const body = renderRegressionComment({
					group,
					closedAt: entry.closedAt,
					eventsAfterGrace: detail.eventsAfterGrace,
					graceHours: plan.limits.graceHours,
					latestCommit: group.representativeCommit,
				});
				if (!dryRun) await client.createComment({ issueNumber: entry.number, body });
				commented = true;
			}
			// コメントが先・reopen が後。逆にすると、コメント投入前に落ちた場合に次回 run で
			// `state == open`（KNOWN_OPEN）になり、なぜ開いたのかの説明が永久に付かない。
			if (!dryRun) await client.reopenIssue({ issueNumber: entry.number });
			result.reopened.push({ fingerprint: group.fingerprint, issueNumber: entry.number, commented });
		} catch (error) {
			result.failures.push({ stage: "reopen", target: `#${entry.number}`, message: error.message });
			if (isRateLimited(error)) {
				result.rateLimited = true;
				break;
			}
		}
	}

	// ---- 2) 起票 ----
	const creations = plan.items.filter((item) => item.action === "create");
	if (creations.length > 0 && !result.rateLimited) {
		// ★ 冪等性の要（要件7）: **起票の直前に索引を取り直す**。
		//   計画を作ってから今までの間に、別 run（cron × workflow_dispatch の競合）や
		//   前回 run の途中クラッシュ後の再実行で、同じ fingerprint が既に起票されている可能性がある。
		//   `list_issues` は検索インデックス非依存なので、直前に読めば「作成済み」が確実に見える。
		let known;
		try {
			const fresh = await client.listIssuesByLabel(TRIAGE_LABEL);
			known = new Set([...buildIndex(fresh).index.keys()]);
		} catch (error) {
			// 索引を取り直せないなら**1件も起票しない**（fail-closed）。取りこぼしは翌日回復できるが、
			// 重複起票は人手でしか回復できない。
			result.failures.push({ stage: "create-recheck", target: "index", message: error.message });
			known = null;
		}

		if (known) {
			for (const item of creations) {
				const group = groupsByFingerprint.get(item.fingerprint);
				if (!group) {
					result.failures.push({
						stage: "create",
						target: `fp:${item.fingerprint}`,
						message: "計画にある fingerprint が envelope に見つかりません",
					});
					continue;
				}
				if (known.has(group.fingerprint)) {
					result.warnings.push(
						`fp:${group.fingerprint} は計画作成後に起票済みでした（索引の再取得で判明）。起票をスキップします`,
					);
					continue;
				}
				const title = renderTitle(group);
				const body = renderIssueBody({ group, window, generatedAt, existingBody: null, parentIssue, runUrl });
				try {
					if (dryRun) {
						result.created.push({ fingerprint: group.fingerprint, issueNumber: null, issueId: null, title });
						known.add(group.fingerprint);
						continue;
					}
					const created = await client.createIssue({ title, body, labels: [TRIAGE_LABEL] });
					known.add(group.fingerprint);
					result.created.push({
						fingerprint: group.fingerprint,
						issueNumber: created.number,
						issueId: created.id,
						title,
					});
					await linkSubIssue({ issueNumber: created.number, issueId: created.id });
				} catch (error) {
					// POST は自動リトライしない（#1198 §7-4）。結果不明なので、バックオフして
					// 索引を読み直し、「読めた事実」で成功／失敗を決める。推測でリトライしない。
					let recovered = null;
					try {
						await sleepImpl(CREATE_RECHECK_DELAY_MS);
						const recheck = await client.listIssuesByLabel(TRIAGE_LABEL);
						const rebuilt = buildIndex(recheck).index;
						known = new Set([...rebuilt.keys()]);
						recovered = authoritative(rebuilt.get(group.fingerprint));
					} catch {
						recovered = null;
					}
					if (recovered) {
						result.warnings.push(
							`fp:${group.fingerprint} の起票はエラーを返しましたが、索引の再取得で #${recovered.number} として存在を確認しました（成功扱い）`,
						);
						result.created.push({
							fingerprint: group.fingerprint,
							issueNumber: recovered.number,
							issueId: recovered.id,
							title,
						});
						await linkSubIssue({ issueNumber: recovered.number, issueId: recovered.id });
						continue;
					}
					result.failures.push({ stage: "create", target: `fp:${group.fingerprint}`, message: error.message });
					if (isRateLimited(error)) result.rateLimited = true;
					// 起票は**1件失敗したらその run では打ち切る**。原因はたいてい systemic（権限・レート制限）で、
					// 残りを叩き続けると二次レート制限を引き当てて状況を悪くする。残りは翌日の枠へ回る。
					break;
				}
			}
		}
	}

	// ---- 3) body の自動領域を更新（コメントはしない = 通知を出さない） ----
	let bodyUpdates = 0;
	for (const item of plan.items) {
		if (item.action !== "noop-open" && item.action !== "noop-wontfix") continue;
		// `err/skip` は API コールを1回も発行しない（#1198 §6-D）。noop-skip はそもそもここへ来ない。
		if (bodyUpdates >= BODY_UPDATE_LIMIT || result.rateLimited) break;
		const group = groupsByFingerprint.get(item.fingerprint);
		const entry = entryOf(item.fingerprint);
		if (!group || !entry) continue;

		const decision = shouldUpdateBody({ existingBody: entry.body, group, generatedAt });
		if (!decision.update) {
			result.bodySkipped.push({ fingerprint: group.fingerprint, issueNumber: entry.number, reason: decision.reason });
			continue;
		}
		const body = renderIssueBody({ group, window, generatedAt, existingBody: entry.body, parentIssue, runUrl });
		if (body === entry.body) {
			result.bodySkipped.push({ fingerprint: group.fingerprint, issueNumber: entry.number, reason: "差分なし" });
			continue;
		}
		bodyUpdates += 1;
		try {
			if (!dryRun) await client.updateIssueBody({ issueNumber: entry.number, body });
			result.bodyUpdated.push({ fingerprint: group.fingerprint, issueNumber: entry.number, reason: decision.reason });
		} catch (error) {
			result.failures.push({ stage: "body", target: `#${entry.number}`, message: error.message });
			if (isRateLimited(error)) {
				result.rateLimited = true;
				break;
			}
		}
	}

	// ---- 4) sub-issue 紐付けの reconcile（best-effort。DELETE は一切しない = S11） ----
	if (subIssues.ok && !result.rateLimited) {
		// 1 body に複数 fp があると同じ entry が複数キーに載るので、issue number で一意化してから回す。
		const byNumber = new Map();
		for (const entries of index.values()) {
			for (const entry of entries) if (!byNumber.has(entry.number)) byNumber.set(entry.number, entry);
		}
		const unlinked = [...byNumber.values()]
			.filter((entry) => !subIssues.ids.has(entry.id))
			// ★ M-2（PR #1211 レビュー）: `err/skip` は API コールを1回も発行しない（#1198 §6-D）。
			//   reconcile も例外ではない。恒久無視と決めた Issue を親へぶら下げると、
			//   sub-issue の 100 件ソフト上限（SUB_ISSUE_SOFT_LIMIT）の枠を食う。
			//   S11 で自動 DELETE を禁じているため、食った枠は**人手でしか回収できない**。
			.filter((entry) => !hasSkipLabel(entry))
			.sort((a, b) => a.number - b.number);
		if (unlinked.length > SUB_ISSUE_LINK_LIMIT) {
			result.warnings.push(
				`未紐付けの Issue が ${unlinked.length} 件あります。この run では ${SUB_ISSUE_LINK_LIMIT} 件だけ紐付けます（残りは次回 run）`,
			);
		}
		for (const entry of unlinked.slice(0, SUB_ISSUE_LINK_LIMIT)) {
			await linkSubIssue({ issueNumber: entry.number, issueId: entry.id });
		}
	}

	// ---- 5) 親の常駐サマリコメント（新規作成ではなく更新。通知を出さない） ----
	try {
		const body = renderParentSummaryComment({ envelope, plan, applyResult: result });
		result.parentSummary = parentSummaryDryRun
			? "dry-run（書き込みなし）"
			: await upsertParentSummaryComment({ client, parentIssue, body });
	} catch (error) {
		result.parentSummary = "失敗";
		result.failures.push({ stage: "parent-summary", target: `#${parentIssue}`, message: error.message });
	}

	return result;
};

module.exports = Object.freeze({
	GITHUB_API_ROOT,
	GITHUB_API_VERSION,
	PER_PAGE,
	RETRYABLE_STATUSES,
	GitHubApiError,
	parseRepository,
	assertSubIssueId,
	describeApiError,
	isRateLimited,
	createGitHubClient,
	collectIndexSources,
	resolveCommitDates,
	upsertParentSummaryComment,
	applyPlan,
});
