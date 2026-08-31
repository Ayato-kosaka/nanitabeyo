import {
	by,
	describeAuthenticated,
	describeMutation,
	DEFAULT_TIMEOUT,
	element,
	launchAppWithSession,
	localeDeepLink,
	tapWhenPresent,
	tapWhenVisible,
	visibleNow,
	waitUntilVisible,
} from "../../fixtures/e2e";
import { LegalScreen } from "../../screens/LegalScreen";
import { LoginScreen } from "../../screens/LoginScreen";
import { OnboardingScreen } from "../../screens/OnboardingScreen";
import { ProfileScreen } from "../../screens/ProfileScreen";
import { ResultScreen } from "../../screens/ResultScreen";
import { MyDishesScreen } from "../../screens/MyDishesScreen";
import { SearchScreen } from "../../screens/SearchScreen";
import { SelectRestaurantScreen } from "../../screens/SelectRestaurantScreen";
import { SettingsScreen } from "../../screens/SettingsScreen";
import { TabBar } from "../../screens/TabBar";
import { DishCategoriesScreen } from "../../screens/DishCategoriesScreen";
import { captureScreen, captureScreenIfReachable, getScreen, settle, tolerate } from "../../utils/catalog";

/**
 * 📸 UI カタログ（ネイティブ / Android・iOS）@catalog
 *
 * ## これは「テスト」ではない
 * 目的は UI カタログ用のスクリーンショット収集であり、アプリの正しさの検証ではない
 * （検証は tests/ 配下の既存 spec が担う）。したがって:
 * - アサーションは「その画面が表示されている」ことを確定させる最小限だけ置く
 * - 実データ・端末状態に依存する画面は captureScreenIfReachable で「撮れたら撮る」にし、
 *   撮れなかった事実を一覧へ残す（ジョブは赤くしない）
 *
 * ## 実行方法
 * `jest.config.js` が既定の探索から tests/catalog/ を外しているため、
 * `pnpm test:catalog:android` / `pnpm test:catalog:ios`（RUN_CATALOG=1）でのみ実行される。
 *
 * ## 画面の定義
 * 画面名・URL・説明・遷移関係は **repo ルートの catalog/screens.json**（Web と共通）。
 * ここでは「その画面へどう到達するか」だけを書く。
 */

/** カタログ定義の URL からロケール付きディープリンクを組み立てる（URL の二重管理を防ぐ） */
function deepLinkOf(id: string): string {
	// 定義側は "/ja-JP/profile/saved-dish-categories" 形式なので、先頭のロケールセグメントを外して渡す
	const pathname = getScreen(id).url.replace(/^\/[a-zA-Z-]+\//, "");
	return localeDeepLink(pathname);
}

describe("UI カタログ（匿名） @catalog", () => {
	it("さがすタブ（フォーム・詳細条件）", async () => {
		const searchScreen = new SearchScreen();

		await launchAppWithSession({ as: "anon" });
		await searchScreen.expectLoaded();
		await captureScreen("search-form");

		await captureScreenIfReachable("search-form-advanced-open", async () => {
			await searchScreen.openAdvancedFilters();
			// iOS では距離スライダーが画面外に居ることがある。展開できていれば撮る価値はあるので待ちは緩める
			await tolerate(() => waitUntilVisible(searchScreen.distanceSlider));
		});
	});

	// ─ オンボーディング（#1486） ─
	//
	// 「未読」で起動すると初回フォーカスで自動的に開く（e2e-web のヘルプボタン経由と違い、
	// こちらが native の素直な導線。tests/search/onboarding.test.ts と同じ）。
	//
	// ⚠️ 課題フェーズ → 解決フェーズは **矢印を押したときだけ** 切り替わる（自動では出ない）。
	// カタログとしては «その画面が何を伝えるか» が写っていてほしいので、
	// 課題だけの状態ではなく解決フェーズを出してから撮る（= 1 ページにつき「次へ」2 押下）。
	it("オンボーディング（3 ステップ・権限・Welcome）", async () => {
		const onboardingScreen = new OnboardingScreen();
		const loginScreen = new LoginScreen();

		const opened = await captureScreenIfReachable(
			"onboarding-step1",
			async () => {
				await launchAppWithSession({ as: "anon", tutorialSeen: false, waitForReady: false });
				await onboardingScreen.expectShown();
				await onboardingScreen.revealSolution(1);
			},
			{ settleMs: 500 },
		);

		if (!opened) return;

		for (const step of [2, 3] as const) {
			await captureScreenIfReachable(
				`onboarding-step${step}`,
				async () => {
					// 直前のページは解決フェーズで止まっているので、1 押下で次のページへ送られる
					await onboardingScreen.pressNext();
					await onboardingScreen.revealSolution(step);
				},
				{ settleMs: 500 },
			);
		}

		// 位置情報・通知の説明画面は «答えが出るまで» しか出ていない。E2E ビルドは起動時に
		// 権限を付与済みなので OS のダイアログは出ず、最低表示時間を過ぎると自動で次へ進む。
		// 撮り逃してもジョブを赤くしないよう captureScreenIfReachable で «撮れたら撮る» にしている
		await captureScreenIfReachable("onboarding-location", async () => {
			// 3 枚目も解決フェーズで止まっているので、1 押下でログイン画面へ抜ける
			await onboardingScreen.pressNext();
			await loginScreen.expectOpened();
			await loginScreen.skip();
			await waitUntilVisible(onboardingScreen.locationScreen, DEFAULT_TIMEOUT);
		});

		await captureScreenIfReachable(
			"onboarding-welcome",
			async () => {
				await onboardingScreen.waitForWelcome();
			},
			// クラッカーが飛び散り切ってから撮る
			{ settleMs: 1_500 },
		);
	});

	it("検索フロー（場所サジェスト・料理提案・チュートリアル 4 ステップ・結果フィード）", async () => {
		const searchScreen = new SearchScreen();
		const dishCategoriesScreen = new DishCategoriesScreen();
		const resultScreen = new ResultScreen();

		await launchAppWithSession({ as: "anon" });
		await searchScreen.expectLoaded();

		await captureScreenIfReachable("search-form-location-suggestions", async () => {
			await searchScreen.typeLocation("渋谷");
			await waitUntilVisible(searchScreen.locationSuggestions);
		});

		const reachedDishCategories = await captureScreenIfReachable(
			"search-dishCategories",
			async () => {
				await searchScreen.selectLocationSuggestion(0);
				await searchScreen.submit();
				await dishCategoriesScreen.expectLoaded();
			},
			{ settleMs: 3_000 },
		);

		if (!reachedDishCategories) return;

		const tutorialSteps = [
			["search-dish-categories-tutorial-swipe", "swipeAndDecide"],
			["search-dish-categories-tutorial-deep-dive", "deepDive"],
			["search-dish-categories-tutorial-dishCategory-actions", "dishCategoryActions"],
			["search-dish-categories-tutorial-group-vote", "groupVote"],
		] as const;

		const startedTutorial = await captureScreenIfReachable(
			tutorialSteps[0][0],
			async () => {
				await tapWhenVisible(dishCategoriesScreen.tutorialHelpButton);
				await waitUntilVisible(by.id(`dish-categories-tutorial-step-${tutorialSteps[0][1]}`));
			},
			{ settleMs: 1_500 },
		);

		if (startedTutorial) {
			for (const [id, step] of tutorialSteps.slice(1)) {
				await captureScreenIfReachable(
					id,
					async () => {
						await tapWhenVisible(dishCategoriesScreen.tutorialNextButton);
						await waitUntilVisible(by.id(`dish-categories-tutorial-step-${step}`));
					},
					{ settleMs: 1_200 },
				);
			}
			// スポットライトを閉じてからカードを選ぶ
			if (await visibleNow(dishCategoriesScreen.tutorialFinishButton, 2_000)) {
				await tapWhenVisible(dishCategoriesScreen.tutorialFinishButton);
			}
		}

		const reachedResult = await captureScreenIfReachable(
			"search-result-feed",
			async () => {
				await dishCategoriesScreen.chooseFirstDishCategory();
				await resultScreen.expectLoaded();
			},
			// 地図タイルと店舗カード（メディア読み込みを伴う）が埋まるまで待つ
			{ settleMs: 8_000 },
		);

		if (!reachedResult) return;

		/*
		#1742 カード押下で開く ActionSheet。**Android のナビゲーションバーの上に
		「キャンセル」が完全に見えていること**を目で確かめるための 1 枚。
		ライブラリ（@expo/react-native-action-sheet）は safe area を見ないので、
		ここが潜っていないことはネイティブのスクリーンショットでしか確かめられない。
		*/
		await captureScreenIfReachable(
			"search-result-action-sheet",
			async () => {
				await element(resultScreen.card).atIndex(0).tap();
				await waitUntilVisible(resultScreen.actionSheetTitle);
			},
			{ settleMs: 1_500 },
		);
	});

	it("食べたい/食べたタブ・マイページ（ゲスト）", async () => {
		const tabBar = new TabBar();
		const myDishesScreen = new MyDishesScreen();
		const profileScreen = new ProfileScreen();
		const loginScreen = new LoginScreen();

		await launchAppWithSession({ as: "anon" });
		await tabBar.gotoMyDishes();
		await myDishesScreen.expectGuestViewLoaded();
		await captureScreen("my-dishes-guest");

		// #1359 食べたい/食べたタブのログイン CTA もマイページと同じ /auth/login へ遷移するため、
		// カタログの ID は auth-login 1 つに統合した。撮影は下のマイページの導線で 1 回だけ行う
		await launchAppWithSession({ as: "anon" });
		await tabBar.gotoProfile();
		await profileScreen.expectGuestViewLoaded();
		await captureScreen("profile-guest", { settleMs: 2_000 });

		// #1402 4 グリッドタブが廃止され、いいね／保存は «独立した画面» になった。
		// タブグループ・サブタブ（文言タップ）ではなく縦リストの行 1 回で開ける
		await captureScreenIfReachable(
			"profile-liked",
			async () => {
				await profileScreen.openLiked();
				// いいねが 0 件だとグリッドではなく空状態が描画される。遷移できていれば撮る
				await tolerate(() => waitUntilVisible(profileScreen.likedGrid));
			},
			{ settleMs: 2_000 },
		);

		await captureScreenIfReachable(
			"profile-saved-dish-categories",
			async () => {
				await launchAppWithSession({ as: "anon" });
				await tabBar.gotoProfile();
				await profileScreen.openSavedDishCategories();
				// 保存が 0 件だとグリッドではなく空状態が描画される
				await tolerate(() => waitUntilVisible(profileScreen.savedDishCategoriesGrid));
			},
			{ settleMs: 2_000 },
		);

		await captureScreenIfReachable("auth-login", async () => {
			await launchAppWithSession({ as: "anon" });
			await tabBar.gotoProfile();
			await profileScreen.openLogin();
			await loginScreen.expectOpened();
		});
	});

	// #1368 リーガル文書はモーダルではなく `/[locale]/legal/<doc>` ルートになったため、
	// カタログの ID も URL 準拠（legal-terms / legal-privacy / legal-not-found）へ張り替えてある。
	// #1402 設定は独立した画面ではなくマイページの縦リストになったので、
	// カタログ ID «profile-settings» は無くなった（profile-guest が兼ねる）
	it("設定項目とその配下", async () => {
		const settingsScreen = new SettingsScreen();
		const legalScreen = new LegalScreen();

		await launchAppWithSession({ as: "anon", url: deepLinkOf("profile-guest") });
		await settingsScreen.expectLoaded();

		// 実導線（マイページの行）から遷移する。ディープリンクでも同じ画面に着くが、
		// 「マイページから開ける」ことまでカタログの撮影経路に含めておく
		await captureScreenIfReachable("legal-terms", async () => {
			await settingsScreen.openLegalDocument("terms");
			await legalScreen.expectOpened();
		});

		await captureScreenIfReachable("legal-privacy", async () => {
			// #1368 モーダル時代は閉じる導線に testID が無く起動し直していたが、
			// ルート化でヘッダーの戻るボタン（#1404 で legal-screen-back）から帰れるようになった。
			// #1402 で設定はマイページ本体へ統合されたので、帰り先はマイページ（SettingsScreen の
			// 対応画面が profile/index.tsx になっている）
			await legalScreen.goBack();
			await settingsScreen.expectLoaded();
			await settingsScreen.openLegalDocument("privacy");
			await legalScreen.expectOpened();
		});

		// 公開していない doc の落とし所（既定の文書へ倒さない）も 1 枚残す
		await captureScreenIfReachable("legal-not-found", async () => {
			await launchAppWithSession({ as: "anon", url: deepLinkOf("legal-not-found"), waitForReady: false });
			await legalScreen.expectNotFound();
		});
	});

	it("直リンクのみで到達する画面", async () => {
		// タブバーを持たない画面（運営ツール等）は waitForAppReady が成立しないため、
		// 起動完了待ちを切り、描画が落ち着くのを時間で待ってから撮る
		const directLinkScreens = [
			{ id: "profile-feedback", waitForReady: true, settleMs: 1_500 },
			// #1369 保存料理カテゴリの地点検索。本来の入口はカードのタップだが、匿名では保存が 0 件で
			// 入口が無い。見た目は dishCategoryId / dishCategoryLabelEn の有無で変わらないので直リンクで撮る
			{ id: "profile-saved-dish-category-location", waitForReady: true, settleMs: 1_500 },
			{ id: "profile-blocked-dish-categories", waitForReady: true, settleMs: 2_500 },
			// #1386 店舗詳細の子ルート（旧: モーダル z1100）。店舗データを読まないので
			// ダミー id の直リンクで撮れる（catalog/screens.json の note 参照）。
			// タブバーは下に居ないため起動完了待ちは切る。フィードは実データが要るため manual。
			// #1411 で入札ルートを消したのでここは 1 枚になった
			{ id: "review-dish-category", waitForReady: false, settleMs: 2_000 },
			{ id: "contribution-dish-category-image-optimizer", waitForReady: false, settleMs: 6_000 },
			{ id: "contribution-dish-category-image-review", waitForReady: false, settleMs: 6_000 },
			{ id: "contribution-dish-category-manual-image-supply", waitForReady: false, settleMs: 6_000 },
			{ id: "contribution-dish-category-manual-text-supply", waitForReady: false, settleMs: 6_000 },
			{ id: "contribution-dish-copy-survey", waitForReady: false, settleMs: 6_000 },
			{ id: "contribution-dish-ranking-summary", waitForReady: false, settleMs: 6_000 },
			// ネイティブの NotFound 画面には testID が無いため、到達判定はせず撮るだけ
			{ id: "not-found", waitForReady: false, settleMs: 3_000 },
		] as const;

		for (const { id, waitForReady, settleMs } of directLinkScreens) {
			await captureScreenIfReachable(
				id,
				async () => {
					const url = id === "not-found" ? localeDeepLink("this-route-does-not-exist") : deepLinkOf(id);
					await launchAppWithSession({ as: "anon", url, waitForReady });
				},
				{ settleMs },
			);
		}
	});

	it("みんなで投票（無効な共有トークンのエラー状態）", async () => {
		// 実データの shareToken が無いため、無効トークン時のエラー状態のみ記録する
		// （投票の新規作成は dev DB への書き込みになるため行わない）
		const invalidToken = "e2e-ui-catalog-invalid-token";
		const targets = [
			{ id: "search-group-vote-result", path: `search/dish-category-group-votes/${invalidToken}` },
			{ id: "search-group-vote-vote", path: `search/dish-category-group-votes/${invalidToken}/vote` },
		] as const;

		for (const { id, path } of targets) {
			await captureScreenIfReachable(
				id,
				async () => {
					await launchAppWithSession({ as: "anon", url: localeDeepLink(path), waitForReady: false });
					// ja-JP: DishCategoryGroupVotes.loadFailed
					await waitUntilVisible(by.text("投票を読み込めませんでした"), 30_000);
				},
				{ settleMs: 1_000 },
			);
		}
	});
});

describeAuthenticated("UI カタログ（ログイン済み） @catalog", () => {
	it("マイページ・いいね一覧・お知らせ", async () => {
		const tabBar = new TabBar();
		const profileScreen = new ProfileScreen();
		const settingsScreen = new SettingsScreen();

		await launchAppWithSession({ as: "authenticated" });
		await tabBar.gotoProfile();
		await captureScreen("profile-authenticated", { settleMs: 4_000 });

		// #1402 4 グリッドタブが廃止され、レビュータブ（profile-authenticated-reviews）は無くなった。
		// profile/food への導線は «いいねした投稿» だけになったので、フィードもそこから撮る
		const reachedLiked = await captureScreenIfReachable(
			"profile-liked",
			async () => {
				await profileScreen.openLiked();
				await waitUntilVisible(profileScreen.likedGrid);
			},
			{ settleMs: 4_000 },
		);

		if (reachedLiked) {
			await captureScreenIfReachable(
				"profile-food-feed",
				async () => {
					// グリッドのセルに testID が無いため、フィード固有のアクションボタンで到達を判定する
					await element(by.id("like-tab-grid")).tap();
					await waitUntilVisible(by.id("dish-action-like"), DEFAULT_TIMEOUT);
				},
				{ settleMs: 5_000 },
			);
		}

		// #1369 プロフィール編集はモーダルからルートへ移ったため、1 画面として撮る。
		// 編集ボタンはログイン済みのときだけ描画されるので、この（ログイン済み）側に置く
		await captureScreenIfReachable(
			"profile-edit",
			async () => {
				await launchAppWithSession({ as: "authenticated" });
				await tabBar.gotoProfile();
				await profileScreen.openEdit();
				await waitUntilVisible(by.id("profile-edit-screen-title"));
			},
			// アバター画像の読み込みを待つ（スケルトンのまま撮らない）
			{ settleMs: 2_000 },
		);

		// #1402 設定は独立した画面ではなくマイページの縦リストになったので、
		// カタログ ID «profile-settings-authenticated» は無くなった（profile-authenticated が兼ねる）。
		// ログアウト行まで写した 1 枚が要る場合は profile-authenticated を撮り直す前に
		// scrollToLogout() を挟むこと（行は縦リストの最下段にある）

		await captureScreenIfReachable(
			"notifications",
			async () => {
				await launchAppWithSession({ as: "authenticated" });
				await tabBar.gotoNotifications();
				await settle(2_000);
			},
			{ settleMs: 2_000 },
		);
	});

	it("レビュー投稿導線（食べたい/食べたタブ・店舗選択）", async () => {
		const tabBar = new TabBar();
		const myDishesScreen = new MyDishesScreen();
		const selectRestaurantScreen = new SelectRestaurantScreen();

		await launchAppWithSession({ as: "authenticated" });
		await tabBar.gotoMyDishes();
		await waitUntilVisible(myDishesScreen.recordButton);
		await captureScreen("my-dishes-authenticated");

		await captureScreenIfReachable(
			"my-dishes-select-restaurant",
			async () => {
				await myDishesScreen.gotoRecordDish();
				await selectRestaurantScreen.expectLoaded();
			},
			// 地図タイル・マーカーの描画待ち
			{ settleMs: 6_000 },
		);
	});
});

/**
 * レビュー投稿フロー（dev DB へ書き込むため RUN_MUTATION=1 のときだけ実行される）。
 * 店舗詳細・投稿フォーム・投稿完了後のレビュー詳細は、実際に投稿しないと到達できない画面。
 * コメントは識別できるよう必ず `[E2E]` プレフィックスを付ける（tests/mutation/review-post.test.ts と同じ規約）。
 */
describeMutation("UI カタログ（レビュー投稿フロー） @catalog @mutation", () => {
	it("店舗詳細 → 投稿フォーム → レビュー詳細", async () => {
		const tabBar = new TabBar();
		const myDishesScreen = new MyDishesScreen();
		const selectRestaurantScreen = new SelectRestaurantScreen();

		await launchAppWithSession({ as: "authenticated" });
		await tabBar.gotoMyDishes();
		await myDishesScreen.gotoRecordDish();
		await selectRestaurantScreen.expectLoaded();

		// #1375（3 巡目）pick モードでは選んだ時点で統合フォームへ戻る（詳細画面は経由しない）。
		// メディア選択は E2E ビルドの固定画像スタブ（EXPO_PUBLIC_E2E_MEDIA_HOOK）で通る
		const reachedForm = await captureScreenIfReachable(
			"review-post-form",
			async () => {
				await selectRestaurantScreen.searchRestaurant("スターバックス");
				await selectRestaurantScreen.selectSuggestion(0);
				await waitUntilVisible(myDishesScreen.commentInput, 30_000);
			},
			{ settleMs: 2_000 },
		);

		if (!reachedForm) return;

		await captureScreenIfReachable(
			"review-post-detail",
			async () => {
				// ⚠️ typeText は IME 経由のキーイベントに変換できず日本語で落ちる（Android で実測）。
				// Detox 公式の回避策どおり replaceText で直接流し込む
				await element(myDishesScreen.commentInput).replaceText("[E2E] UI カタログ収集");
				// 星は画面外に居ることがある（iOS で実測）。付けられなくても投稿自体は成立する
				await tolerate(() => myDishesScreen.rate(5));
				await tapWhenVisible(myDishesScreen.submitButton);
				// 投稿が成功すると /post/[id] へ遷移し、いいね等のアクションが並ぶ
				await waitUntilVisible(by.id("dish-action-like"), 60_000);
			},
			{ settleMs: 4_000 },
		);
	});
});
