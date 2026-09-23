import fs from "node:fs";
import path from "node:path";

/**
 * #1961 【設計】**「履歴が無い着地」のフォールバックを持つ画面は、システムの戻るも繋ぐ。**
 *
 * 個別の画面ではなく «形» を縛る。`router.canDismiss()` のフォールバックを書いた画面は、
 * ヘッダーのボタンだけでなく Android のシステムの戻るからもそこへ倒れなければならない。
 * 繋がっていないと、共有リンクで着地した人が戻るを押した瞬間にアプリが終了する
 * （2026-09-10 実測: 失敗コマが Android のランチャーだった）。
 *
 * 新しい画面が同じフォールバックを書いたとき、**このテストが繋ぎ忘れを落とす**。
 */

const APP_DIR = path.join(__dirname, "..", "app");

/** 繋がっているとみなす呼び出し。共通フックか、画面内で直接 BackHandler を登録しているか */
const WIRED = [/useAndroidHardwareBack\s*\(/, /BackHandler\.addEventListener\s*\(/];

/**
 * `canDismiss()` を持つが、**戻る導線ではない**ので対象外のもの。
 * 外すときは «なぜ対象外か» を必ず書くこと（書かないと次に読む人が同じ調査をやり直す）。
 */
const NOT_A_BACK_HANDLER: Record<string, string> = {
	"[locale]/onboarding/welcome.tsx":
		"canDismiss() は handleStart（「はじめる」を押して先へ進む処理）の中にあり、" +
		"戻る導線ではない。この画面に戻るボタン自体が無い",
};

function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full, acc);
		else if (/\.tsx?$/.test(entry.name)) acc.push(full);
	}
	return acc;
}

describe("#1961 システムの戻る（Android）の繋ぎ忘れ", () => {
	const files = walk(APP_DIR)
		.filter((f) => fs.readFileSync(f, "utf8").includes("router.canDismiss()"))
		.map((f) => path.relative(APP_DIR, f).split(path.sep).join("/"));

	it("canDismiss() のフォールバックを持つ画面が 1 つ以上見つかる（探し方が壊れていないこと）", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)("%s がシステムの戻るを扱っている", (relative) => {
		if (NOT_A_BACK_HANDLER[relative]) return;
		const source = fs.readFileSync(path.join(APP_DIR, relative), "utf8");
		expect(WIRED.some((re) => re.test(source))).toBe(true);
	});

	it("対象外リストに、もう存在しない画面が残っていない", () => {
		for (const relative of Object.keys(NOT_A_BACK_HANDLER)) {
			expect(files).toContain(relative);
		}
	});
});
