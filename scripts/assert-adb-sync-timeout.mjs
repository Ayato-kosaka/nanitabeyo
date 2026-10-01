// #1579 【設計】**adb は「上限付きの 1 本」を通してしか呼ばない。**
//
// ## 何を防いでいるか（2026-09-30 の夜間 iOS が 1 suite も走らなかった事故）
//
// `utils/locale.ts` の実行時ロケール観測へ «取れなければ `adb wait-for-device` で待って
// 試し直す» を入れた（PR #2091）。`adb wait-for-device` は **指定シリアルの端末が現れるまで
// 無限に待つ**。macOS ランナーには Android SDK が入っているので **iOS でも `adb` は在り**、
// iOS の `device.id`（シミュレータの UDID）はいつまでも現れない。
// 観測は全 spec が import する `fixtures/e2e.ts` のモジュール評価時に走るため、
// **最初の spec の import で jest が固まり**、240 分の timeout で
// [run 36787284601](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36787284601) の
// iOS 2 シャードが `cancelled`（`assert-suite-coverage` は両シャード **報告 0 / 期待 23**）。
//
// 欠陥を 1 文で言うと: **«観測のための待機» に上限が無く、しかもテスト本体より前に走るので、
// 落ちずに全 suite が消えた。**
//
// ## 何を縛るか
//
// 1. `e2e-mobile/utils/adb.ts` 以外から **adb を直に spawn しない**
//    （上限の有無が呼び出し側ごとにばらけるのを止める。当時 adb の呼び出しは 6 箇所あり、
//    どれ 1 つも `timeout` を渡していなかった）
// 2. その 1 本は **必ず `timeout` を渡す**
// 3. **返ってこないことがあるサブコマンド**（`wait-for-*` / `logcat` の追従）を呼ぶときは、
//    その呼び出し自身が **`timeoutMs` を明示する**（既定値任せにしない）
// 4. シェル（`e2e-mobile/scripts/*.sh`）からの `adb wait-for-*` は **`timeout` 経由で呼ぶ**。
//    ここは «端末が居る» 前提の場所だが、居なければ job timeout まで無言で待つ形は同じである
//
// 使い方: node ./scripts/assert-adb-sync-timeout.mjs [走査するファイル ...]
//         （引数なしなら `git ls-files 'e2e-mobile/**'` の .ts/.js/.mjs/.cjs/.sh）

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** adb の上限が宿る唯一の場所 */
const CHOKEPOINT = "e2e-mobile/utils/adb.ts";

const argv = process.argv.slice(2);
const files = argv.length
	? argv
	: execFileSync("git", ["ls-files", "e2e-mobile"], { encoding: "utf8" })
			.split("\n")
			.filter((f) => /\.(ts|tsx|js|mjs|cjs|sh)$/.test(f));

/**
 * コメントだけを **同じ長さの空白へ潰す**（行番号と桁を保つ）。
 *
 * ⚠️ 文字列は潰さない。検査したいもの（`"adb"` / `"wait-for-device"`）が文字列リテラルだからである。
 * ⚠️ 逆に **コメントは必ず潰す**。このガードの説明文自身に `execFileSync("adb"` と書けないと、
 *    «なぜこのガードが要るのか» を該当ファイルへ書けなくなり、いずれガードごと外される。
 */
function stripComments(src) {
	const out = src.split("");
	const hide = (i) => {
		if (src[i] !== "\n") out[i] = " ";
	};
	let i = 0;
	let quote = null; // '"' | "'" | "`"
	while (i < src.length) {
		const c = src[i];
		if (quote) {
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === quote) quote = null;
			i += 1;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			quote = c;
			i += 1;
			continue;
		}
		if (c === "/" && src[i + 1] === "/") {
			while (i < src.length && src[i] !== "\n") hide(i++);
			continue;
		}
		if (c === "/" && src[i + 1] === "*") {
			hide(i++);
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) hide(i++);
			hide(i++);
			hide(i++);
			continue;
		}
		i += 1;
	}
	return out.join("");
}

/**
 * adb を直に起動する形（`exec`/`spawn` 系の第 1 引数が adb）。
 *
 * ⚠️ **`"adb"` だけを見ないこと。** `execSync` はコマンド行を 1 本の文字列で取るので
 * `execSync("adb devices")` の形になる。引数配列の形だけを見る書き方にしたら
 * これを取りこぼした（自己テストで実測）。だから **引用符の直後 / 空白の直前**の両方を許す。
 */
const SPAWNS_ADB = /\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\s*\(\s*(["'`])adb(?=\1|\s)/g;

/**
 * 返ってこないことがある adb サブコマンド。
 *
 * - `wait-for-device` / `wait-for-any-device` … 端末が現れるまで**無限に**待つ（#1579 の真因）
 * - `logcat` … `-d` / `-t` を付けない限り**流しっぱなし**になる
 */
const BLOCKING_SUBCOMMAND = /(["'`])(wait-for-[a-z-]+|logcat)\1/;

/** 1 つの呼び出し（丸括弧が閉じるまで）を切り出す */
function callTextAt(src, openParenIndex) {
	let depth = 0;
	for (let i = openParenIndex; i < src.length; i += 1) {
		if (src[i] === "(") depth += 1;
		else if (src[i] === ")") {
			depth -= 1;
			if (depth === 0) return src.slice(openParenIndex, i + 1);
		}
	}
	return src.slice(openParenIndex);
}

const findings = [];
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

/** シェルの `adb wait-for-*` は `timeout` 経由であること */
function checkShell(file, raw) {
	raw.split("\n").forEach((line, idx) => {
		if (line.trimStart().startsWith("#")) return; // 説明文は見ない（書けないと理由を残せない）
		if (!/(?:^|[^\w-])adb\s+wait-for-\S+/.test(line)) return;
		if (/\btimeout\s/.test(line)) return;
		findings.push({
			file,
			line: idx + 1,
			what: "adb wait-for-* に上限がありません（`timeout <秒> adb wait-for-device` にしてください）",
		});
	});
}

for (const file of files) {
	let raw;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		continue; // ls-files に載っていて手元に無いもの（sparse checkout 等）は飛ばす
	}
	if (file.endsWith(".sh")) {
		checkShell(file, raw);
		continue;
	}
	const src = stripComments(raw);

	// 1. チョークポイント以外から adb を直に spawn していないこと
	for (const m of src.matchAll(SPAWNS_ADB)) {
		if (file === CHOKEPOINT) continue;
		findings.push({
			file,
			line: lineOf(src, m.index),
			what: `adb を直に起動しています（${CHOKEPOINT} の adbSync を使ってください）`,
		});
	}

	// 3. 返ってこないことがあるサブコマンドは、その呼び出しで上限を明示していること
	for (const m of src.matchAll(/\badbSync\s*\(/g)) {
		const call = callTextAt(src, m.index + m[0].length - 1);
		const blocking = BLOCKING_SUBCOMMAND.exec(call);
		// `logcat -d` / `logcat -t N` は溜まっているぶんを吐いて終わるので、既定の上限で足りる
		const bounded = blocking?.[2] === "logcat" && /["'`]-[dt]["'`]/.test(call);
		if (blocking && !bounded && !/\btimeoutMs\b/.test(call)) {
			findings.push({
				file,
				line: lineOf(src, m.index),
				what: `adb ${blocking[2]} は返ってこないことがあります。この呼び出しで timeoutMs を明示してください`,
			});
		}
	}
}

// 2. チョークポイントが現に上限を渡していること
if (!argv.length || files.includes(CHOKEPOINT)) {
	let chokepoint = "";
	try {
		chokepoint = stripComments(readFileSync(CHOKEPOINT, "utf8"));
	} catch {
		findings.push({ file: CHOKEPOINT, line: 1, what: "adb の唯一の入口が見つかりません" });
	}
	if (chokepoint && !/\btimeout:/.test(chokepoint)) {
		findings.push({
			file: CHOKEPOINT,
			line: 1,
			what: "execFileSync へ timeout を渡していません（上限が無いと #1579 が再発します）",
		});
	}
}

if (findings.length === 0) {
	console.log(`✅ adb の呼び出しは全て上限付きの ${CHOKEPOINT} を経由しています（${files.length} 本を検査）`);
	process.exit(0);
}

console.error("❌ 上限の無い adb 呼び出しがあります（#1579）");
console.error(`   直し方: ${CHOKEPOINT} の adbSync() を使い、待機系は timeoutMs を明示する`);
for (const f of findings) console.error(`   - ${f.file}:${f.line}  ${f.what}`);
process.exit(1);
