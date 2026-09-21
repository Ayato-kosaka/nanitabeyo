import * as fs from "node:fs";
import * as path from "node:path";

/**
 * #1962 浮かせたボタンの `top` に «プラットフォーム固定値» を使わないことのゲート。
 *
 * ## 何が起きたか
 * ヘッダーを持たない 4 画面は、浮かせた × の位置を
 * `top: Platform.OS === "ios" ? 40 : 0` という固定値で決めていた。
 * Expo SDK 54 の Android は edge-to-edge が強制なので `top: 0` は **ステータスバーの下**を意味する。
 * `padding: 12` のボタン（48dp）は中心が y=24dp ＝ ステータスバーの内側に入り、
 * **見えてはいるがタップはシステム側に吸われる**。実機ログで閉じるイベントが 0 件だった（#1962）。
 *
 * ## なぜ «パターン» で守るのか
 * 同じ固定値が 4 画面にあり、そのうち実端末で × を押していたのは 1 画面だけだった。
 * 1 箇所を直しても、次に同じ書き方をした画面でまた再発する。
 * 「安全領域をプラットフォーム固定値で代用しない」という**形**をここで固定する
 *（CLAUDE.md「直したら、同じ形をしたものを全部探して一括で直す」）。
 *
 * 実際に押せることは実端末で見る:
 * - `e2e-mobile/tests/my-dishes/feed-close.test.ts`
 * - `e2e-mobile/tests/my-dishes/restaurant-routes.test.ts`
 */
const APP_DIR = path.resolve(__dirname, "../app");

/** `top:` / `paddingTop:` に Platform の三項演算子で数値を充てている書き方 */
const FORBIDDEN = /(top|paddingTop)\s*:\s*Platform\.OS\s*===?\s*["'](ios|android)["']\s*\?/;

function collectTsx(dir: string, found: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) collectTsx(full, found);
		else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) found.push(full);
	}
	return found;
}

describe("#1962 安全領域をプラットフォーム固定値で代用しない", () => {
	it("画面ファイルの top / paddingTop に Platform の固定値分岐が無い（useSafeAreaInsets を使う）", () => {
		const offenders: string[] = [];
		for (const file of collectTsx(APP_DIR)) {
			const lines = fs.readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (FORBIDDEN.test(line)) {
					offenders.push(`${path.relative(APP_DIR, file)}:${index + 1}  ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
