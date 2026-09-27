// #2075 【設計】`pipefail` の下で **パイプの下流に «途中で読むのをやめるもの» を置かない**。
//
// `set -o pipefail` は «パイプラインの終了コード = 最後に非ゼロで終わったコマンドのもの» にする。
// 下流が最初の一致・最初の 1 行で閉じると、上流は **SIGPIPE で殺されて 141** を返すので、
// pipefail がその 141 をパイプライン全体の終了コードにしてしまう。つまり:
//
//   - `if … | grep -q PAT` → **一致しているのに «無い»**
//   - `if ! … | grep -q PAT` → **在っても «無い» と言い切る**（落ちない検査になる。もっと悪い）
//   - `v=$(… | head -1)`（`set -e` 併用）→ **値は取れているのにその行でスクリプトが死ぬ**
//
// ⚠️ 上流の出力が小さいときは «上流が書き終わるほうが速い» ので普通は通る。
//    だから **手元では再現せず、本番/CI でだけ稀に負ける**。実測（2026-09-26 の main
//    https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36206053417 ）で PR Check が
//    1 行だけ ng になり、同じ commit をローカルで回すと 18/18 緑だった。
//
// ⚠️ **`head -1` を `read -r` へ置き換えるだけでは直らない**（1 行で閉じるのは同じなので
//    上流はやはり殺される。2026-09-27 に 3 回とも 141 を実測した）。
//    直し方は 1 つだけ: **上流を先に変数へ受け切って**から `<<<` で渡す。
//
//      body="$(上流)"        # ここで上流は最後まで走り切る
//      grep -q PAT <<< "$body"
//
// 使い方: node ./scripts/assert-no-pipefail-early-exit-pipe.mjs [走査する *.sh ...]
//         （引数なしなら `git ls-files '*.sh'`）

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = process.argv.slice(2).length
	? process.argv.slice(2)
	: execFileSync("git", ["ls-files", "*.sh"], { encoding: "utf8" }).split("\n").filter(Boolean);

/** `set -euo pipefail` / `set -o pipefail` / `set -Eeuo pipefail` のどれでも拾う */
const ENABLES_PIPEFAIL = /^[ \t]*set[ \t]+-[^\n]*\bpipefail\b/m;

/**
 * 引用符の中とコメントを、**同じ長さの空白へ潰す**（行番号と桁を保つため）。
 *
 * ⚠️ これが無いと `echo "  comm -23 a b | head"` のような **説明文**を違反と読む
 *    （`infra/gcp/transfer_gcs_bucket_prefix.sh` に実在する）。
 * ⚠️ **逆に潰しすぎる方が怖い。** 二重引用符の中の `$( … )` は **文字列ではなくコード**で、
 *    このリポジトリの違反はむしろそこに多い（`v="$(… | head -n 1)"`）。単純に «引用符の中を
 *    全部潰す» と書いたら 13 件のうち 3 件を見逃した（2026-09-27 に実測）。だから
 *    `$( … )` に入ったらコードとして読み直す。⚠️ 入れ子があるので括弧の深さを数える。
 */
function blank(src) {
	const out = src.split("");
	// スタックの先頭が «いまの文脈»。"code" / "dq"（二重引用符）/ "sq"（単一引用符）
	// "sub" は二重引用符の中の $( … )。paren で深さを数える
	const stack = [{ kind: "code", paren: 0 }];
	const top = () => stack[stack.length - 1];
	const hide = (i) => {
		if (src[i] !== "\n") out[i] = " ";
	};
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		const k = top().kind;

		if (k === "sq") {
			hide(i);
			if (c === "'") stack.pop();
			i += 1;
			continue;
		}

		if (k === "dq") {
			if (c === "\\" && i + 1 < src.length) {
				hide(i);
				hide(i + 1);
				i += 2;
				continue;
			}
			if (c === "$" && src[i + 1] === "(") {
				// ⚠️ ここは文字列ではなくコード。潰さずに読む
				stack.push({ kind: "sub", paren: 0 });
				i += 2;
				continue;
			}
			hide(i);
			if (c === '"') stack.pop();
			i += 1;
			continue;
		}

		// code / sub
		if (c === "\\" && i + 1 < src.length && src[i + 1] !== "\n") {
			i += 2;
			continue;
		}
		if (c === "'") {
			hide(i);
			stack.push({ kind: "sq", paren: 0 });
			i += 1;
			continue;
		}
		if (c === '"') {
			hide(i);
			stack.push({ kind: "dq", paren: 0 });
			i += 1;
			continue;
		}
		if (c === "#") {
			// 引用符の外の `#`。`${x#y}` のような展開も引用符の外に出るので、
			// **行頭か空白の直後** の `#` だけをコメントとみなす
			const prev = i === 0 ? "\n" : src[i - 1];
			if (prev === "\n" || prev === " " || prev === "\t") {
				while (i < src.length && src[i] !== "\n") {
					out[i] = " ";
					i += 1;
				}
				continue;
			}
		}
		if (k === "sub") {
			if (c === "(") top().paren += 1;
			else if (c === ")") {
				if (top().paren === 0) {
					stack.pop(); // $( … ) を閉じて二重引用符へ戻る
					i += 1;
					continue;
				}
				top().paren -= 1;
			}
		}
		i += 1;
	}
	return out.join("");
}

/** パイプの下流で «途中で読むのをやめるもの» */
const PATTERNS = [
	{ re: /\|[ \t]*head\b/, what: "| head（先頭 N 行だけ読んで閉じる）" },
	{
		// grep の引数に q / m を含むフラグ（-q, -qw, -Eq, -m 1, --quiet, --max-count）がある
		// ⚠️ **q / m は «フラグの塊のどこ» にでも来る**（`-qw` / `-qE` / `-Eq`）。
		// 末尾だけを見る書き方にしたら 3 件取りこぼした（2026-09-27 実測）
		re: /\|[ \t]*grep\b(?=[^|\n]*(?:[ \t]-[A-Za-z]*[qm][A-Za-z]*\b|--quiet\b|--silent\b|--max-count\b))/,
		what: "| grep -q / -m（最初の一致で閉じる）",
	},
];

const findings = [];
for (const file of files) {
	let src;
	try {
		src = readFileSync(file, "utf8");
	} catch {
		continue; // ls-files に載っていて手元に無いもの（sparse checkout 等）は飛ばす
	}
	if (!ENABLES_PIPEFAIL.test(src)) continue; // pipefail が無ければこの欠陥は起きない
	const lines = blank(src).split("\n");
	lines.forEach((line, idx) => {
		for (const { re, what } of PATTERNS) {
			if (re.test(line)) findings.push({ file, line: idx + 1, what, text: src.split("\n")[idx].trim() });
		}
	});
}

if (findings.length === 0) {
	console.log(
		`✅ pipefail の下でパイプの下流に早期終了を置いている箇所はありません（${files.length} 本の *.sh を検査）`,
	);
	process.exit(0);
}

console.error("❌ pipefail の下でパイプの下流に «途中で読むのをやめるもの» があります（#2075）");
console.error("   直し方: 上流を先に変数へ受け切り、`<<<` で渡す（read -r へ替えるだけでは直りません）");
for (const f of findings) {
	console.error(`   - ${f.file}:${f.line}  ${f.what}`);
	console.error(`     ${f.text}`);
}
process.exit(1);
