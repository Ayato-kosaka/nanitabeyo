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
 * ## 案A (オーナー採用・成功は文章で語らない)
 * - confirming: 入力欄右端に小さなスピナー(文言なし)
 * - confirmed: 入力欄右端に ✓ が一瞬(2000ms)だけ出るだけ。「地点が確定しました」等の
 *   成功文言は存在せず、#1673 以降は**入力欄の値も動かない**(選んだ候補の mainText のまま)
 * - error: 現行どおり赤の1行+再試行ボタン(エラーだけが言葉を持つ)
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

	// ─ テストケース: 確認中(スピナー) → 確定(✓が一瞬) → ✓ が黙って消える ─
	// 手順:
	//   1. 「渋谷」で検索し、先頭候補が表示されるまで待つ
	//   2. 同期機構を切ってから候補をタップする(切らないと Detox が details の完了まで
	//      次の評価をブロックし、確認中の一瞬を必ず取り逃がす。review-submit-loading.test.ts と同じ理由)
	//   3. 確認中の表示(search-location-autocomplete-confirmation-confirming)をポーリングで観測する
	//   4. 確定の ✓ は 2000ms しか表示されない(案A)。details の解決タイミングは実 API 依存で
	//      読めないため、同期機構は切ったままポーリングで ✓ の一瞬を掴む
	//      (✓ の 2000ms タイマー自体は Detox が追跡しない 1.5s 超だが、可視待ちに切り替える
	//       enableSynchronization の往復の間に表示期間が終わり得る)
	//   5. ✓ が黙って消える(表示が残り続けない)ことまで確認してから同期機構を戻す
	it("候補選択直後は確認中のスピナーが出て、details 成功後に ✓ が一瞬出て消える", async () => {
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await waitUntilVisible(search.locationSuggestion(0));

		await device.disableSynchronization();
		await tapWhenVisible(search.locationSuggestion(0));

		await waitUntil(() => visibleNow(search.locationConfirming, 500), {
			interval: 100,
			description: "地点確認中のスピナー(search-location-autocomplete-confirmation-confirming)",
		});

		// 案A: 成功文言は無く、✓ が一瞬(2000ms)だけ出る
		await waitUntil(() => visibleNow(search.locationConfirmed, 500), {
			interval: 100,
			description: "地点確定の ✓ (search-location-autocomplete-confirmation-confirmed)",
		});
		assert.equal(
			await existsNow(search.locationConfirming),
			false,
			"確定後も確認中のスピナーが残っている(状態遷移が壊れている疑い)",
		);

		// ✓ は 2000ms で黙って消える(成功表示が居座らないことも案Aの仕様)
		await waitUntil(async () => !(await existsNow(search.locationConfirmed, 500)), {
			interval: 250,
			description: "地点確定の ✓ が一瞬で消えること",
		});

		await device.enableSynchronization();

		// #1673 【回帰】確定しても入力欄は候補の mainText のまま(確定の合図は ✓ だけ)。
		// #1502 は確定時に autocomplete の text へ置き換えていたが、実 API(languageCode: ja)の text は
		// 日本語の住所順で返るため「日本、東京都渋谷区 渋谷駅」となり、主たる地名が末尾へ回っていた。
		// ⚠️ この回帰は **実 API でしか出ない**(e2e-web / jest のモックは text を逆順に作っていたため
		// 最後まで観測できなかった)。実 API を叩くこの spec が唯一の観測点なのでここに置く。
		// ⚠️ 読み取りは**同期機構を戻してから**行う。値は ✓ が消えたあとも残るので急ぐ必要が無く、
		// 既に CI で通っている readLocationInputText の使い方(location-suggestion-tap.test.ts)と
		// 同じ条件に揃えるため。
		const confirmedInputText = await search.readLocationInputText();
		assert.notEqual(confirmedInputText, "", "確定後の場所入力欄が空です(選択が成立していない可能性)");
		assert.ok(
			!confirmedInputText.startsWith("日本"),
			`確定後の入力欄が国名から始まっている(autocomplete の text へ置き換わっている疑い): ${confirmedInputText}`,
		);
	});
});
