#!/usr/bin/env node
// #1196 error-triage / 唯一のエントリポイント。実時刻・ファイル・ネットワークに触るのはここと bq.js だけ。
//
// PR2 の時点で実装しているのは **`plan`（dry-run）サブコマンドだけ**です。
// Issue の起票・reopen・コメント（`apply` / `github.js`）は PR3 の範囲で、この Job には
// `issues: write` も付いていません。
//
//   node scripts/error-triage/main.js plan --lookback-hours 25 --out /tmp/error-triage/plan.json
//
// ★ PR2 では既存 Issue を読んでいません（`github.js` が PR3 のため）。
//   したがって全グループが「未知の fingerprint」として扱われ、件数が PANIC 閾値
//   （constants.js の PANIC_THRESHOLD）を超えると計画は「1件も起票しない」形になります。
//   dry-run の目的は「実データにエラーグループが何種類あるか」を数日観測することなので、
//   この段階ではそれで足ります。Job Summary の末尾にその旨を明記します。

"use strict";

const { mkdirSync, readFileSync, writeFileSync, appendFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const { DEFAULT_LOOKBACK_HOURS, MAX_BYTES_BILLED } = require("./constants");
const { assertSqlFpAlgoVersion } = require("./fingerprint");
const { fetchTriageEnvelope } = require("./bq");
const { renderJobSummary } = require("./render");
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

/**
 * PR2 時点の但し書き。Job Summary の末尾に必ず付ける。
 *
 * @param {{estimatedBytes:number, totalRows:number, cacheHit:boolean}} stats
 * @returns {string}
 */
const renderPr2Notice = ({ estimatedBytes, totalRows, cacheHit }) =>
	[
		"",
		"### この run について（PR2 / dry-run）",
		"",
		`- BigQuery: 見積り **${estimatedBytes.toLocaleString("en-US")} bytes** / 上限 ${MAX_BYTES_BILLED.toLocaleString("en-US")} bytes / 取得行 ${totalRows}${cacheHit ? "（キャッシュヒット）" : ""}`,
		"- **既存 Issue は読んでいません**（`github.js` は PR3 の範囲）。そのため全グループが「未知の fingerprint」として扱われ、",
		"  未知が PANIC 閾値を超えると計画は「1件も起票しない」形になります。ここで見るべきは**エラーグループの種類数と内訳**です。",
		"- この Job は `issues: read` しか持たないため、Issue の起票・reopen・コメントは**権限レベルで不可能**です。",
		"",
	].join("\n");

/**
 * `plan` サブコマンド。
 *
 * @param {{options:Record<string, string>, env:NodeJS.ProcessEnv, clock?:() => Date, fetchImpl?:Function}} params
 * @returns {Promise<number>} 終了コード
 */
const runPlan = async ({ options, env, clock = systemClock, fetchImpl }) => {
	const lookbackHours = Number.parseInt(options["lookback-hours"] || String(DEFAULT_LOOKBACK_HOURS), 10);
	const sqlPath = options.sql || DEFAULT_SQL_PATH;
	const outPath = options.out || null;

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

	const result = await fetchTriageEnvelope({
		projectId,
		accessToken,
		sqlTemplate,
		window,
		generatedAt,
		fetchImpl,
	});

	// PR2 は既存 Issue を読まない（github.js は PR3）。突合の入力は空配列。
	const plan = buildPlan({ envelope: result.envelope, issues: [], commitDates: {} });

	for (const message of [...result.warnings, ...plan.warnings]) warn(message);
	for (const message of plan.errors) fail(message);

	const summary =
		renderJobSummary({ envelope: result.envelope, plan, mode: "dry-run (PR2)" }) +
		renderPr2Notice({
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

/**
 * エントリポイント本体（テストから呼べるように分けてある）。
 *
 * @param {{argv:ReadonlyArray<string>, env:NodeJS.ProcessEnv, clock?:() => Date, fetchImpl?:Function}} params
 * @returns {Promise<number>}
 */
const main = async ({ argv, env, clock, fetchImpl }) => {
	const { command, options } = parseArgs(argv);
	if (command === "plan") return runPlan({ options, env, clock, fetchImpl });
	if (command === "apply") {
		fail("`apply` は PR3 の範囲です（この PR には github.js も issues: write もありません）");
		return 2;
	}
	fail(`使い方: node scripts/error-triage/main.js plan [--lookback-hours 25] [--out plan.json] [--sql path]`);
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

module.exports = Object.freeze({ DEFAULT_SQL_PATH, parseArgs, requireEnv, renderPr2Notice, runPlan, main });
