import { strict as assert } from "node:assert";

import { existsNow, launchAppWithSession, tapWhenVisible } from "../../fixtures/e2e";
import { SearchScreen } from "../../screens/SearchScreen";

/**
 * 🕐 「最近使った場所」の並び順テスト（実 API / Tier 2）
 *
 * 対象 Issue: #1129「最近使った場所を押下した時上に来て欲しい」（修正: PR #1150）
 * 対応する e2e-web: tests/search/recent-locations.spec.ts
 *
 * 背景: useRecentLocations.addRecentLocation は元から「同一地点を除去して先頭へ積む」実装だったが、
 * 「最近使った場所」パネルからの再選択（handleSelectRecentLocation）がそれを呼んでいなかったため、
 * リストから選び直しても順序が永遠に固定されたままだった
 * （app-expo/app/[locale]/(tabs)/search/index.tsx）。
 *
 * 検証する不変条件（web/mobile 共通）:
 *   1. 2件以上ある状態で2番目を選ぶと、次に開いたときそれが先頭になる（MRU）
 *   2. 件数が増えない（重複登録されない）
 *   3. 上限5件が維持される
 *
 * ## e2e-web との差分
 * 実 API の検索結果は地名も件数も事前に確定できないため、入力欄の値やリスト項目のテキストを
 * 直接アサートするのではなく（Detox の TextInput 値アサーションが不安定という location-autocomplete
 * の既知の理由に加え、TouchableOpacity は値を持たない）、`recentLocationLabel()` で
 * accessibilityLabel（= `recent.locationQuery`）を読み取り、選び直し前後で
 * **一致/変化したこと**を検証する（ResultScreen の likeLabel と同じ方式。reactions.test.ts 参照）。
 *
 * 永続化の検証は「アプリを再起動しても順序が保持されること」で行う（tutorialSeen の永続化テストと同じ方式）。
 * `launchAppWithSession` は既定 `resetState: false` なので、再起動しても AsyncStorage は消えない。
 */
describe("最近使った場所（実 API）", () => {
	const search = new SearchScreen();

	beforeAll(async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
	});

	// ─ テストケース: 2番目に選んだ地点を選び直すと先頭へ移動し、件数は変わらない ─
	// 手順:
	//   1. 「渋谷」で検索し、先頭の候補（1件目）を選ぶ
	//   2. 再度「渋谷」で検索し、別の候補（2件目、1件目とは異なる地点）を選ぶ
	//      → 最近使った場所は新しい順で [2件目, 1件目]
	//   3. パネルを開いて並び順（ラベル）と件数（2件）を確認する
	//   4. 2番目（=1件目、リストの末尾）を選び直す
	//   5. 再度パネルを開き、1件目が先頭へ移動し件数が2件のまま（重複登録なし）であることを検証
	//   6. アプリを再起動し、並び順が永続化（AsyncStorage）されていることを検証
	it("2番目に選んだ地点を選び直すと先頭へ移動し、件数は変わらない。並び順は再起動後も保持される", async () => {
		// 1件目
		await search.clearLocationIfPresent();
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(0);

		await search.openRecentLocations();
		const first = await search.recentLocationLabel(0);

		// 2件目（1件目とは異なる候補）
		await search.typeLocation("渋谷");
		await search.selectLocationSuggestion(1);

		await search.openRecentLocations();
		const second = await search.recentLocationLabel(0);
		assert.notEqual(second, first, "2件目は1件目と異なる地点であるはず");
		assert.equal(await search.recentLocationLabel(1), first, "新しい順で2番目に1件目が来ているはず");
		assert.equal(await existsNow(search.recentLocation(2)), false, "この時点では2件しかないはず");

		// リストの2番目（=1件目）を選び直す
		await tapWhenVisible(search.recentLocation(1));

		// 選び直した1件目が先頭へ。件数は2件のまま（重複登録されていない）
		await search.openRecentLocations();
		assert.equal(await search.recentLocationLabel(0), first, "選び直した地点が先頭に来ているはず");
		assert.equal(await search.recentLocationLabel(1), second, "2件目は2番目のまま残っているはず");
		assert.equal(await existsNow(search.recentLocation(2)), false, "3件目は存在しない（重複登録されていない）");

		// アプリを再起動しても並び順が保持される
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
		await search.openRecentLocations();
		assert.equal(await search.recentLocationLabel(0), first, "再起動後も先頭は選び直した地点のまま");
		assert.equal(await search.recentLocationLabel(1), second, "再起動後も2番目は変わらない");
	});

	// ─ テストケース: 6件目を登録すると最古の1件が押し出され、上限5件が維持される ─
	// 手順:
	//   1. 前のテストと画面状態を切り離すためアプリを再起動する（reactions.test.ts と同じ考え方。
	//      ストレージは消さない — 上限が既存件数に関係なく効くことの確認も兼ねる）
	//   2. 異なる6地点を順に検索・選択する（いずれも先頭候補を選ぶ）
	//   3. パネルを開き、直近5件（新しい順）だけが残り6件に増えていないことを検証
	//   4. 再起動後も5件のまま保持されることを検証
	it("6件目を登録すると最古の1件が押し出され、上限5件が維持される", async () => {
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();

		const queries = ["渋谷駅", "新宿駅", "東京駅", "池袋駅", "品川駅", "上野駅"];
		const selected: string[] = [];

		for (const query of queries) {
			await search.clearLocationIfPresent();
			await search.typeLocation(query);
			await search.selectLocationSuggestion(0);

			await search.openRecentLocations();
			selected.push(await search.recentLocationLabel(0));
		}

		// 新しい順に直近5件（6件目 → 2件目）だけが残り、最古（1件目）は落ちている
		await search.openRecentLocations();
		for (let i = 0; i < 5; i += 1) {
			assert.equal(await search.recentLocationLabel(i), selected[selected.length - 1 - i]);
		}
		assert.equal(await existsNow(search.recentLocation(5)), false, "6件目以降は存在しない（上限5件）");

		// 再起動後も5件のまま（6件に増えたり、上限が外れたりしていない）
		await launchAppWithSession({ as: "anon" });
		await search.expectLoaded();
		await search.openRecentLocations();
		assert.equal(await existsNow(search.recentLocation(4)), true, "再起動後も5件目までは残っているはず");
		assert.equal(await existsNow(search.recentLocation(5)), false, "再起動後も上限5件が維持される");
	});
});
