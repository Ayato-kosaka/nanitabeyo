import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🪤 `react-hooks/exhaustive-deps` を **増やせなくする**（ratchet）CI ゲート。
 *
 * ## なぜ必要か（実際に 1 日溶かした）
 *
 * 2026-08-31、`DishMediaFeed` の `renderItem` が `useCallback` で包まれているのに依存配列へ
 * `isScreenActive` を入れ忘れており、**前面から離れたページのセルが古い値を抱えたまま鳴り続けた**。
 * オーナーに «音が重なる» と 3 回報告させ、原因の特定に丸一日かかった（#1641 / PR #1741）。
 *
 * ESLint はこれを **警告していた**。ところが
 *
 * - `eslint-config-expo` では `react-hooks/exhaustive-deps` は **warning**
 * - `expo lint` は warning では **終了コード 0**（＝ CI が緑）
 * - 既存の警告が 400 件以上あり、1 件増えても人間には見えない
 *
 * ため、**誰も気付けなかった**。ルールが在ることと、守られることは別である。
 *
 * ## なぜ «error 化して全部直す» にしないのか
 *
 * 既存 58 件のうち **14 件が `contexts/AuthProvider.tsx` と `contexts/DialogProvider.tsx`** にある。
 * あそこを lint に合わせて書き換えるのは «lint の整理» ではなく **認証とダイアログの作り替え**であり、
 * 直す価値（既知の不具合は無い）に対してデグレの危険が釣り合わない。
 *
 * そこで «増やさない» ことだけを機械的に保証する。既存分は台帳（下記 JSON）に載せてあり、
 * **減らすことはできても増やすことはできない**。減らしたら台帳を更新する（`--update`）。
 *
 * ## 使い方
 *
 *   pnpm --filter app-expo assert:no-new-exhaustive-deps            # 検査
 *   pnpm --filter app-expo assert:no-new-exhaustive-deps -- --update # 台帳を現状へ更新
 *
 * ⚠️ `--update` で増やす方向へ更新しないこと。**それをするならルールを消すのと同じ**である。
 *    このスクリプトは «増えた» ときに、増えた場所を名指しして落ちる。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const BASELINE_PATH = path.join(here, "exhaustive-deps-baseline.json");
const RULE = "react-hooks/exhaustive-deps";
/** `.eslintrc.js` の ignorePatterns と揃える（prebuild 済みの作業ツリーで ios/android を拾わない） */
const ESLINT_ARGS = ["--ext", ".ts,.tsx,.js,.jsx", "--format", "json"];

/**
 * ⚠️ 数ではなく **ファイルごとの件数**で持つ。
 *
 * 行番号で持つと、無関係な 1 行の追加で全部ずれて «直したのに赤» になり、
 * 数だけで持つと «1 件直して 1 件足す» が素通りする。ファイル単位が両者の中間で、
 * 「そのファイルの警告を増やしたか」を安定して見られる。
 */
function collect() {
	let raw;
	try {
		/*
		⚠️ `npx eslint` にしないこと。ワークスペースの外にある ESLint 10 を拾ってしまい、
		   `.eslintrc.js`（eslintrc 形式）を読めずに «設定ファイルが無い» で落ちる。
		   `expo lint` が実際に使うのはここにある 8.57 系である。
		*/
		raw = execFileSync(path.join(appRoot, "node_modules/.bin/eslint"), ["."].concat(ESLINT_ARGS), {
			cwd: appRoot,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch (error) {
		// eslint は違反があると終了コード 1 を返す。stdout に JSON は入っている
		raw = error.stdout ?? "";
	}
	const start = raw.indexOf("[");
	if (start < 0) throw new Error("eslint の JSON 出力を読めませんでした");
	const results = JSON.parse(raw.slice(start));

	const counts = {};
	for (const file of results) {
		const hits = (file.messages ?? []).filter((m) => m.ruleId === RULE).length;
		if (hits === 0) continue;
		counts[path.relative(appRoot, file.filePath)] = hits;
	}
	return counts;
}

const current = collect();
const total = Object.values(current).reduce((sum, n) => sum + n, 0);

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, "\t")}\n`);
	console.log(`✅ 台帳を更新しました（${total} 件 / ${Object.keys(current).length} ファイル）`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const increased = [];
for (const [file, count] of Object.entries(current)) {
	const allowed = baseline[file] ?? 0;
	if (count > allowed) increased.push({ file, allowed, count });
}

if (increased.length > 0) {
	console.error("🚨 react-hooks/exhaustive-deps の警告が増えています。");
	console.error("");
	for (const { file, allowed, count } of increased) {
		console.error(`  ${file}  ${allowed} → ${count}`);
	}
	console.error("");
	console.error("依存配列の漏れは «古い値を抱えたクロージャ» を作ります。2026-08-31 には");
	console.error("これが原因で «フィードの前のページが鳴り続ける» が起き、特定に丸一日かかりました。");
	console.error("");
	console.error("直し方: 足りない依存を入れる。入れると壊れるなら、");
	console.error("  // eslint-disable-next-line react-hooks/exhaustive-deps -- <なぜ入れないのか>");
	console.error("と **理由付きで** 明示的に外してください（理由の無い disable は禁止）。");
	process.exit(1);
}

const decreased = Object.entries(baseline).filter(([file, n]) => (current[file] ?? 0) < n);
if (decreased.length > 0) {
	console.log(`✅ 増えていません（${total} 件）。減ったファイルが ${decreased.length} 件あります:`);
	for (const [file, was] of decreased) console.log(`  ${file}  ${was} → ${current[file] ?? 0}`);
	console.log("");
	console.log("`pnpm --filter app-expo assert:no-new-exhaustive-deps -- --update` で台帳を締め直してください。");
	process.exit(0);
}

console.log(`✅ react-hooks/exhaustive-deps は増えていません（${total} 件）`);
