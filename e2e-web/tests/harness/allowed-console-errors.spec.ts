import { test, expect } from "../../fixtures/test";
import {
	CONSOLE_HARNESS_TEST_ID,
	drainConsoleErrors,
	emitConsoleError,
	emitPageError,
	openConsoleHarnessPage,
} from "../../utils/consoleHarness";

/**
 * 🙈 spec 単位の許容リスト `allowedConsoleErrors` の振る舞いを固定するテスト
 *
 * ## 何を守っているか
 * `KNOWN_CONSOLE_NOISE`（全 spec 共通）とは別に、**その spec でだけ «出て当然» のエラー**を
 * 許容する口が `fixtures/test.ts` にある。許容が広すぎれば REL-08 のゲートが骨抜きになり、
 * 狭すぎれば «直せない前提» の spec が永久に赤いままになる。どちらも静かに壊れるので、
 * ここで «一致したものだけ落ちる / それ以外は従来どおり収集される» を固定する。
 *
 * ## ⚠️ 値を «正規表現の配列» にしてはいけない
 * Playwright はフィクスチャ値が `Array.isArray(value) && typeof value[1] === "object"` を
 * 満たすと «[値, オプション]» のタプルとみなす（playwright/lib の `isFixtureTuple`）。
 * `RegExp` は object なので `[/a/, /b/]` は 2 要素目をオプションとして剥がされ、
 * 値が配列でなくなって実行時に `allowedConsoleErrors.some is not a function` で落ちる
 *（run 32718781438 で実測）。**2 要素以上の文字列配列**を使うこの spec は、
 * その形が壊れたら «型ではなく実行» で落ちるので、罠の再発もここで捕まる。
 *
 * ## 実行方法
 * アプリのビルド（app-expo/dist）に依存しないダミーページだけを使う。
 *   `pnpm --filter e2e-web test:harness`
 */
test.describe("allowedConsoleErrors @harness", () => {
	// 2 要素にしてあるのは、上の «タプル誤検出» を踏むのと同じ形（要素数 2）を保つため
	test.use({ allowedConsoleErrors: ["harness: 許容する console.error", "harness: 許容する未捕捉例外"] });

	test.beforeEach(async ({ page }) => {
		await openConsoleHarnessPage(page);
		await expect(page.getByTestId(CONSOLE_HARNESS_TEST_ID)).toBeVisible();
	});

	// ─ テストケース: 許容リストに一致する console.error は収集されない ─
	// 手順:
	//   1. 許容リストの文字列を含む console.error を発生させる
	//   2. consoleErrors が空のままであることを検証
	//   3. drain しない = teardown のゲートも発火しないことを、このテストが緑で終わること自体で示す
	test("一致する console.error は収集されない", async ({ page, consoleErrors }) => {
		await emitConsoleError(page, "harness: 許容する console.error（前後に文字があっても部分一致する）");

		expect(consoleErrors).toEqual([]);
	});

	// ─ テストケース: 許容リストに一致する pageerror も収集されない ─
	// 手順:
	//   1. 許容リストの文字列を含む未捕捉例外を発生させる
	//   2. consoleErrors が空のままであることを検証
	// 補足: console.error と pageerror の両方に効くことを固定する（片方だけ通す実装への退行検知）
	test("一致する未捕捉例外も収集されない", async ({ page, consoleErrors }) => {
		await emitPageError(page, "harness: 許容する未捕捉例外");

		expect(consoleErrors).toEqual([]);
	});

	// ─ テストケース: 一致しないエラーは従来どおり収集される ─
	// 手順:
	//   1. 許容リストに無いメッセージで console.error を発生させる
	//   2. consoleErrors に積まれていることを検証
	//   3. drain して teardown のゲート発火を回避する（このテスト自体は緑で終わらせたい）
	// 補足: 許容リストを «全部無視» に広げる実装（例: 常に true を返す）への退行はここで落ちる
	test("一致しないエラーは従来どおり収集される", async ({ page, consoleErrors }) => {
		await emitConsoleError(page, "harness: 許容していないエラー");

		expect(consoleErrors).toHaveLength(1);
		expect(consoleErrors[0]).toContain("harness: 許容していないエラー");

		drainConsoleErrors(consoleErrors);
	});
});
