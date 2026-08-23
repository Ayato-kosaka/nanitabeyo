import { strict as assert } from "node:assert";

import {
	device,
	existsNow,
	launchAppWithSession,
	tapWhenVisible,
	visibleNow,
	waitUntil,
	waitUntilVisible,
} from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 📍 地点確認(confirming/confirmed)の状態表示テスト(実 API / #1502)
 *
 * 対応する e2e-web: tests/search/location-confirmation.spec.ts
 * 対応する jest: app-expo/features/search/locationConfirmation.test.tsx
 *
 * ## 背景 (#1502)
 * 候補選択後は details API (v1/locations/details) の解決を待たないと検索場所(location)が
 * 確定しないが、入力欄(locationQuery)はサジェスト選択の瞬間に更新される。そのため
 * 「地名は入っているのに検索ボタンが灰色のまま」で理由が画面に一切出ない状態だった
 * (本番実査: 渋谷駅 / 2026-07-28)。PR #1524 で LocationAutocomplete に
 * confirmationStatus("confirming" | "confirmed" | "error")を追加し、状態を可視化した。
 *
 * ## ⚠️ web 側とのカバレッジ差(意図的)
 * e2e-web は `page.route()` で v1/locations/details を遅延・失敗させ、confirming/confirmed に加えて
 * error(失敗)→再試行→confirmed までの3状態を検証している。
 * **Detox には `page.route()` に相当する仕組みが無い。** app-expo 側の E2E フックも `lib/e2e/` にある
 * 4 つ(セッション注入・チュートリアル既読・メディア選択差し替え・先読みプローブ)だけで、
 * ネットワークを差し替える/失敗させるものは存在しない(tests/mutation/review-submit-loading.test.ts の
 * ヘッダコメントで既に確定している判断と同じ)。`device.setURLBlacklist` は Detox の同期機構(idling
 * resource)からその URL を除外するだけで、**実際にリクエストを失敗させるものではない**ため使えない。
 * そのため mobile 側は実 API で再現できる **confirming → confirmed** の2状態だけを見る。
 * error/失敗時の再試行は web 側だけで担保する(SearchScreen.locationConfirmationError /
 * locationConfirmationRetry は testID 自体をここに用意してあるが、モック手段が入るまで spec からは未使用)。
 */
describe("地点確認(confirming/confirmed)の状態表示(実 API)", () => {
	const search = new SearchScreen();

	beforeEach(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// 同期機構を切ったまま次のテストへ持ち越さない(review-submit-loading.test.ts と同じ理由)
	afterEach(async () => {
		await device.enableSynchronization();
	});

	// ─ テストケース: 確認中 → 確定 の順に表示され、確定後は確認中の表示が残らない ─
	// 手順:
	//   1. 「渋谷」で検索し、先頭候補が表示されるまで待つ
	//   2. 同期機構を切ってから候補をタップする(切らないと Detox が details の完了まで
	//      次の評価をブロックし、確認中の一瞬を必ず取り逃がす。review-submit-loading.test.ts と同じ理由)
	//   3. 確認中の表示(search-location-autocomplete-confirmation-confirming)をポーリングで観測する
	//   4. 同期機構を戻し、details 完了を待って確定の表示に切り替わることを検証する
	//   5. 確定後は確認中の表示が残っていないことを検証する
	it("候補選択直後は確認中の表示が出て、details 成功後に確定の表示へ切り替わる", async () => {
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await waitUntilVisible(search.locationSuggestion(0));

		await device.disableSynchronization();
		await tapWhenVisible(search.locationSuggestion(0));

		await waitUntil(() => visibleNow(search.locationConfirming, 500), {
			interval: 100,
			description: "地点確認中の表示(search-location-autocomplete-confirmation-confirming)",
		});

		// 確定は details の完了を要するので、同期機構を戻して通常の可視待ちに任せる
		await device.enableSynchronization();
		await waitUntilVisible(search.locationConfirmed);
		assert.equal(
			await existsNow(search.locationConfirming),
			false,
			"確定後も確認中の表示が残っている(状態遷移が壊れている疑い)",
		);
	});
});
