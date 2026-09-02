import { test } from "../../fixtures/test";
import { emitConsoleError, emitPageError, openConsoleHarnessPage } from "../../utils/consoleHarness";

/**
 * 💥 console error ゲート（REL-08 / #1500）が「本当にテストを失敗させる」ことの固定
 *
 * ## なぜ別ファイルなのか
 * ゲートの本体は auto フィクスチャの teardown にある。つまり
 * **テスト本体が全部緑でも、あとから赤に変えられる**のが正しい振る舞いで、
 * これは通常のアサーションでは書けない（書いた瞬間そのテストが赤になる）。
 * ここでは `test.fail()` を使い、「このテストは失敗するのが正解」と宣言する。
 * ゲートが壊れて失敗しなくなると Playwright が
 * "Expected to fail, but passed." で赤くするので、退行がそのまま検知できる。
 *
 * ## 各テストは自前のアサーションを 1 つも持たない
 * spec 側が明示的に `expect(consoleErrors).toEqual([])` を書かなくても落ちる、
 * というのが REL-08 の主張そのものなので、**意図的に何もアサートしない**。
 * 失敗の原因はフィクスチャの teardown だけである。
 *
 * ## 生の失敗出力を見たいとき
 * `HARNESS_GATE_RAW=1` を付けると `test.fail()` を無効化し、ゲートが出す
 * 実際のエラーメッセージごと赤くなる（= 意図的に失敗する実行）。
 * エビデンス撮影や、失敗時メッセージの文言を確認したいときに使う。
 *   `HARNESS_GATE_RAW=1 pnpm --filter e2e-web test:harness`
 */
const RAW_MODE = !!process.env.HARNESS_GATE_RAW;

test.describe("console error ゲートによる失敗 @harness", () => {
	// ─ テストケース: console.error があれば spec 側が何もしなくても失敗する ─
	// 手順:
	//   1. ダミーページで console.error を発生させる
	//   2. 何もアサートせずテストを終える
	//   3. teardown のゲートが発火してテストが失敗する（= test.fail() が期待する結果）
	test("console.error を出すと、アサート無しでもテストが失敗する", async ({ page }) => {
		test.fail(!RAW_MODE, "REL-08: console error ゲートが teardown で失敗させることを固定する");

		await openConsoleHarnessPage(page);
		await emitConsoleError(page, "harness: ゲートを発火させる console.error");
	});

	// ─ テストケース: pageerror があれば spec 側が何もしなくても失敗する ─
	// 手順:
	//   1. ダミーページで未捕捉例外を発生させる
	//   2. 何もアサートせずテストを終える
	//   3. teardown のゲートが発火してテストが失敗する
	test("未捕捉例外を出すと、アサート無しでもテストが失敗する", async ({ page }) => {
		test.fail(!RAW_MODE, "REL-08: pageerror も同じくゲートの対象であることを固定する");

		await openConsoleHarnessPage(page);
		await emitPageError(page, "harness: ゲートを発火させる未捕捉例外");
	});

	// ─ テストケース: 既知ノイズだけならゲートは発火しない（除外リストの対照実験） ─
	// 手順:
	//   1. 上の 2 件と同じ流れで、ただし KNOWN_CONSOLE_NOISE に一致するメッセージだけを出す
	//   2. 何もアサートせずテストを終える
	//   3. ゲートは発火せず緑で終わる（= `test.fail()` を付けていないのはこのテストだけ）
	//
	// 上の 2 件と並べて実行することで、「ダミーページを開いて console.error を出す」という
	// 同じ手順でも、除外リストに載っているかどうかだけで結果が変わることを示す。
	test("既知ノイズだけならゲートは発火せず成功する", async ({ page }) => {
		await openConsoleHarnessPage(page);
		await emitConsoleError(page, "Failed to log event view_screen: Supabase access_token is missing");
		await emitConsoleError(page, "GeolocationPositionError: User denied Geolocation");

		// アサートは書かない。teardown のゲートを通り抜けて緑で終わること自体が主張。
	});
});
