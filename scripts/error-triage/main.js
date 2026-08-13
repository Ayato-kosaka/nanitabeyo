#!/usr/bin/env node
// #1196 error-triage / 唯一のエントリポイント。実時刻・ファイル・ネットワークに触るのはここと bq.js / github.js だけ。
//
//   # 起票しない。GitHub へ1バイトも書かない（issues: read の plan Job）
//   node scripts/error-triage/main.js plan  --lookback-hours 25 --out /tmp/error-triage/plan.json
//   # 起票する。GitHub への書き込みはここだけ（issues: write の triage Job）
//   node scripts/error-triage/main.js apply --lookback-hours 25 --out /tmp/error-triage/plan.json
//
// `plan` と `apply` の差は「計画を適用するかどうか」だけで、**計画そのものは同一**です
// （#1198 Phase 0〜3 に書き込み API を1本も含めないのがその担保）。
// ただし `plan` は既存 Issue を読まない（`issues: read` すら要らない形を維持する）ため、
// 全グループが「未知の fingerprint」として扱われます。突合の実体を見たいときは `apply --dry-run` を使ってください。

"use strict";

const { mkdirSync, readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const { DEFAULT_LOOKBACK_HOURS, MAX_BYTES_BILLED, PARENT_ISSUE_NUMBER } = require("./constants");
const { assertSqlFpAlgoVersion } = require("./fingerprint");
const { fetchTriageEnvelope } = require("./bq");
const { applyPlan, collectIndexSources, createGitHubClient, parseRepository, resolveCommitDates } = require("./github");
const { renderApplySummary, renderJobSummary } = require("./render");
const { buildPlan } = require("./triage");
const { computeGeneratedAt, computeWindow, systemClock } = require("./window");

const DEFAULT_SQL_PATH = join(__dirname, "sql", "error-triage.sql");

/**
 * `--key value` 形式の argv を素朴に読む（依存パッケージを増やさないため）。
 *
 * @param {ReadonlyArray<string>} argv
 * @returns {{command:string|null, options:Record<string, string>}}
 */
const parseArgs = (argv) => {
	const options = {};
	let command = null;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) {
				options[key] = "true";
			} else {
				options[key] = next;
				index += 1;
			}
		} else if (command === null) {
			command = token;
		}
	}
	return { command, options };
};

/**
 * 環境変数を必須で読む。
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} names 先に見つかったものを採る
 * @returns {string}
 */
const requireEnv = (env, names) => {
	for (const name of names) {
		if (env[name]) return String(env[name]);
	}
	throw new Error(`環境変数 ${names.join(" / ")} のいずれかが必要です`);
};

/** GitHub Actions のログ用アノテーション。 */
const notice = (message) => process.stdout.write(`::notice::${message}\n`);
const warn = (message) => process.stdout.write(`::warning::${message}\n`);
const fail = (message) => process.stderr.write(`::error::${message}\n`);

/**
 * Job Summary へ追記する（`$GITHUB_STEP_SUMMARY` が無いローカル実行では標準出力へ）。
 *
 * @param {string} markdown
 * @param {NodeJS.ProcessEnv} env
 */
const writeJobSummary = (markdown, env) => {
	const path = env.GITHUB_STEP_SUMMARY;
	if (!path) {
		process.stdout.write(`${markdown}\n`);
		return;
	}
	appendFileSync(path, `${markdown}\n`, "utf8");
};

/** BigQuery のスキャン量。じわじわ増えていることに気づけるよう毎回 Job Summary へ残す。 */
const renderQueryNotice = ({ estimatedBytes, totalRows, cacheHit }) =>
	`- BigQuery: 見積り **${estimatedBytes.toLocaleString("en-US")} bytes** / 上限 ${MAX_BYTES_BILLED.toLocaleString("en-US")} bytes / 取得行 ${totalRows}${cacheHit ? "（キャッシュヒット）" : ""}`;

/**
 * `plan` Job の但し書き。Job Summary の末尾に必ず付ける。
 *
 * @param {{estimatedBytes:number, totalRows:number, cacheHit:boolean}} stats
 * @returns {string}
 */
const renderPlanNotice = ({ estimatedBytes, totalRows, cacheHit }) =>
	[
		"",
		"### この run について（plan / dry-run）",
		"",
		renderQueryNotice({ estimatedBytes, totalRows, cacheHit }),
		"- **既存 Issue は読んでいません**（この Job は突合そのものを行いません）。そのため全グループが「未知の fingerprint」として扱われ、",
		"  未知が PANIC 閾値を超えると計画は「1件も起票しない」形になります。ここで見るべきは**エラーグループの種類数と内訳**です。",
		"- この Job は `issues: read` しか持たないため、Issue の起票・reopen・コメントは**権限レベルで不可能**です。",
		"  突合まで含めた結果を見たいときは `triage` Job（`apply`）を使ってください。",
		"",
	].join("\n");

/**
 * BigQuery から契約エンベロープを取るところまで（`plan` / `apply` 共通）。
 *
 * @param {{options:Record<string, string>, env:NodeJS.ProcessEnv, clock:() => Date, fetchImpl?:Function}} params
 */
const fetchEnvelope = async ({ options, env, clock, fetchImpl }) => {
	const lookbackHours = Number.parseInt(options["lookback-hours"] || String(DEFAULT_LOOKBACK_HOURS), 10);
	const sqlPath = options.sql || DEFAULT_SQL_PATH;

	const projectId = requireEnv(env, ["GCP_PROJECT_ID", "GCP_PROJECT"]);
	const accessToken = requireEnv(env, ["BQ_ACCESS_TOKEN"]);

	const sqlTemplate = readFileSync(sqlPath, "utf8");

	// 横断レビュー 1-3: SQL 冒頭の `-- fpalgo: N` と JS の FP_ALGO_VERSION が一致しないと、
	// 片方だけ変わった状態で本番が走って全件が新規 fingerprint になる。ここで必ず止める。
	const fpAlgo = assertSqlFpAlgoVersion(sqlTemplate);
	if (!fpAlgo.ok) throw new Error(`${sqlPath}: ${fpAlgo.message}`);

	const now = clock();
	const window = computeWindow({ now, lookbackHours });
	const generatedAt = computeGeneratedAt(now);
	notice(`集計窓: ${window.startUtc} 〜 ${window.endUtc}（${window.lookbackHours}h スライド窓）`);

	return fetchTriageEnvelope({ projectId, accessToken, sqlTemplate, window, generatedAt, fetchImpl });
};

/**
 * `plan` サブコマンド。
 *
 * @param {{options:Record<string, string>, env:NodeJS.ProcessEnv, clock?:() => Date, fetchImpl?:Function}} params
 * @returns {Promise<number>} 終了コード
 */
const runPlan = async ({ options, env, clock = systemClock, fetchImpl }) => {
	const outPath = options.out || null;
	const result = await fetchEnvelope({ options, env, clock, fetchImpl });

	// `plan` Job は既存 Issue を読まない（issues: read すら要らない形を保つ）。突合の入力は空配列。
	const plan = buildPlan({ envelope: result.envelope, issues: [], commitDates: {} });

	for (const message of [...result.warnings, ...plan.warnings]) warn(message);
	for (const message of plan.errors) fail(message);

	const summary =
		renderJobSummary({ envelope: result.envelope, plan, mode: "dry-run" }) +
		renderPlanNotice({
			estimatedBytes: result.estimatedBytes,
			totalRows: result.totalRows,
			cacheHit: result.cacheHit,
		});
	writeJobSummary(summary, env);

	if (outPath) {
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, `${JSON.stringify({ envelope: result.envelope, plan }, null, 2)}\n`, "utf8");
		notice(`計画を書き出しました: ${outPath}`);
	}

	if (!plan.valid) {
		fail("契約エンベロープが不変条件を満たしていません（上の ::error:: を参照）");
		return 1;
	}
	return 0;
};

/** この run の Actions ページ（Issue 本文のフッタから辿れるようにする）。 */
const runUrlFrom = (env) => {
	if (!env.GITHUB_RUN_ID || !env.GITHUB_REPOSITORY) return null;
	const server = env.GITHUB_SERVER_URL || "https://github.com";
	return `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
};

/**
 * `apply` サブコマンド。**GitHub への書き込みが起きる唯一の経路**。
 *
 * 流れは #1198 §1-A のとおり:
 *   Phase 0 入力の検証 → Phase 1 索引の構築（読み取りのみ）→ Phase 2 分類（純関数）
 *   → Phase 3 ガード（PANIC / fpalgo 不一致）→ Phase 4 適用 → Phase 5 後処理
 * Phase 0〜3 に書き込み API を1本も含まないので、`--dry-run` は Phase 4/5 を止めるだけで済み、
 * 判定結果は本番と完全に同一になります。
 *
 * @param {{options:Record<string, string>, env:NodeJS.ProcessEnv, clock?:() => Date, fetchImpl?:Function, sleepImpl?:Function}} params
 * @returns {Promise<number>} 終了コード
 */
const runApply = async ({ options, env, clock = systemClock, fetchImpl, sleepImpl }) => {
	const outPath = options.out || null;
	const dryRun = options["dry-run"] === "true";
	const parentIssue = Number.parseInt(options["parent-issue"] || String(PARENT_ISSUE_NUMBER), 10);

	const token = requireEnv(env, ["GITHUB_TOKEN", "GH_TOKEN"]);
	const { owner, repo } = parseRepository(requireEnv(env, ["GITHUB_REPOSITORY"]));

	const result = await fetchEnvelope({ options, env, clock, fetchImpl });

	const client = createGitHubClient({
		token,
		owner,
		repo,
		apiRoot: env.GITHUB_API_URL || undefined,
		fetchImpl,
		sleepImpl,
	});

	// --- Phase 1: 索引。ラベル索引が読めなければ例外が上がり、1件も書かずに終わる ---
	const sources = await collectIndexSources({ client, parentIssue });
	notice(`索引: Issue ${sources.issues.length} 件 / 親の sub-issue ${sources.subIssues.count} 件`);

	// --- Phase 2: 分類。commit 日時は reopen 候補のぶんだけ後追いで解決する ---
	//     commitDates は「旧ビルド由来なら抑止する」方向にしか効かないので、
	//     1回目（commitDates なし）の reopen 候補を出してから、その commit だけを引けば足りる。
	const firstPass = buildPlan({ envelope: result.envelope, issues: sources.issues, commitDates: {} });
	const reopenFingerprints = new Set(
		firstPass.items.filter((item) => item.action === "reopen").map((item) => item.fingerprint),
	);
	const shas = (result.envelope.groups || [])
		.filter((group) => reopenFingerprints.has(group.fingerprint))
		.flatMap((group) => (group.commits || []).map((commit) => commit.sha))
		.filter(Boolean);
	const commits = await resolveCommitDates({ client, shas });
	const plan = buildPlan({ envelope: result.envelope, issues: sources.issues, commitDates: commits.commitDates });

	for (const message of [...result.warnings, ...sources.warnings, ...commits.warnings, ...plan.warnings]) warn(message);
	for (const message of plan.errors) fail(message);

	// --- Phase 3: ガード。ここを通らなければ書き込みへ進まない ---
	const blocked = !plan.valid || plan.abort || plan.panic;
	if (plan.abort) fail(plan.abortReason);
	if (plan.panic) {
		fail(
			`PANIC: 未知 fingerprint が ${plan.counts.create + plan.counts.capped} 件で閾値 ${plan.panicThreshold} を超えました。1件も起票しません`,
		);
	}
	if (!plan.valid) fail("契約エンベロープが不変条件を満たしていません（上の ::error:: を参照）");

	// --- Phase 4 / 5 ---
	//     abort（fpalgo 不一致）は状態機械そのものが壊れているので**1バイトも書かない**。
	//     applyPlan は plan.abort を見て入口で return するので、親の常駐サマリにも到達しない。
	//     PANIC と契約違反は「起票・reopen・body 更新はしないが、何が起きたかは親の常駐サマリへ残す」。
	//     Job Summary は 90 日で消えるため、記録だけは残さないと誰も遡れない（G5）。
	//     → Phase 4 は `dryRun: dryRun || blocked` で止め、Phase 5 だけ `dryRun` だけを見る（L-3）。
	//     `--dry-run`（preview Job / issues: read）のときは Phase 5 も書かない。ここが唯一の書き込み判断。
	const applyResult = await applyPlan({
		client,
		envelope: result.envelope,
		plan,
		issues: sources.issues,
		subIssues: sources.subIssues,
		commitDates: commits.commitDates,
		commitLookups: commits.lookups,
		parentIssue,
		runUrl: runUrlFrom(env),
		dryRun: dryRun || blocked,
		parentSummaryDryRun: dryRun,
		sleepImpl,
	});
	for (const message of applyResult.warnings) warn(message);

	const summary =
		renderJobSummary({ envelope: result.envelope, plan, mode: dryRun ? "apply --dry-run" : "apply" }) +
		renderApplySummary({ applyResult }) +
		["", renderQueryNotice(result), ""].join("\n");
	writeJobSummary(summary, env);

	if (outPath) {
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, `${JSON.stringify({ envelope: result.envelope, plan, applyResult }, null, 2)}\n`, "utf8");
		notice(`計画と適用結果を書き出しました: ${outPath}`);
	}

	// 1件でも書き込みに失敗したら exit 1。**成功したように見えるのが一番まずい**（#1198 §1-F）。
	if (blocked) return 1;
	if (applyResult.failures.length > 0) {
		fail(`書き込みに ${applyResult.failures.length} 件失敗しました（詳細は Job Summary）`);
		return 1;
	}
	return 0;
};

/**
 * エントリポイント本体（テストから呼べるように分けてある）。
 *
 * @param {{argv:ReadonlyArray<string>, env:NodeJS.ProcessEnv, clock?:() => Date, fetchImpl?:Function, sleepImpl?:Function}} params
 * @returns {Promise<number>}
 */
const main = async ({ argv, env, clock, fetchImpl, sleepImpl }) => {
	const { command, options } = parseArgs(argv);
	if (command === "plan") return runPlan({ options, env, clock, fetchImpl });
	if (command === "apply") return runApply({ options, env, clock, fetchImpl, sleepImpl });
	fail(
		"使い方: node scripts/error-triage/main.js <plan|apply> [--lookback-hours 25] [--out plan.json] [--sql path] [--dry-run]",
	);
	return 2;
};

if (require.main === module) {
	main({ argv: process.argv.slice(2), env: process.env })
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			fail(error && error.message ? error.message : String(error));
			process.exitCode = 1;
		});
}

module.exports = Object.freeze({
	DEFAULT_SQL_PATH,
	parseArgs,
	requireEnv,
	renderPlanNotice,
	runUrlFrom,
	runPlan,
	runApply,
	main,
});
