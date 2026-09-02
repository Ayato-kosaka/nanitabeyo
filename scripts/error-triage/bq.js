// #1196 error-triage / BigQuery からの読み取り（唯一の外部 I/O のひとつ）と、契約エンベロープの組み立て。
//
// ■ アクセス方式: `bq` CLI ではなく **BigQuery REST `jobs.query` を Node 組み込み `fetch` で直叩き**する。
//
//   横断レビュー §6-1 / B4 の結論。理由:
//     - `bq` CLI × WIF の前例が**このリポジトリに1本も無い**（Workflow 全数確認済み）。初回で詰まる。
//     - `google-github-actions/auth@v2` に `token_format: access_token` を指定すればアクセストークンが
//       直接取れるので、`setup-gcloud` も `bq` も要らなくなる。
//     - リクエストボディに `maximumBytesBilled` と `dryRun` を入れられるため、
//       **コスト上限も dry-run 見積りも CLI と等価**に保てる。
//     - 依存パッケージが1つも増えない（`@google-cloud/bigquery` を入れない）。
//
// ■ コストガードは2層（#1199 §5 / 横断レビュー）:
//   (Ⅰ) `maximumBytesBilled` を**常に**リクエストへ載せる。`buildQueryRequest()` は
//        引数で渡された値を**無視して**定数を使う。上限が可変なら上限ではない。
//   (Ⅱ) 本クエリの前に `dryRun: true` で見積もり、200MB を超えていたら**本クエリを投げずに落とす**。
//        (Ⅰ) だけだと「上限に当たって課金前に落ちる」までしか分からないが、(Ⅱ) なら
//        毎日の実スキャン量が Job Summary に残り、じわじわ増えていることに気づける。
//
// ■ このモジュールは Date.now() / new Date() を呼ばない。窓と generatedAt は必ず引数で受け取る（S12）。
// ■ `fetch` は差し替え可能にしてある（テストは本物の BigQuery を叩かない）。

"use strict";

const { MAX_BYTES_BILLED } = require("./constants");
const { buildEnvelope } = require("./triage");
const { RFC3339_UTC_PATTERN } = require("./window");
const { BQ_LOCATION, WINDOW_END_PLACEHOLDER, WINDOW_START_PLACEHOLDER } = require("./sql-generator");

const BQ_API_ROOT = "https://bigquery.googleapis.com/bigquery/v2";

/** jobs.query の同期待ち時間（ms）。超えたら getQueryResults でポーリングへ移る。 */
const DEFAULT_QUERY_TIMEOUT_MS = 60000;
/** 1ページあたりの取得行数。グループ上限 500 + run_summary 1 行なので通常は1ページで終わる。 */
const DEFAULT_MAX_RESULTS = 2000;
/** getQueryResults のポーリング上限。無限ループにしない。 */
const MAX_RESULT_PAGES = 20;

// ---------------------------------------------------------------------------
// 純関数: SQL テンプレートの埋め込み
// ---------------------------------------------------------------------------

/**
 * RFC3339 UTC（秒精度）を GoogleSQL の TIMESTAMP リテラル本体へ変換する。
 *
 * `2026-08-05T23:00:00Z` → `2026-08-05 23:00:00+00`
 *
 * **書式を厳密に検査してから変換する。** ここが SQL へ文字列を差し込む唯一の場所なので、
 * 検査を緩めるとインジェクション面がそのまま開く（テンプレート変数を2つに限定した意味が消える）。
 *
 * @param {string} rfc3339Utc
 * @returns {string}
 */
const toSqlTimestampLiteral = (rfc3339Utc) => {
	const value = String(rfc3339Utc);
	if (!RFC3339_UTC_PATTERN.test(value)) {
		throw new TypeError(`窓の境界が RFC3339 UTC（秒精度）ではありません: ${JSON.stringify(rfc3339Utc)}`);
	}
	return `${value.slice(0, 10)} ${value.slice(11, 19)}+00`;
};

/**
 * SQL テンプレートへ窓のリテラルを埋め込む。
 *
 * `CURRENT_TIMESTAMP()` やクエリパラメータではなくリテラルにするのは、
 * パーティション枝刈りを確実に効かせるため（外れた瞬間 22.8GiB のフルスキャン）。
 *
 * @param {string} template
 * @param {{startUtc:string, endUtc:string}} window
 * @returns {string}
 */
const renderSql = (template, window) => {
	const source = String(template);
	if (!source.includes(WINDOW_START_PLACEHOLDER) || !source.includes(WINDOW_END_PLACEHOLDER)) {
		throw new Error(
			`SQL テンプレートに ${WINDOW_START_PLACEHOLDER} / ${WINDOW_END_PLACEHOLDER} がありません（窓が埋め込まれず全期間スキャンになります）`,
		);
	}
	const sql = source
		.split(WINDOW_START_PLACEHOLDER)
		.join(toSqlTimestampLiteral(window.startUtc))
		.split(WINDOW_END_PLACEHOLDER)
		.join(toSqlTimestampLiteral(window.endUtc));
	const leftover = /\{\{[A-Za-z0-9_]+\}\}/.exec(sql);
	if (leftover) throw new Error(`未置換のテンプレート変数が残っています: ${leftover[0]}`);
	return sql;
};

// ---------------------------------------------------------------------------
// 純関数: リクエストボディ
// ---------------------------------------------------------------------------

/**
 * `jobs.query` のリクエストボディを組み立てる。
 *
 * ★ `maximumBytesBilled` は**常に定数**。呼び出し側が別の値を渡してきても採用しない。
 *   Workflow の env / inputs から上書きできてしまうと「上限」が上限でなくなる（#1199 §5）。
 *   これはユニットテストで固定してある。
 *
 * @param {{sql:string, dryRun?:boolean, location?:string, timeoutMs?:number, maxResults?:number, maximumBytesBilled?:unknown}} params
 * @returns {Record<string, unknown>}
 */
const buildQueryRequest = ({
	sql,
	dryRun = false,
	location = BQ_LOCATION,
	timeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
	maxResults = DEFAULT_MAX_RESULTS,
}) => ({
	query: String(sql),
	useLegacySql: false,
	dryRun: Boolean(dryRun),
	// バイパス不能な定数。引数の maximumBytesBilled は受け取っても使わない。
	maximumBytesBilled: String(MAX_BYTES_BILLED),
	location,
	timeoutMs,
	maxResults,
});

// ---------------------------------------------------------------------------
// 純関数: レスポンスの読み取り
// ---------------------------------------------------------------------------

/**
 * `jobs.query` / `getQueryResults` の行配列を、SQL が出した JSON へ戻して仕分ける。
 *
 * SQL の出力は1列（`triageRow`）で、値は `kind: "group" | "run_summary"` を持つ JSON 文字列。
 * この「1行1JSON」は `bq.js` の内部表現であって契約ではない（横断レビュー §3）。
 * 契約は下の `buildEnvelope()` が返すエンベロープ1本。
 *
 * @param {ReadonlyArray<{f?:ReadonlyArray<{v?:unknown}>}>} rows
 * @returns {{groups:Array<Record<string, any>>, runSummary:Record<string, any>|null, warnings:string[]}}
 */
const parseTriageRows = (rows = []) => {
	const groups = [];
	const warnings = [];
	let runSummary = null;

	rows.forEach((row, index) => {
		const cell = row && Array.isArray(row.f) ? row.f[0] : null;
		const raw = cell ? cell.v : null;
		if (typeof raw !== "string") {
			warnings.push(`行 ${index} が文字列ではありません（SQL の出力列が1つであることを確認すること）`);
			return;
		}
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			warnings.push(`行 ${index} の JSON を解釈できませんでした: ${error.message}`);
			return;
		}
		if (parsed && parsed.kind === "run_summary") {
			if (runSummary) warnings.push("run_summary 行が複数あります。最初の1件だけを使います");
			else runSummary = parsed;
			return;
		}
		if (parsed && parsed.kind === "group") {
			groups.push(parsed);
			return;
		}
		warnings.push(`行 ${index} の kind が未知です: ${JSON.stringify(parsed && parsed.kind)}`);
	});

	return { groups, runSummary, warnings };
};

/**
 * BigQuery が返す INT64（JSON 上は文字列）を数値にする。バイト数・行数の両方に使う。
 *
 * @param {unknown} value
 * @returns {number}
 */
const toInt64Number = (value) => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * 見積りがスキャン上限を超えていないか検査する（コストガード第2層）。
 *
 * @param {number} estimatedBytes
 * @returns {{ok:boolean, estimatedBytes:number, maxBytesBilled:number, message:string|null}}
 */
const checkEstimatedBytes = (estimatedBytes) => {
	const bytes = toInt64Number(estimatedBytes);
	if (bytes > MAX_BYTES_BILLED) {
		return {
			ok: false,
			estimatedBytes: bytes,
			maxBytesBilled: MAX_BYTES_BILLED,
			message: `dry-run の見積り ${bytes} バイトが上限 ${MAX_BYTES_BILLED} バイトを超えています。本クエリは投げません（パーティション枝刈りが効いているか、窓が広すぎないかを確認すること）`,
		};
	}
	return { ok: true, estimatedBytes: bytes, maxBytesBilled: MAX_BYTES_BILLED, message: null };
};

// ---------------------------------------------------------------------------
// 外部 I/O: BigQuery REST
// ---------------------------------------------------------------------------

/**
 * BigQuery のエラーレスポンスから人間が読める1行を作る。
 *
 * **アクセストークンは絶対にここへ載せない**（ログ・Job Summary・Artifact に流れるため）。
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {string}
 */
const describeApiError = (status, body) => {
	const error = body && typeof body === "object" ? body.error : null;
	const reason = error && Array.isArray(error.errors) && error.errors[0] ? error.errors[0].reason : null;
	const message = error && error.message ? error.message : "(メッセージなし)";
	return `BigQuery API が HTTP ${status} を返しました${reason ? `（${reason}）` : ""}: ${message}`;
};

/**
 * BigQuery REST を1回叩く。
 *
 * @param {{url:string, method?:string, body?:unknown, accessToken:string, fetchImpl?:Function}} params
 * @returns {Promise<Record<string, any>>}
 */
const callBigQuery = async ({ url, method = "GET", body = null, accessToken, fetchImpl }) => {
	const doFetch = fetchImpl || globalThis.fetch;
	if (typeof doFetch !== "function") throw new Error("fetch が使えません（Node 18 以上が必要です）");
	if (!accessToken) throw new Error("アクセストークンがありません（google-github-actions/auth の token_format: access_token を確認すること）");

	const response = await doFetch(url, {
		method,
		headers: {
			authorization: `Bearer ${accessToken}`,
			"content-type": "application/json",
			accept: "application/json",
		},
		body: body === null ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let parsed = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = null;
		}
	}
	if (!response.ok) {
		throw new Error(describeApiError(response.status, parsed) || `BigQuery API が HTTP ${response.status} を返しました`);
	}
	return parsed || {};
};

const queriesUrl = (projectId) => `${BQ_API_ROOT}/projects/${encodeURIComponent(projectId)}/queries`;

/**
 * dry-run で処理バイト数だけを見積もる（**課金なし・スキャン 0 バイト**）。
 *
 * @param {{projectId:string, accessToken:string, sql:string, location?:string, fetchImpl?:Function}} params
 * @returns {Promise<{estimatedBytes:number, raw:Record<string, any>}>}
 */
const estimateQuery = async ({ projectId, accessToken, sql, location = BQ_LOCATION, fetchImpl }) => {
	const raw = await callBigQuery({
		url: queriesUrl(projectId),
		method: "POST",
		body: buildQueryRequest({ sql, dryRun: true, location }),
		accessToken,
		fetchImpl,
	});
	return { estimatedBytes: toInt64Number(raw.totalBytesProcessed), raw };
};

/**
 * 本クエリを実行し、全ページの行を集める。
 *
 * `jobs.query` は `jobComplete: false` を返すことがあるので、その場合は `getQueryResults` で待つ。
 * ページングも同じ経路で処理する（上限 MAX_RESULT_PAGES）。
 *
 * @param {{projectId:string, accessToken:string, sql:string, location?:string, fetchImpl?:Function}} params
 * @returns {Promise<{rows:Array<Record<string, any>>, totalRows:number, totalBytesProcessed:number, cacheHit:boolean}>}
 */
const runQuery = async ({ projectId, accessToken, sql, location = BQ_LOCATION, fetchImpl }) => {
	let response = await callBigQuery({
		url: queriesUrl(projectId),
		method: "POST",
		body: buildQueryRequest({ sql, dryRun: false, location }),
		accessToken,
		fetchImpl,
	});

	const jobReference = response.jobReference || {};
	const jobId = jobReference.jobId;
	const jobLocation = jobReference.location || location;
	const totalBytesProcessed = toInt64Number(response.totalBytesProcessed);
	const cacheHit = Boolean(response.cacheHit);

	const rows = [];
	let pages = 0;
	for (;;) {
		if (Array.isArray(response.rows)) rows.push(...response.rows);
		const needMore = response.jobComplete === false || Boolean(response.pageToken);
		if (!needMore) break;
		pages += 1;
		if (pages > MAX_RESULT_PAGES) {
			throw new Error(`クエリ結果のページ取得が ${MAX_RESULT_PAGES} 回を超えました（jobId=${jobId}）`);
		}
		if (!jobId) throw new Error("jobComplete が false ですが jobReference.jobId がありません");
		const params = new URLSearchParams({
			location: jobLocation,
			maxResults: String(DEFAULT_MAX_RESULTS),
			timeoutMs: String(DEFAULT_QUERY_TIMEOUT_MS),
		});
		if (response.pageToken) params.set("pageToken", String(response.pageToken));
		response = await callBigQuery({
			url: `${queriesUrl(projectId)}/${encodeURIComponent(jobId)}?${params.toString()}`,
			accessToken,
			fetchImpl,
		});
	}

	return {
		rows,
		totalRows: toInt64Number(response.totalRows),
		totalBytesProcessed,
		cacheHit,
	};
};

/**
 * 見積り → 上限チェック → 本クエリ → 契約エンベロープ、までを1本にしたもの。
 *
 * **これが `main.js` から呼ばれる唯一の入口。** Workflow の YAML から直接 BigQuery を叩かない。
 *
 * @param {{
 *   projectId: string,
 *   accessToken: string,
 *   sqlTemplate: string,
 *   window: {startUtc:string, endUtc:string, lookbackHours:number},
 *   generatedAt: string,
 *   location?: string,
 *   fetchImpl?: Function,
 * }} params
 * @returns {Promise<{envelope:Record<string, any>, warnings:string[], sql:string, estimatedBytes:number, totalRows:number, cacheHit:boolean}>}
 */
const fetchTriageEnvelope = async ({
	projectId,
	accessToken,
	sqlTemplate,
	window,
	generatedAt,
	location = BQ_LOCATION,
	fetchImpl,
}) => {
	const sql = renderSql(sqlTemplate, window);

	// --- コストガード第2層: 見積りが上限を超えたら本クエリを投げない ---
	const { estimatedBytes } = await estimateQuery({ projectId, accessToken, sql, location, fetchImpl });
	const budget = checkEstimatedBytes(estimatedBytes);
	if (!budget.ok) throw new Error(budget.message);

	const result = await runQuery({ projectId, accessToken, sql, location, fetchImpl });
	const { groups, runSummary, warnings } = parseTriageRows(result.rows);
	if (!runSummary) {
		warnings.push("run_summary 行がありません。groupCount / excludedBreakdown はグループ行から推定した値になります");
	}

	const built = buildEnvelope({
		rows: groups,
		runSummary: runSummary || {},
		window,
		generatedAt,
		query: {
			estimatedBytes,
			maxBytesBilled: MAX_BYTES_BILLED,
			totalRows: result.totalRows,
		},
	});

	return {
		envelope: built.envelope,
		warnings: [...warnings, ...built.warnings],
		sql,
		estimatedBytes,
		totalRows: result.totalRows,
		cacheHit: result.cacheHit,
	};
};

module.exports = Object.freeze({
	BQ_API_ROOT,
	BQ_LOCATION,
	DEFAULT_MAX_RESULTS,
	DEFAULT_QUERY_TIMEOUT_MS,
	MAX_RESULT_PAGES,
	toSqlTimestampLiteral,
	renderSql,
	buildQueryRequest,
	parseTriageRows,
	toInt64Number,
	checkEstimatedBytes,
	describeApiError,
	callBigQuery,
	estimateQuery,
	runQuery,
	fetchTriageEnvelope,
});
