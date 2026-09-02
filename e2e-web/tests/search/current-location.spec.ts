import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 📍 現在地取得(useLocationSearch.getCurrentLocation)の信頼性テスト
 *
 * 背景(#932): web は expo-location の web 実装が navigator.permissions.query に依存し
 * 環境によって未捕捉例外を投げていた上、権限拒否時は warn ログのみで処理継続し、
 * 明示的な「現在地を使う」ボタン押下時にもユーザーへは何もフィードバックされていなかった。
 * hooks/useCurrentLocationPosition.web.ts へ navigator.geolocation 直叩きの実装を切り出し、
 * 失敗理由を denied/timeout/unsupported/unavailable に分類してから文言を出し分けるよう修正した。
 *
 * このファイルは実際の位置情報取得を伴う(タイムアウト等が実時間で発生しうる)ため @smoke 対象外とする。
 */
test.describe("現在地取得", () => {
	// ─ テストケース: 権限が許可されている場合、現在地が入力欄にセットされる ─
	// Playwright の permissions API モック(context.permissions + geolocation)で「許可」を再現する
	test.describe("権限が許可されている場合", () => {
		test.use({
			permissions: ["geolocation"],
			geolocation: { latitude: 35.681236, longitude: 139.767125 }, // 東京駅
		});

		test("現在地を使うボタンで入力欄が現在地表示になる", async ({ appPage }) => {
			const searchPage = new SearchPage(appPage);
			if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
				await searchPage.locationClearButton.click();
			}

			await appPage.getByTestId("search-current-location-button").click();

			await expect(searchPage.locationInput).toHaveValue("現在地");
		});
	});

	// ─ テストケース: 権限が拒否されている場合、専用文言のSnackbarが出て手入力欄にフォーカスが移る ─
	// Playwright はデフォルトで geolocation 権限を許可しないため、明示的な grant なし = 拒否状態を再現する
	test.describe("権限が拒否されている場合", () => {
		test("拒否専用の文言が表示され、地点入力欄にフォーカスが移る", async ({ appPage }) => {
			const searchPage = new SearchPage(appPage);
			if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
				await searchPage.locationClearButton.click();
			}

			await appPage.getByTestId("search-current-location-button").click();

			await expect(appPage.getByText("位置情報の利用が許可されていません。地名を直接入力してください。")).toBeVisible();
			await expect(searchPage.locationInput).toBeFocused();
		});
	});

	// ─ テストケース: ブラウザが geolocation 未対応の場合、専用文言が表示される ─
	// 実ブラウザは全て対応しているため navigator.geolocation を undefined に上書きして再現する
	test("geolocation 未対応環境では専用の文言が表示される", async ({ appPage }) => {
		await appPage.evaluate(() => {
			Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
		});

		const searchPage = new SearchPage(appPage);
		if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
			await searchPage.locationClearButton.click();
		}

		await appPage.getByTestId("search-current-location-button").click();

		await expect(
			appPage.getByText("この環境では現在地の取得に対応していません。地名を直接入力してください。"),
		).toBeVisible();
	});

	// ─ テストケース: 取得がタイムアウトした場合、専用文言が表示される ─
	// 実タイムアウト(10秒)を待つと遅いため、geolocation.getCurrentPosition を
	// 即座に TIMEOUT エラーを返すモックへ差し替えて再現する
	test("現在地取得がタイムアウトすると専用の文言が表示される", async ({ appPage }) => {
		await appPage.evaluate(() => {
			const fakeGeolocation: Pick<Geolocation, "getCurrentPosition"> = {
				getCurrentPosition: (_success, error) => {
					error?.({
						code: 3,
						TIMEOUT: 3,
						PERMISSION_DENIED: 1,
						POSITION_UNAVAILABLE: 2,
						message: "Timeout",
					} as GeolocationPositionError);
				},
			};
			Object.defineProperty(navigator, "geolocation", { value: fakeGeolocation, configurable: true });
		});

		const searchPage = new SearchPage(appPage);
		if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
			await searchPage.locationClearButton.click();
		}

		await appPage.getByTestId("search-current-location-button").click();

		await expect(
			appPage.getByText("現在地の取得がタイムアウトしました。もう一度お試しいただくか、直接入力してください。"),
		).toBeVisible();
	});
});
