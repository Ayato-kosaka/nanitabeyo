import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";

/**
 * 🕐 「最近使った場所」の並び順テスト(実 API)
 *
 * 対象 Issue: #1129「最近使った場所を押下した時上に来て欲しい」(修正: PR #1150)
 * 対応する e2e-mobile: tests/search/recent-locations.test.ts
 *
 * 背景: useRecentLocations.addRecentLocation は元から「同一地点を除去して先頭へ積む」実装だったが、
 * 「最近使った場所」パネルからの再選択(handleSelectRecentLocation)がそれを呼んでいなかったため、
 * リストから選び直しても順序が永遠に固定されたままだった
 * (app-expo/app/[locale]/(tabs)/search/index.tsx)。
 *
 * 検証する不変条件(web/mobile 共通):
 *   1. 2件以上ある状態で2番目を選ぶと、次に開いたときそれが先頭になる(MRU)
 *   2. 件数が増えない(重複登録されない)
 *   3. 上限5件が維持される
 *
 * 前提: 実 API(v1/locations/autocomplete, v1/locations/details)を叩く。CORS 前提は
 * location-autocomplete.spec.ts と同じ(e2e-web/README.md 参照)。
 */
test.describe("最近使った場所", () => {
	/*
	#1629【オーナー確定】**Places の日次上限は上げない。** この spec は «場所検索の結果を使って
	画面が進むこと» を見るもので、Places の応答そのものが主題ではないので固定値へ差し替える
	（`utils/locationSearch.ts`）。実物を叩く検証は `tests/search/location-autocomplete.spec.ts`
	の 1 本だけに残してある。
	*/
	test.use({ mockLocationSearch: true });

	// ─ テストケース: 2番目に選んだ地点を選び直すと先頭へ移動し、件数は変わらない ─
	// 手順:
	//   1. 「渋谷」で検索し、先頭の候補(1件目)を選ぶ
	//   2. 再度「渋谷」で検索し、別の候補(2件目、1件目とは異なる地点)を選ぶ
	//      → 最近使った場所は新しい順で [2件目, 1件目]
	//   3. パネルを開いて並び順と件数(2件)を確認する
	//   4. 2番目(=1件目、リストの末尾)を選び直す
	//   5. 再度パネルを開き、1件目が先頭へ移動し件数が2件のまま(重複登録なし)であることを検証
	//   6. 検索画面へ明示的に goto(「reload ではなく goto」の理由は onboarding.spec.ts と同じ:
	//      expo-router の静的書き出しでは page.reload() だとブラウザの URL バーとズレた別ルートの
	//      静的 HTML が読み込まれることがあるため)し、並び順が永続化(AsyncStorage)されていることを検証
	test("2番目に選んだ地点を選び直すと先頭へ移動し、件数は変わらない。並び順はリロード後も保持される", async ({
		appPage,
	}) => {
		const searchPage = new SearchPage(appPage);

		// 1件目
		if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
			await searchPage.locationClearButton.click();
		}
		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		const first = await searchPage.locationInput.inputValue();

		// 2件目(1件目とは異なる候補)
		await searchPage.locationClearButton.click();
		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(1);
		const second = await searchPage.locationInput.inputValue();
		expect(second).not.toBe(first);

		// 新しい順: [2件目, 1件目]
		await searchPage.openRecentLocations();
		await expect(searchPage.recentLocation(0)).toHaveText(second);
		await expect(searchPage.recentLocation(1)).toHaveText(first);
		await expect(searchPage.recentLocation(2)).toHaveCount(0);

		// リストの2番目(=1件目)を選び直す
		await searchPage.recentLocation(1).click();
		await expect(searchPage.locationInput).toHaveValue(first);

		// 選び直した1件目が先頭へ。件数は2件のまま(重複登録されていない)
		await searchPage.openRecentLocations();
		await expect(searchPage.recentLocation(0)).toHaveText(first);
		await expect(searchPage.recentLocation(1)).toHaveText(second);
		await expect(searchPage.recentLocation(2)).toHaveCount(0);

		// リロードしても並び順が保持される
		await appPage.goto("/ja-JP/search");
		await searchPage.expectLoaded();
		await searchPage.openRecentLocations();
		await expect(searchPage.recentLocation(0)).toHaveText(first);
		await expect(searchPage.recentLocation(1)).toHaveText(second);
	});

	// ─ テストケース: 6件目を登録すると最古の1件が押し出され、上限5件が維持される ─
	// 手順:
	//   1. 異なる6地点を順に検索・選択する(いずれも先頭候補を選ぶ)
	//   2. パネルを開き、直近5件(新しい順)だけが残り6件に増えていないことを検証
	//   3. リロード後も5件のまま保持されることを検証
	test("6件目を登録すると最古の1件が押し出され、上限5件が維持される", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const queries = ["渋谷駅", "新宿駅", "東京駅", "池袋駅", "品川駅", "上野駅"];
		const selected: string[] = [];

		for (const query of queries) {
			if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
				await searchPage.locationClearButton.click();
			}
			await searchPage.typeLocation(query);
			await searchPage.selectLocationSuggestion(0);
			selected.push(await searchPage.locationInput.inputValue());
		}

		// 新しい順に直近5件(6件目 → 2件目)だけが残り、最古(1件目)は落ちている
		await searchPage.openRecentLocations();
		for (let i = 0; i < 5; i += 1) {
			await expect(searchPage.recentLocation(i)).toHaveText(selected[selected.length - 1 - i]);
		}
		await expect(searchPage.recentLocation(5)).toHaveCount(0);

		// リロード後も5件のまま(6件に増えたり、上限が外れたりしていない)
		await appPage.goto("/ja-JP/search");
		await searchPage.expectLoaded();
		await searchPage.openRecentLocations();
		await expect(searchPage.recentLocation(4)).toBeVisible();
		await expect(searchPage.recentLocation(5)).toHaveCount(0);
	});
});
