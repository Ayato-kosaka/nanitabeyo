import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 🛡️ «戻るの保険» を無効にする述語を検出する CI ゲート（#1404 / #1579）。
 *
 * ## 守る不変条件
 * 履歴の無い着地（URL 直リンク / リロード / ディープリンク）でも行き止まりにならないよう、
 * 画面の戻る導線は次の形で書かれている:
 *
 *     if (router.canDismiss()) { router.back(); return; }
 *     router.replace({ ... });   // ← 履歴が無いときの保険
 *
 * ここで `canDismiss()` を **`canGoBack()`** に書くと、`(tabs)` 配下では
 * タブナビゲータが «検索タブへ戻れる» と答えて **常に true** になり、
 * **下の replace が一度も働かない**。戻るは親ではなく検索タブへ飛ぶ。
 * （機序の正は `app/[locale]/(tabs)/profile/edit.tsx` の #1404 コメント）
 *
 * ## なぜ機械で縛るのか
 * #1404 は 2 ファイルを直して規約をコメントに書いたが、**同じディレクトリの兄弟 4 枚が
 * 古い形のまま残った**（#1579 の調査で発見）。コメントは grep されない。
 *
 * ## 検査範囲
 * `(tabs)` 配下のルートだけ。`(tabs)` の外はルート Stack が 1 枚で
 * `canGoBack()` も同じ答えになるため、この欠陥は起きない
 * （#1404 で E2E Web run 32243079269 の実測により確認済み）。
 *
 * 使い方: `pnpm --filter app-expo assert:back-fallback-predicate`
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const TABS_ROOT = path.join(appRoot, "app", "[locale]", "(tabs)");

/**
 * `if (router.canGoBack())` … の後ろ 400 文字以内に `router.replace(` があれば
 * «保険つきの分岐» とみなす。replace の無い素の `canGoBack()`（ログ出力や、
 * 保険を持たない画面）は別の話なのでここでは咎めない。
 */
const BRANCH_RE = /if\s*\(\s*router\.canGoBack\(\)\s*\)/g;
const LOOKAHEAD = 400;

/** ディレクトリを再帰して .tsx / .ts を集める */
function collect(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = path.join(dir, name);
		if (statSync(full).isDirectory()) {
			out.push(...collect(full));
		} else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
			out.push(full);
		}
	}
	return out;
}

/** 1 ファイルを検査して違反の配列を返す（テストから直接呼べるよう分けてある） */
export function findViolations(source, relPath) {
	const violations = [];
	for (const m of source.matchAll(BRANCH_RE)) {
		const after = source.slice(m.index, m.index + LOOKAHEAD);
		if (!after.includes("router.replace(")) continue;
		const line = source.slice(0, m.index).split("\n").length;
		violations.push({ file: relPath, line });
	}
	return violations;
}

const files = collect(TABS_ROOT);
const violations = files.flatMap((f) => findViolations(readFileSync(f, "utf8"), path.relative(appRoot, f)));

if (violations.length > 0) {
	console.error("❌ `(tabs)` 配下で «戻るの保険» が無効になる述語が使われています（#1404）\n");
	for (const v of violations) {
		console.error(`   ${v.file}:${v.line}`);
	}
	console.error(
		"\n   `router.canGoBack()` は (tabs) 配下だとタブ履歴まで数えるため URL 直リンク着地でも true を返し、",
	);
	console.error("   直後の `router.replace(...)`（履歴が無いときの保険）が一度も働きません。");
	console.error("   «スタックが 2 枚以上あるか» だけを見る `router.canDismiss()` を使ってください。");
	console.error("   機序: app/[locale]/(tabs)/profile/edit.tsx の #1404 コメント\n");
	process.exit(1);
}

console.log(`✅ (tabs) 配下 ${files.length} ファイル: «戻るの保険» を無効にする述語はありません`);
