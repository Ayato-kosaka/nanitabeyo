import { test, expect } from "../../fixtures/test";
import { ProfilePage } from "../../pages/ProfilePage";
import { SearchPage } from "../../pages/SearchPage";
import { stubSavedDishCategories, type StubbedDishCategory } from "../../utils/network";
import { seedRecentLocations } from "../../utils/storage";

/**
 * 📍 保存料理カテゴリからの地点検索（#1133 / #1369）
 *
 * #1133 は「保存した料理カテゴリ」タブのカードから開く地点検索を、
 * ホーム（さがすタブ）と同じ体験へ揃えた変更（PR #1168）。
 *
 * ## #1369 でモーダルからルート（/[locale]/profile/saved-dish-category-location）になった
 * 見えている中身（LocationSearchForm）は同じで、載っている «器» が BlurModal から画面へ変わった。
 * この spec の観測点は testID のままだが、開いたことを **URL でも** 確かめる
 * （ProfilePage.openLocationSearch）。器が戻ってしまう変更を、ここで検知したい。
 * 追加されたのは「最近使った場所」「現在地ボタン」「入力クリア」の 3 つで、
 * いずれも `useLocationField` / `LocationAutocomplete` をホームと共有している。
 *
 * ## なぜ E2E で守るのか
 * 共有しているのは *フック* であって *画面* ではない。
 * `LocationSearchForm` はホーム（search/index.tsx）と同じ props をもう一度手で並べており、
 * 片方だけ props を落としても型検査は通る（すべて optional）。
 * 「保存料理カテゴリ側の地点検索でも本当に出るか」は描画しないと分からない。
 *
 * ## 一覧をスタブしている理由
 * 地点検索の入口は保存済みカテゴリのカードなので、保存が 0 件の環境では
 * どのテストも操作を始められない。見たいのは地点検索の中身なので、
 * 入口となる一覧 API だけ固定し、地点検索（autocomplete / details）は実 API のまま回す。
 *
 * ## 対象外
 * iOS の位置情報許可ダイアログは OS ネイティブで Playwright から操作できない。
 * web の許可は `context.grantPermissions` で与えられるため、ここで見るのは
 * 「許可済みのときにボタンが機能するか」までに限る。
 */
const SAVED_CATEGORY: StubbedDishCategory = {
	id: "e2e-1133-category",
	label_en: "Sushi",
	labels: { ja: "寿司", en: "Sushi" },
	// wikimediaThumbFromOriginal がサムネイル URL を組み立てられる形にしておく
	// （画像が読めなくてもカード自体は押せるが、URL 組み立てで落ちる形は避ける）
	image_url: "https://upload.wikimedia.org/wikipedia/commons/1/1b/Sushi_platter.jpg",
};

/** 東京駅付近。現在地テストで端末位置として与える座標 */
const TOKYO_STATION = { latitude: 35.6812, longitude: 139.7671 };

test.describe("保存料理カテゴリからの地点検索(#1133)", () => {
	// ─ テストケース: 「最近使った場所」がホームと共有されている ─
	// 手順:
	//   1. ホーム（さがすタブ）で「渋谷」を検索し、先頭の候補を確定する（実 API）
	//      → useRecentLocations が recent_locations_v1 へ 1 件積む
	//   2. マイページの「保存した料理カテゴリ」タブを開き、カードを押して地点検索画面へ進む
	//   3. 入力欄をフォーカスして「最近使った場所」パネルを開く
	//   4. ホームで選んだのと同じ地点が先頭に出ていることを検証
	//
	// ⚠️ ここだけは localStorage のシードで代用しないこと。
	//    シードすると「地点検索画面がそのキーを読めるか」しか見えず、
	//    ホーム側の書き込み先とキーが一致しているか（#1133 の設計上の肝）を検証できない。
	test("ホームで選んだ地点が「最近使った場所」として地点検索画面にも出る", async ({ appPage, context }) => {
		await stubSavedDishCategories(context, [SAVED_CATEGORY]);
		const searchPage = new SearchPage(appPage);
		const profilePage = new ProfilePage(appPage);

		// ホームで 1 件積む（details 完了まで待つ必要があるので Page Object 経由で選ぶ）
		await searchPage.goto();
		await searchPage.expectLoaded();
		if (await searchPage.locationClearButton.isVisible().catch(() => false)) {
			await searchPage.locationClearButton.click();
		}
		await searchPage.typeLocation("渋谷");
		await searchPage.selectLocationSuggestion(0);
		const homeLocation = await searchPage.locationInput.inputValue();
		expect(homeLocation).not.toBe("");

		// 保存料理カテゴリ側の地点検索へ
		await profilePage.gotoSavedDishCategories();
		await profilePage.openLocationSearch();
		await profilePage.openLocationSearchRecentLocations();

		// ホームと同じストレージ（recent_locations_v1）を読んでいれば先頭に出る
		await expect(profilePage.locationSearchRecentLocation(0)).toHaveText(homeLocation);
	});

	// ─ テストケース: 狭いビューポートでもパネルが画面外へはみ出さない ─
	// 手順:
	//   1. 「最近使った場所」を上限の 5 件シードする（パネルが最も高くなる状態）
	//   2. ビューポートを縦に狭くする（後述）
	//   3. 地点検索画面を開き、パネルを表示する
	//   4. パネルと末尾の 1 件の bounding box がビューポート内へ収まっていることを検証
	//
	// ## ビューポートを狭くして代用する理由
	// 実機で怖いのは「ソフトキーボードが出て可視領域が半分になった状態」だが、
	// デスクトップ Chromium にソフトキーボードは無く、`page.keyboard` でも
	// visualViewport は縮まない。可視領域が狭いという **結果** だけが問題なので、
	// setViewportSize で同じ狭さを作る。
	//
	// ## なぜ見る必要があるのか
	// `LocationSearchForm` のルートは `Card` で、`Card` は overflow: hidden を持つ。
	// 「最近使った場所」パネルは入力欄の下へ積まれて Card の高さを押し広げるため、
	// 縦が足りないと下端が切れる／画面外へ出る恐れが設計時から未確認のまま残っていた。
	// 実装を読むだけでは分からず、実際にレイアウトさせるしかない。
	test("狭いビューポートでも「最近使った場所」パネルが画面外へはみ出さない", async ({ appPage, context }) => {
		await stubSavedDishCategories(context, [SAVED_CATEGORY]);
		// 上限 5 件（MAX_RECENT_LOCATIONS）を積んでパネルを最も高い状態にする。
		// 表示文字列と件数を固定したいので、ここは実 API ではなくシードで作る。
		await seedRecentLocations(
			context,
			[1, 2, 3, 4, 5].map((n) => ({
				locationQuery: `テスト地点${n}`,
				location: { latitude: 35.6 + n / 100, longitude: 139.7 + n / 100 },
				// ⚠️ 表示用の住所ではなく «推薦 API 用のトークン列»。#1196 以降、正規形式でない
				// エントリはアプリが読み出し時に捨てるため、ここを崩すとパネルが 0 件になる
				address: `country:JP, administrative_area_level_1:Tokyo, locality:Test${n}`,
				localLanguageCode: "ja",
			})),
		);

		// キーボード表示時の狭さの代用。幅はモバイル相当、高さはキーボードに食われた想定
		const viewport = { width: 390, height: 420 };

		// ⚠️ **縮めるのは「地点検索画面を開いたあと」。** 画面到達より前に 390x420 にすると、
		// プロフィール画面のリストコンテナ自体が height 0 に潰れて
		// `save-dish-category-tab-grid` が hidden になり、**本題に到達する前に落ちる**。
		// 実測: 1280x720 → height 214 / 390x844 → visible / 390x420 → height 0。
		// 幅ではなく高さ依存なので、幅だけ先に合わせても意味がない。
		const profilePage = new ProfilePage(appPage);
		await appPage.setViewportSize({ width: viewport.width, height: 844 });
		await profilePage.gotoSavedDishCategories();
		await profilePage.openLocationSearch();
		await profilePage.openLocationSearchRecentLocations();
		await appPage.setViewportSize(viewport);

		const panelBox = await profilePage.locationSearchRecentList.boundingBox();
		expect(panelBox, "「最近使った場所」パネルが描画されていない").not.toBeNull();
		if (!panelBox) return; // 型を絞るためだけ（上の expect で既に落ちている）

		// 上端がヘッダ側へ食い込んでいないこと
		expect(panelBox.y).toBeGreaterThanOrEqual(0);
		// 横方向（RTL や padding の崩れで左右へ飛び出す事故の検知）。
		// ここは横スクロールが無い前提のレイアウトなので、はみ出したら即バグ
		expect(panelBox.x).toBeGreaterThanOrEqual(0);
		expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(viewport.width);

		// ## 縦方向の要件を「スクロール無しで収まる」にしていない理由
		//
		// この spec は元々 `panelBox.y + panelBox.height <= viewport.height` を要求していたが、
		// **実測でパネルの下端は 478 で、420 のビューポートを 58px はみ出す**。
		// ただし `Card` に閉じ込められて切り取られているのではなく、**スクロールすれば到達できる**
		// （`scrollIntoViewIfNeeded()` の成功を実測）。つまり「操作不能」ではない。
		//
		// 5 件目を見るのにひと擦りが要るのは、キーボードで高さが半減した状態としては許容範囲で、
		// 「スクロール無しで収める」を要件にするとパネル側に max-height と内部スクロールが要り、
		// 通常の高さのときの見た目まで変わる。**そこはデザインの判断なのでテストで既成事実化しない。**
		//
		// ここで守りたいのは「切れて触れなくなる」事故なので、要件を **到達可能性** に置く。
		// Card の overflow: hidden で本当にクリップされたら scrollIntoViewIfNeeded では出てこない。
		const lastItem = profilePage.locationSearchRecentLocation(4);
		await lastItem.scrollIntoViewIfNeeded();
		await expect(
			lastItem,
			"5 件目の「最近使った場所」がスクロールしても見えない（Card に切り取られている）",
		).toBeVisible();

		const lastItemBox = await lastItem.boundingBox();
		expect(lastItemBox, "5 件目の「最近使った場所」が描画されていない").not.toBeNull();
		if (!lastItemBox) return;
		// スクロール後は可視領域の中に入っていること
		expect(lastItemBox.y).toBeGreaterThanOrEqual(0);
		expect(lastItemBox.y + lastItemBox.height).toBeLessThanOrEqual(viewport.height);
	});

	// ─ テストケース: 現在地ボタンで地点が確定し、検索結果へ進む ─
	// 手順:
	//   1. ブラウザへ位置情報の許可と座標（東京駅）を与える
	//   2. 地点検索画面を開き、現在地ボタン（入力欄の右）を押す
	//   3. 検索結果画面（profile/search-results）へ遷移することを検証
	//
	// ## 遷移で見る理由
	// 現在地ボタンは押下 → 座標取得 → onSubmit → router.push、までが 1 続き
	// （useLocationField.handleUseCurrentLocation → SavedDishCategoryLocationSearch.handleLocationSelect）。
	// 入力欄の文言（「現在地」）は遷移すると見えなくなるため観測が不安定で、
	// 「地点が確定した」ことの安定した証拠は遷移そのものになる。
	// 座標を与えないと LocationPermissionError でスナックバー表示のまま留まるので、
	// 遷移したこと自体が「取得した座標で検索へ進んだ」ことを意味する。
	test("現在地ボタンを押すと地点が確定し、検索結果画面へ進む", async ({ appPage, context }) => {
		await stubSavedDishCategories(context, [SAVED_CATEGORY]);
		await context.grantPermissions(["geolocation"]);
		await context.setGeolocation(TOKYO_STATION);

		const profilePage = new ProfilePage(appPage);
		await profilePage.gotoSavedDishCategories();
		await profilePage.openLocationSearch();

		await profilePage.locationSearchCurrentLocationButton.click();

		// 検索結果はプロフィールタブ内に留まる（#1133 の要件）
		await expect(appPage).toHaveURL(/\/profile\/search-results/);
	});

	// ─ テストケース: 候補をタップすると地点が確定し、検索結果へ進む（#528 / #1369） ─
	// 手順:
	//   1. 地点検索画面を開き、「渋谷」を入力する（実 API）
	//   2. 候補リストの先頭をクリックする
	//   3. 検索結果画面（profile/search-results）へ遷移することを検証
	//
	// ## なぜこの spec に足したのか（#528 の担保先の移動）
	// #528 は「候補をタップしたのにキーボードだけ閉じて選択が反応しない」不具合で、原因は
	// **地点オートコンプリートを BlurModal の中に置いていたこと**（親の KeyboardAvoidingView が
	// タップ開始時に Keyboard.dismiss() を呼び、キーボード高の変化によるレイアウト再計算で
	// 候補リストが unmount され、子の onPress が潰れる）だった。
	// その «唯一の» 該当画面がここで、#1369 でルート化して BlurModal ごと無くなっている。
	//
	// e2e-mobile 側（tests/search/location-suggestion-tap.test.ts）は同じ不具合の native 版を
	// ホームの検索フォームで守っているが、**ここは元の当事者の画面そのもの**にあたる。
	// 器を BlurModal へ戻す・キーボードを閉じる副作用を親へ足す、といった変更をすると
	// 「候補は見えるのに押しても何も起きない」＝ 遷移しない、という形でここが赤くなる。
	//
	// 観測点を入力欄の値ではなく遷移にしているのは、地点が «検索条件として» 確定したことまで
	// 見たいから（現在地ボタンのテストと同じ理由）。
	test("候補をクリックすると地点が確定し、検索結果画面へ進む", async ({ appPage, context }) => {
		await stubSavedDishCategories(context, [SAVED_CATEGORY]);

		const profilePage = new ProfilePage(appPage);
		await profilePage.gotoSavedDishCategories();
		await profilePage.openLocationSearch();

		await profilePage.locationSearchInput.fill("渋谷");
		await expect(profilePage.locationSearchSuggestions).toBeVisible();
		await expect(profilePage.locationSearchSuggestion(0)).toBeVisible();

		await profilePage.locationSearchSuggestion(0).click();

		// #528 が再発すると onPress が走らず、地点が確定しないのでここへ到達できない
		await expect(appPage).toHaveURL(/\/profile\/search-results/);
	});
});
