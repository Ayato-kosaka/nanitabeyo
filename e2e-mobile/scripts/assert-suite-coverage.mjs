import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 📏 「この run は最後まで走ったのか」を実行後に突き合わせるゲート（#2001）。
 *
 * 使い方: node e2e-mobile/scripts/assert-suite-coverage.mjs <pnpm スクリプト名> [jest へ渡す追加引数...]
 *   例)   node e2e-mobile/scripts/assert-suite-coverage.mjs test:ci:ios
 *   例)   node e2e-mobile/scripts/assert-suite-coverage.mjs test:ci:ios --shard=1/2
 *
 * ## なぜ必要か
 * iOS ジョブは 3 時間の `timeout-minutes` に当たって **毎晩打ち切られていた**。
 * 実測（2026-09-22 に調査）: 直近 12 run のうち 9 回が cancelled、少なくとも 09-09 以降連続。
 * 打ち切られた run は 45 suite のうち **31 しか実行しておらず、`tests/smoke/boot.test.ts` を
 * 含む 14 suite は 13 夜以上 1 度も走っていなかった**。
 *
 * それでも誰も気付かなかったのは、打ち切りが GitHub 上で **`cancelled` としか出ない**からである。
 * 「iOS は何件落ちた」と読んでいた数字は、**完走していない run の途中経過**だった。
 * 見えないものを «無い» と読まないために、実行後に必ずここで突き合わせる。
 *
 * ## 判定
 * - jest のサマリ行（`Test Suites: …`）がログにある = 1 巡目は最後まで走った → ✅
 *   （未報告 suite は «意図的な skip» があり得るので参考情報として出すだけ）
 * - サマリ行が無い = **途中で打ち切られた** → ❌ 未報告 suite を列挙して exit 1
 *
 * ## ⚠️ このステップは `if: always()` で回すこと
 * ジョブが timeout で cancel されても `always()` のステップは猶予時間の中で実行される
 * （run 35662317482 で実測: cancel の 55 秒後に artifact のアップロードが完走している）。
 * 打ち切られたときこそ動いてほしいステップなので、`success()` / `failure()` では足りない。
 *
 * ## 期待する suite 一覧は jest から取る（写経しない）
 * tier の絞り込み（`--testPathPattern`）と `RUN_MUTATION` / `RUN_CATALOG` / `DETOX_TEST_FILTER` の
 * 解釈は package.json と jest.config.js が正である。ここで同じ条件を書き直すと、
 * 片方だけ直ったときに **緑のまま嘘をつく**。実際に走るときと同じ引数で `jest --listTests` を呼ぶ。
 *
 * ⚠️ **`--shard` も同じ理由でそのまま渡すこと。** 分割して流しているのに «期待» を 45 件のまま
 * 数えると、**毎晩「22 件が未実行」と誤報する**。run-detox-ci.sh が jest へ渡すのと
 * 同じ引数を、このスクリプトにも同じように渡す（workflow 側で 1 か所から両方へ配っている）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, "..");
const repoRoot = path.resolve(e2eRoot, "..");

const scriptName = process.argv[2];
/** 実行時に jest へ渡した追加引数（現状は `--shard=N/M`）。期待側にも同じものを効かせる */
const extraJestArgs = process.argv.slice(3);
if (!scriptName) {
	console.error("::error::実行した pnpm スクリプト名を渡してください（例: test:ci:ios）");
	process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(e2eRoot, "package.json"), "utf8"));
const command = pkg.scripts?.[scriptName];
if (!command) {
	console.error(`::error::e2e-mobile/package.json に "${scriptName}" がありません`);
	process.exit(1);
}

/**
 * pnpm スクリプトの定義から «jest へ渡る引数» と «前置きの環境変数» を取り出す。
 *
 * 例: `RUN_CATALOG=1 detox test --configuration ios.sim.release -- --testPathPattern 'tests/catalog/'`
 *     → env {RUN_CATALOG: "1"} / jestArgs ["--testPathPattern", "tests/catalog/"]
 */
function parseScript(cmd) {
	const env = {};
	const envRe = /^([A-Z_][A-Z0-9_]*)=(\S+)\s+/;
	let rest = cmd;
	for (let m = rest.match(envRe); m; m = rest.match(envRe)) {
		env[m[1]] = m[2];
		rest = rest.slice(m[0].length);
	}
	const sep = rest.match(/\s--\s/);
	const jestArgs = sep
		? // クォートは detox→jest の受け渡しで外れるので、ここでも外してから配列にする
			(rest.slice(sep.index + sep[0].length).match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((a) =>
				a.replace(/^['"]|['"]$/g, ""),
			)
		: [];
	return { env, jestArgs };
}

const { env: scriptEnv, jestArgs } = parseScript(command);

/** 実行されるはずだった suite の一覧（repo ルートからの相対パス） */
function expectedSuites() {
	const out = execFileSync(
		process.execPath,
		[path.join(e2eRoot, "node_modules", "jest", "bin", "jest.js"), "--listTests", ...jestArgs, ...extraJestArgs],
		{ cwd: e2eRoot, env: { ...process.env, ...scriptEnv }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
	return out
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.endsWith(".test.ts"))
		.map((l) => path.relative(e2eRoot, l))
		.sort();
}

const LOG_PATH = path.join(e2eRoot, ".detox-ci-logs", "detox-run.log");
if (!existsSync(LOG_PATH)) {
	// テストへ到達する前（ビルド失敗など）に落ちた場合。その失敗は別のステップが既に赤くしている
	console.log(
		`ℹ️ 実行ログがありません（${path.relative(repoRoot, LOG_PATH)}）。テストへ到達していないため突き合わせを行いません`,
	);
	process.exit(0);
}
const log = readFileSync(LOG_PATH, "utf8");

const reported = new Set([...log.matchAll(/\b(?:PASS|FAIL)\s+(tests\/\S+\.test\.ts)/g)].map((m) => m[1]));
const summaryLines = [...log.matchAll(/^\s*Test Suites:.*$/gm)].map((m) => m[0].trim());
const finished = summaryLines.length > 0;

let expected;
try {
	expected = expectedSuites();
} catch (error) {
	console.error(`::warning::期待する suite 一覧を jest から取得できませんでした: ${error.message}`);
	expected = null;
}
const unreported = expected ? expected.filter((f) => !reported.has(f)) : [];

const lines = [];
lines.push(`## Detox suite coverage (${[scriptName, ...extraJestArgs].join(" ")})`);
lines.push("");
if (finished) {
	lines.push(`✅ **完走しました** — 報告された suite: ${reported.size}${expected ? ` / 期待 ${expected.length}` : ""}`);
	lines.push("");
	for (const s of summaryLines) lines.push(`- \`${s}\``);
	if (unreported.length > 0) {
		lines.push("");
		lines.push(`<details><summary>報告行が無かった suite ${unreported.length} 件（意図的な skip を含む）</summary>`);
		lines.push("");
		for (const f of unreported) lines.push(`- \`${f}\``);
		lines.push("");
		lines.push("</details>");
	}
} else {
	lines.push(
		`❌ **完走していません（途中で打ち切られました）** — 報告された suite: ${reported.size}${expected ? ` / 期待 ${expected.length}` : ""}`,
	);
	lines.push("");
	lines.push("jest のサマリ行が 1 つもありません。ジョブの `timeout-minutes` に当たった可能性が高いです。");
	lines.push("**この run の «失敗 N 件» は完走した結果ではありません。残りの suite は実行すらされていません。**");
	if (unreported.length > 0) {
		lines.push("");
		lines.push(`### 実行されなかった suite（${unreported.length} 件）`);
		lines.push("");
		for (const f of unreported) lines.push(`- \`${f}\``);
	}
}

const body = lines.join("\n");
console.log(body);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + "\n");

if (!finished) {
	console.error(
		`::error::${scriptName} は完走していません（報告 ${reported.size}${expected ? ` / 期待 ${expected.length}` : ""}）。未実行の suite があります`,
	);
	process.exit(1);
}
