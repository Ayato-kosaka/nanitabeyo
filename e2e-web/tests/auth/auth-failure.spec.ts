import { test, expect } from "../../fixtures/test";

/**
 * 🔐 認証失敗時のフォールバック
 *
 * ## 背景 (#1089)
 * `AuthProvider` は起動時にセッションが無ければ匿名サインインを行うが、これが失敗すると
 * `setUser` が一度も呼ばれず `user = null` が固定され、`SplashHandler` が何も描画しない
 * （web は CenteredAppShell の薄グレー #F3F4F6 の空画面、native はスプラッシュ固着）状態が
 * **恒久的に**続いていた。復帰経路が無く、リロードするまで戻らない。
 *
 * Supabase の匿名サインインは 30 回/時/IP のレート制限があるため、共有 IP（企業 NAT・
 * CGNAT・公衆 Wi-Fi）配下の実ユーザーでも 429 を踏みうる。E2E 特有の問題ではない。
 *
 * ## このテストの検証内容
 * `POST /auth/v1/signup` を 429 に固定したうえで、アプリが「空画面のまま黙る」のではなく
 * エラー UI と再試行手段を提示することを検証する。
 *
 * ## レート制限枠は消費しない
 * `page.route()` でブラウザ側から Supabase へ出る前に応答を差し替えるため、実際の
 * 匿名サインインは 1 回も発生しない（30 回/時/IP の枠を 1 も減らさない）。
 *
 * 匿名サインインが自動確立される正常系は tests/smoke/boot.spec.ts が担保する。
 */

// 共有の匿名 storageState を使うと「復元できるセッションがある」状態になり匿名サインインが走らないため、
// boot.spec.ts と同様に意図的にフレッシュな状態へ戻す
test.use({
	storageState: { cookies: [], origins: [] },
	/*
	#1629 この spec は **自分で 429 を返させている**。ブラウザはそれを
	`Failed to load resource: ... 429 (Too Many Requests)` として console へ出すので、
	REL-08 の «console error があれば落とす» に必ず引っかかる。
	«その spec の前提そのものがエラーを生む» 場合の許容なので、`KNOWN_CONSOLE_NOISE`
	（全 spec に効く）ではなくこちらへ書く（fixtures/test.ts の使い分けのとおり）。
	*/
	allowedConsoleErrors: ["429 (Too Many Requests)"],
});

test.describe("匿名サインイン失敗時", () => {
	// ─ テストケース: 匿名サインインが 429 でもエラー UI と再試行ボタンが出る ─
	// 手順:
	//   1. Supabase の匿名サインイン(POST /auth/v1/signup)を 429 (Retry-After 付き)で固定する
	//   2. "/" へ遷移する
	//   3. 空画面のままではなく、認証エラーのフォールバック UI が表示されることを検証
	//   4. 再試行ボタンが表示されていることを検証（ユーザーが自力で復帰を試せること）
	test("429 のときは空画面ではなくエラー UI と再試行ボタンが表示される", async ({ page }) => {
		await page.route("**/auth/v1/signup*", async (route) => {
			await route.fulfill({
				status: 429,
				contentType: "application/json",
				headers: { "retry-after": "60" },
				body: JSON.stringify({
					code: 429,
					error_code: "over_request_rate_limit",
					msg: "Anonymous sign-ins are rate limited",
				}),
			});
		});

		await page.goto("/");
		await page.waitForURL(/\/ja(-JP)?(\/|$)/);

		// 修正前はこの testID が永遠に現れず（画面は空のまま）、ここで失敗する
		await expect(page.getByTestId("auth-error-fallback")).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId("auth-error-retry")).toBeVisible();
	});
});
