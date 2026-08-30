import { test, expect } from "../../fixtures/test";
import {
	CONSOLE_HARNESS_TEST_ID,
	drainConsoleErrors,
	emitConsoleError,
	emitConsoleMessage,
	emitPageError,
	openConsoleHarnessPage,
} from "../../utils/consoleHarness";

/**
 * 🚨 console error ゲート（REL-08 / #1500）の振る舞いを固定するテスト
 *
 * ## 何を守っているか
 * `fixtures/test.ts` の auto フィクスチャ `consoleErrors` は、
 * **spec が何もアサートしなくても** console error / pageerror があればテストを失敗させる。
 * これは全 spec の既定の失敗条件なので、壊れても個々の spec は緑のままになり、
 * 「実は誰も見ていなかった」状態に静かに戻ってしまう。ハーネス自身を対象にした
 * このファイルが、その退行を検知する唯一の手段になる。
 *
 * ## 対になるファイル
 * 「実際にテストが落ちること」自体は、ここでは検証できない（落ちたら赤くなるため）。
 * `console-error-gate-failure.spec.ts` が `test.fail()` を使って担当している。
 *
 * ## 実行方法
 * アプリのビルド（app-expo/dist）に依存しないダミーページだけを使うため、
 * 専用プロジェクト `harness` で単独実行できる。
 *   `pnpm --filter e2e-web test:harness`
 */
test.describe("console error ゲート @harness", () => {
	test.beforeEach(async ({ page }) => {
		await openConsoleHarnessPage(page);
		await expect(page.getByTestId(CONSOLE_HARNESS_TEST_ID)).toBeVisible();
	});

	// ─ テストケース: 未知の console.error は収集される ─
	// 手順:
	//   1. ダミーページで console.error を発生させ、配送完了まで待つ
	//   2. consoleErrors にそのメッセージが積まれていることを検証
	//   3. drain して teardown のゲート発火を回避する（このテスト自体は緑で終わらせたい）
	test("未知の console.error は収集される", async ({ page, consoleErrors }) => {
		await emitConsoleError(page, "harness: 未知のエラー");

		expect(consoleErrors).toHaveLength(1);
		expect(consoleErrors[0]).toContain("harness: 未知のエラー");

		expect(drainConsoleErrors(consoleErrors)).toHaveLength(1);
	});

	// ─ テストケース: 未捕捉例外 (pageerror) も収集される ─
	// 手順:
	//   1. ダミーページで setTimeout 越しに throw し、pageerror の配送完了まで待つ
	//   2. `[pageerror]` 接頭辞つきで収集されていることを検証
	//   3. drain してゲート発火を回避する
	test("未捕捉例外 (pageerror) も収集される", async ({ page, consoleErrors }) => {
		await emitPageError(page, "harness: 未捕捉例外");

		expect(consoleErrors).toHaveLength(1);
		expect(consoleErrors[0]).toMatch(/^\[pageerror\] .*harness: 未捕捉例外/);

		drainConsoleErrors(consoleErrors);
	});

	// ─ テストケース: KNOWN_CONSOLE_NOISE に一致する既知ノイズは収集されない ─
	// 手順:
	//   1. 許容リストの 2 パターン（Supabase access_token 欠落 / GeolocationPositionError）を
	//      それぞれ console.error として発生させる
	//   2. consoleErrors が空のままであることを検証
	//   3. drain しない = teardown のゲートも発火しないことを、このテストが緑で終わること自体で示す
	//
	// ⚠️ 文言はフィクスチャの正規表現に合わせている。許容リストを編集したらここも合わせること。
	test("既知ノイズ (KNOWN_CONSOLE_NOISE) は収集されずゲートも発火しない", async ({ page, consoleErrors }) => {
		await emitConsoleError(page, "Failed to log event view_screen: Supabase access_token is missing");
		await emitConsoleError(page, "GeolocationPositionError: User denied Geolocation");

		expect(consoleErrors).toEqual([]);
	});

	// ─ テストケース: error 以外の console 出力は収集されない ─
	// 手順:
	//   1. console.warn と console.log を発生させ、それぞれ配送完了まで待つ
	//   2. consoleErrors が空のままであることを検証（ゲートは error / pageerror だけを見る）
	test("console.warn / console.log は収集されない", async ({ page, consoleErrors }) => {
		await emitConsoleMessage(page, "warning", "harness: 警告");
		await emitConsoleMessage(page, "log", "harness: ログ");

		expect(consoleErrors).toEqual([]);
	});

	// ─ テストケース: 何も起きなければ空のまま ─
	// 手順:
	//   1. ダミーページを開いただけの状態で consoleErrors が空であることを検証
	//   （ゲートが「常に何かを拾って全テストを落とす」壊れ方をしていないことの確認）
	test("何も起きなければ consoleErrors は空", async ({ consoleErrors }) => {
		expect(consoleErrors).toEqual([]);
	});
});
