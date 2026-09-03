import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import type { AutocompleteLocation, LocationDetailsResponse } from "@shared/api/v1/res";

/**
 * 📍 地点確認(confirming/confirmed/error)の状態表示テスト(#1502)
 *
 * 対応する jest: app-expo/features/search/locationConfirmation.test.tsx
 * 対応する e2e-mobile: tests/search/location-confirmation.test.ts
 *
 * ## 背景 (#1502)
 * 候補選択後は details API (v1/locations/details) の解決を待たないと検索場所(location)が
 * 確定しないが、入力欄(locationQuery)はサジェスト選択の瞬間に更新される。そのため
 * 「地名は入っているのに検索ボタンが灰色のまま」で理由が画面に一切出ない状態だった
 * (本番実査: 渋谷駅 / 2026-07-28)。PR #1524 で LocationAutocomplete に
 * confirmationStatus("confirming" | "confirmed" | "error")を追加し、状態を可視化した。
 *
 * ## 案A (オーナー採用・成功は文章で語らない)
 * - confirming: 入力欄右端に小さなスピナー(文言なし)
 * - confirmed: 入力欄右端に ✓ が一瞬(2000ms)だけ出るだけ。「地点が確定しました」等の
 *   成功文言は存在せず、#1673 以降は**入力欄の値も動かない**(選んだ候補の mainText のまま)
 * - error: 現行どおり赤の1行+再試行ボタン(エラーだけが言葉を持つ)
 *
 * ## #1673 入力欄の値は mainText から動かさない
 * #1502 は確定の合図として入力欄を autocomplete の text へ置き換えていたが、text は
 * languageCode: ja だと**日本語の住所順**で返るため主たる地名が末尾へ回っていた
 * (「日本、東京都渋谷区 渋谷駅」)。オーナー判断(2026-08-28)で置き換え自体を止めた。
 * ⚠️ モックの text も実 API と同じ住所順にすること。#1502 の検証は text を
 * `mainText, secondaryText` の逆順で作っていたため、この現象を観測できなかった。
 *
 * ## モック方針
 * 実 Google Places / details API の応答タイミングは制御できず、「確認中」を安定して
 * 描画させたり、意図的に失敗させたりできない。そのため v1/locations/autocomplete と
 * v1/locations/details の両方を `context.route()` でモックする。
 * - autocomplete: 常に固定 2 候補(成功用 / 失敗用)を返す
 * - details: placeId ごとに応答を出し分け、成功用候補は明示的なゲート(Promise)で
 *   応答を保留して「確認中」を確実に観測できるようにする
 *
 * ⚠️ CORS: バックエンドは別オリジン(Cloud Run)で `fetchWithAuth` が `credentials: "include"`
 * を使うため、fulfill するレスポンスにはリクエスト元 origin を反映した CORS ヘッダが要る
 * (e2e-web/utils/network.ts の stubEmptyDishMediaResults と同じ理由)。
 * ⚠️ 封筒: `useAPICall` は `BaseResponse` の `data` だけを取り出すので、
 * 素の配列/オブジェクトではなく `{ success, data }` で返すこと。
 */

/** 確認 → 確定まで成功する候補の place_id */
const OK_PLACE_ID = "e2e-1502-ok";
/** 1 回目は失敗し、再試行(2回目)で成功する候補の place_id */
const RETRY_PLACE_ID = "e2e-1502-retry";

const AUTOCOMPLETE_CANDIDATES: AutocompleteLocation[] = [
	{
		place_id: OK_PLACE_ID,
		text: "東京都 確認テスト地点A",
		mainText: "確認テスト地点A",
		secondaryText: "東京都",
		types: ["establishment"],
	},
	{
		place_id: RETRY_PLACE_ID,
		text: "東京都 確認テスト地点B",
		mainText: "確認テスト地点B",
		secondaryText: "東京都",
		types: ["establishment"],
	},
];

function buildDetailsResponse(placeId: string): LocationDetailsResponse {
	return {
		location: { latitude: 35.6595, longitude: 139.7005 },
		viewport: {
			low: { latitude: 35.65, longitude: 139.69 },
			high: { latitude: 35.67, longitude: 139.71 },
		},
		address: `country:JP, locality:${placeId}`,
		localLanguageCode: "ja",
	};
}

/** 外から解決タイミングを操作できる Promise (details 応答の保留に使う) */
function createGate(): { promise: Promise<void>; release: () => void } {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test.describe("地点確認(confirming/confirmed/error)の状態表示 (#1502)", () => {
	// #1629 この spec は details を **404 / 500 に固定** して «エラー表示» を見る。
	// 前提そのものが生む console error なので許容する
	test.use({ allowedConsoleErrors: ["status of 404", "status of 500"] });

	// ─ テストケース: 確認中(スピナー) → 確定(✓ だけ) → ✓ が黙って消える ─
	// 手順:
	//   1. autocomplete を固定候補にモックし、details(OK_PLACE_ID)を保留可能にモックする
	//   2. 候補を選択した直後、確認中のスピナーが出ることを検証
	//   3. details 応答を解放し、✓ が出ること・入力欄の値は mainText のままであることを検証
	//   4. 確認中/失敗の表示が同時に残っておらず、✓ も一瞬(2000ms)で消えることを検証
	test("候補選択直後は確認中の表示が出て、details 成功後は ✓ だけで確定が伝わり入力値は変わらない", async ({
		appPage,
	}) => {
		const context = appPage.context();
		const okGate = createGate();

		await context.route("**/v1/locations/autocomplete*", async (route) => {
			const origin = (await route.request().headerValue("origin")) ?? "*";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
				body: JSON.stringify({ success: true, data: AUTOCOMPLETE_CANDIDATES }),
			});
		});

		await context.route("**/v1/locations/details*", async (route) => {
			const url = new URL(route.request().url());
			const placeId = url.searchParams.get("placeId") ?? "";
			if (placeId === OK_PLACE_ID) {
				await okGate.promise;
			}
			const origin = (await route.request().headerValue("origin")) ?? "*";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
				body: JSON.stringify({ success: true, data: buildDetailsResponse(placeId) }),
			});
		});

		const searchPage = new SearchPage(appPage);
		await searchPage.typeLocation("確認テスト地点");
		await expect(searchPage.locationSuggestion(0)).toBeVisible();

		// details がまだ解決していない間は「確認中」(検索ボタンが灰色のままの理由が画面に出る)
		await searchPage.locationSuggestion(0).click();
		await expect(searchPage.locationConfirming).toBeVisible();
		await expect(searchPage.locationConfirmed).toHaveCount(0);
		await expect(searchPage.locationConfirmationError).toHaveCount(0);

		okGate.release();

		// 案A: 成功文言は無い。✓ だけが出る。#1673 入力欄は選んだ候補の mainText のまま
		await expect(searchPage.locationConfirmed).toBeVisible();
		await expect(searchPage.locationInput).toHaveValue("確認テスト地点A");
		await expect(searchPage.locationConfirming).toHaveCount(0);
		await expect(searchPage.locationConfirmationError).toHaveCount(0);

		// ✓ は一瞬(2000ms)で黙って消える(成功表示が居座らない)
		await expect(searchPage.locationConfirmed).toHaveCount(0);
	});

	// ─ テストケース: details 失敗時は再試行ボタンが出て、押すと details を再取得して確定する ─
	// 手順:
	//   1. details(RETRY_PLACE_ID)を「1回目は500失敗・2回目は保留可能な成功」にモックする
	//   2. 候補を選択し、失敗の表示 + 再試行ボタンが出ることを検証
	//   3. 再試行ボタンを押すと再び確認中になり、details へ2回目のリクエストが飛ぶことを検証
	//   4. 保留を解放すると確定の表示へ切り替わることを検証
	test("details 失敗時は再試行ボタンが出て、押すと再取得して確定する", async ({ appPage }) => {
		const context = appPage.context();
		const retryGate = createGate();
		let retryPlaceRequestCount = 0;

		await context.route("**/v1/locations/autocomplete*", async (route) => {
			const origin = (await route.request().headerValue("origin")) ?? "*";
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" },
				body: JSON.stringify({ success: true, data: AUTOCOMPLETE_CANDIDATES }),
			});
		});

		await context.route("**/v1/locations/details*", async (route) => {
			const url = new URL(route.request().url());
			const placeId = url.searchParams.get("placeId") ?? "";
			if (placeId !== RETRY_PLACE_ID) {
				await route.fulfill({ status: 404, body: "" });
				return;
			}

			retryPlaceRequestCount += 1;
			const origin = (await route.request().headerValue("origin")) ?? "*";
			const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" };

			if (retryPlaceRequestCount === 1) {
				// 1回目は必ず失敗させる(useAPICall は GET でもこの 500 系では自動リトライしない)
				await route.fulfill({
					status: 500,
					contentType: "application/json",
					headers,
					body: JSON.stringify({ success: false, message: "stubbed failure for e2e" }),
				});
				return;
			}

			// 2回目(再試行)は保留し、テスト側で解放するまで「確認中」を維持させる
			await retryGate.promise;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers,
				body: JSON.stringify({ success: true, data: buildDetailsResponse(placeId) }),
			});
		});

		const searchPage = new SearchPage(appPage);
		await searchPage.typeLocation("確認テスト地点");
		await expect(searchPage.locationSuggestion(1)).toBeVisible();

		await searchPage.locationSuggestion(1).click();
		await expect(searchPage.locationConfirmationError).toBeVisible();
		await expect(searchPage.locationConfirmationRetry).toBeVisible();
		await expect.poll(() => retryPlaceRequestCount).toBe(1);

		await searchPage.locationConfirmationRetry.click();

		// 再試行で details へ2回目のリクエストが飛び、解決するまでは「確認中」に戻っている
		await expect.poll(() => retryPlaceRequestCount).toBe(2);
		await expect(searchPage.locationConfirming).toBeVisible();
		await expect(searchPage.locationConfirmationError).toHaveCount(0);

		retryGate.release();

		// 再試行の成功も案Aどおり: ✓ だけで伝わり、入力値は mainText のまま
		await expect(searchPage.locationConfirmed).toBeVisible();
		await expect(searchPage.locationInput).toHaveValue("確認テスト地点B");
		await expect(searchPage.locationConfirming).toHaveCount(0);
		await expect(searchPage.locationConfirmationError).toHaveCount(0);
	});
});
