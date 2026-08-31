import { test, expect } from "../../fixtures/test";
import { OnboardingPage } from "../../pages/OnboardingPage";
import { SearchPage } from "../../pages/SearchPage";
import { DishCategoriesPage } from "../../pages/DishCategoriesPage";
import { ResultPage } from "../../pages/ResultPage";
import { MyDishesPage } from "../../pages/MyDishesPage";
import { ProfilePage } from "../../pages/ProfilePage";
import { SettingsPage } from "../../pages/SettingsPage";
import { LoginPage } from "../../pages/LoginPage";
import { LegalPage } from "../../pages/LegalPage";
import { RestaurantDetailPage } from "../../pages/RestaurantDetailPage";
import { TabBar } from "../../pages/TabBar";
import { captureScreen, captureScreenIfReachable, getScreen } from "../../utils/catalog";

/**
 * 📸 UI カタログ（匿名ユーザーで到達できる画面）@catalog
 *
 * ## これは「テスト」ではない
 * 目的は UI カタログ用のスクリーンショット収集であり、アプリの正しさの検証ではない
 * （検証は tests/ 配下の既存 spec が担う）。したがって:
 * - アサーションは「その画面が表示されている」ことを確定させる最小限だけ置く
 * - 実データ・実 API に依存する画面は {@link captureScreenIfReachable} で
 *   「撮れたら撮る」にし、撮れなかった事実を一覧へ残す（ジョブは赤くしない）
 *
 * ## 実行方法
 * 既定の `pnpm test` からは `@catalog` タグで除外される（playwright.config.ts）。
 * `pnpm test:catalog` で明示実行する。
 *
 * ## 画面の定義
 * 画面名・URL・説明・遷移関係は catalog/screens.json が唯一の情報源。
 * ここでは「その画面へどう到達するか」だけを書く。
 */
test.describe("UI カタログ（匿名） @catalog", () => {
	/** カタログ定義の URL へ直リンクする（URL の二重管理を防ぐ） */
	const gotoScreen = async (page: Parameters<typeof captureScreen>[0], id: string) => {
		await page.goto(getScreen(id).url);
	};

	// ─ 検索フォームとその UI 状態 ─
	test("さがすタブ（フォーム・詳細条件）", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		await searchPage.expectLoaded();
		await captureScreen(appPage, "search-form");

		// 詳細条件（距離・予算・食べたい系統）を展開した状態
		await captureScreenIfReachable(appPage, "search-form-advanced-open", async () => {
			await searchPage.advancedToggle.click();
			await expect(searchPage.distanceSlider).toBeVisible();
		});
	});

	// ─ オンボーディング 3 ステップ（#1486） ─
	test("オンボーディング（3 ステップ）", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const onboardingPage = new OnboardingPage(appPage);

		// 初回のみ自動で開く（fixtures が既読をシードしている）ため、ヘッダーの「？」から開く。
		// `？` 経由は 3 ステップだけを見せる導線（mode=manual）で、ここで撮りたいのもその 3 枚
		const opened = await captureScreenIfReachable(
			appPage,
			"onboarding-step1",
			async () => {
				await searchPage.goto();
				await searchPage.expectLoaded();
				await searchPage.openOnboarding();
				// 解決フェーズを «出してから» 撮る（課題だけの状態は «途中経過» で、
				// カタログとしては «その画面が何を伝えるか» が写っているほうが役に立つ）。
				// 解決フェーズは自動では出ない = 矢印を 1 回押す必要がある
				await onboardingPage.revealSolution(1);
			},
			{ settleMs: 500 },
		);

		if (!opened) return;

		for (const step of [2, 3] as const) {
			await captureScreenIfReachable(
				appPage,
				`onboarding-step${step}`,
				async () => {
					// 直前のページは解決フェーズで止まっているので、1 押下で次のページへ送られる
					await onboardingPage.pressNext();
					await onboardingPage.revealSolution(step);
				},
				{ settleMs: 500 },
			);
		}
	});

	// ─ オンボーディングの許可フローと Welcome（#1486 §5〜§7） ─
	//
	// ⚠️ 位置情報・通知の説明画面は «答えが出るまで» しか出ていない。web では
	// Playwright の既定コンテキストが許可を尋ねずに拒否するため、最低表示時間
	// （OnboardingPage のコメント参照）を過ぎると自動で次へ進む。撮り逃しても
	// ジョブを赤くしないよう、3 画面とも captureScreenIfReachable で «撮れたら撮る» にしている。
	test("オンボーディング（権限・Welcome）", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);
		const onboardingPage = new OnboardingPage(appPage);

		await searchPage.goto();
		await searchPage.expectLoaded();
		await searchPage.openOnboarding();
		await onboardingPage.advanceToLastStep();
		// `？` からは 3 枚で戻ってしまうので、ログイン以降は URL で直接入る
		await gotoScreen(appPage, "onboarding-location");

		await captureScreenIfReachable(appPage, "onboarding-location", async () => {
			await expect(onboardingPage.locationScreen).toBeVisible();
		});

		await captureScreenIfReachable(appPage, "onboarding-notifications", async () => {
			await gotoScreen(appPage, "onboarding-notifications");
			await expect(onboardingPage.notificationsScreen).toBeVisible();
		});

		await captureScreenIfReachable(
			appPage,
			"onboarding-welcome",
			async () => {
				await gotoScreen(appPage, "onboarding-welcome");
				await expect(onboardingPage.welcomeScreen).toBeVisible();
			},
			// クラッカーが飛び散り切ってから撮る
			{ settleMs: 1_500 },
		);
	});

	// ─ 検索フロー（実 API・AI のトピック生成を待つ） ─
	test("検索フロー（料理提案・スポットライト・結果フィード）", async ({ appPage }) => {
		// トピック生成は実測で 30 秒近くかかることがあるうえ、
		// スポットライトチュートリアル 4 ステップ分の撮影も挟むため、既定の 30 秒では全く足りない
		test.setTimeout(240_000);

		const searchPage = new SearchPage(appPage);
		const dishCategoriesPage = new DishCategoriesPage(appPage);
		const resultPage = new ResultPage(appPage);

		// 場所サジェスト（実 API）は検索フローの一部なので、同じ入力をここでそのまま撮る
		// （別テストで再入力すると同じ API 呼び出しを二重に踏むうえ、フレークの原因も増える）
		await captureScreenIfReachable(appPage, "search-form-location-suggestions", async () => {
			await searchPage.typeLocation("渋谷");
			await expect(searchPage.locationSuggestion(0)).toBeVisible();
		});

		const reachedDishCategories = await captureScreenIfReachable(
			appPage,
			"search-dishCategories",
			async () => {
				await searchPage.typeLocation("渋谷");
				await searchPage.selectLocationSuggestion(0);
				await searchPage.submitButton.click();
				await dishCategoriesPage.expectLoaded();
			},
			// カード画像の読み込みとカルーセルの初期アニメーションを待つ
			{ settleMs: 2_000 },
		);

		if (!reachedDishCategories) return;

		// スポットライトチュートリアルは 4 ステップ。全ステップを 1 枚ずつ撮る
		const tutorialSteps = [
			{ id: "search-dish-categories-tutorial-swipe", step: dishCategoriesPage.tutorialSwipeStep },
			{ id: "search-dish-categories-tutorial-deep-dive", step: dishCategoriesPage.tutorialDeepDiveStep },
			{ id: "search-dish-categories-tutorial-dishCategory-actions", step: dishCategoriesPage.tutorialActionsStep },
			{ id: "search-dish-categories-tutorial-group-vote", step: dishCategoriesPage.tutorialGroupVoteStep },
		] as const;

		const startedTutorial = await captureScreenIfReachable(appPage, tutorialSteps[0].id, async () => {
			await dishCategoriesPage.tutorialHelpButton.click();
			await dishCategoriesPage.expectTutorialStarted();
		});

		if (startedTutorial) {
			for (const { id, step } of tutorialSteps.slice(1)) {
				await captureScreenIfReachable(
					appPage,
					id,
					async () => {
						await dishCategoriesPage.tutorialNextButton.click();
						await expect(step).toBeVisible();
					},
					// スポットライトの移動アニメーションを待つ
					{ settleMs: 1_200 },
				);
			}
		}

		await captureScreenIfReachable(
			appPage,
			"search-result-feed",
			async () => {
				// チュートリアルを開いていた場合は閉じてからカードを選ぶ。
				// ⚠️ 最終ステップでは「スキップ」が消えて CTA が「使ってみる」(finish) に変わるため、
				// skip だけを待つと閉じられずにテストごとタイムアウトする（run 31383154085 で実測）
				if (await dishCategoriesPage.tutorialOverlay.isVisible()) {
					if (await dishCategoriesPage.tutorialFinishButton.isVisible()) {
						await dishCategoriesPage.tutorialFinishButton.click();
					} else if (await dishCategoriesPage.tutorialSkipButton.isVisible()) {
						await dishCategoriesPage.tutorialSkipButton.click();
					}
					await expect(dishCategoriesPage.tutorialOverlay).toBeHidden();
				}
				await dishCategoriesPage.chooseFirstDishCategory();
				await resultPage.expectLoaded();
			},
			// 地図タイル + 店舗カード（メディアの読み込みを伴う）が埋まるまで待つ。
			// 短いとスケルトンのまま撮れてしまい、カタログとして使えない
			{ settleMs: 8_000 },
		);
	});

	// ─ みんなで投票（共有リンク） ─
	// 実データの shareToken が無いため、無効トークン時のエラー状態のみ記録する
	// （投票の新規作成は dev DB への書き込みになるため行わない）
	test("みんなで投票（無効な共有トークンのエラー状態）", async ({ appPage }) => {
		const invalidToken = "e2e-ui-catalog-invalid-token";

		for (const id of ["search-group-vote-result", "search-group-vote-vote"] as const) {
			await captureScreenIfReachable(appPage, id, async () => {
				await appPage.goto(getScreen(id).url.replace("<shareToken>", invalidToken));
				// ja-JP: DishCategoryGroupVotes.loadFailed
				await expect(appPage.getByText("投票を読み込めませんでした")).toBeVisible({ timeout: 30_000 });
			});
		}
	});

	// ─ 食べたい/食べたタブ（ゲスト） ─
	// #1359 ログイン画面は 2 タブから同じ URL へ遷移するため、カタログの ID は auth-login 1 つに
	// 統合した（撮影はマイページの導線で 1 回だけ行う）
	test("食べたい/食べたタブ（ゲスト表示）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const myDishesPage = new MyDishesPage(appPage);

		await tabBar.gotoMyDishes();
		await myDishesPage.expectGuestViewLoaded();
		await captureScreen(appPage, "my-dishes-guest");
	});

	// ─ マイページ（ゲスト） ─
	// #1402 で 4 グリッドタブが廃止され、いいね／保存は «独立したルート» になった。
	// タブ切り替え（文言タップ・profile-tab-group-*）ではなく縦リストの行から遷移する。
	test("マイページ（ゲスト表示・保存した料理カテゴリ・いいね・ログイン画面）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginPage = new LoginPage(appPage);

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();
		await profilePage.expectLoaded();
		await captureScreen(appPage, "profile-guest");

		await captureScreenIfReachable(appPage, "profile-saved-dish-categories", async () => {
			await profilePage.openSavedDishCategories();
		});

		await captureScreenIfReachable(appPage, "profile-liked", async () => {
			await tabBar.gotoProfile();
			await profilePage.openLiked();
		});

		await captureScreenIfReachable(appPage, "auth-login", async () => {
			await tabBar.gotoProfile();
			await profilePage.openLogin();
			await loginPage.expectOpened();
		});
	});

	// ─ 保存料理カテゴリの地点検索（#1369 でモーダルからルートへ） ─
	// カードから開くのが本来の導線だが、匿名ユーザーには保存が 0 件で入口が無い。
	// 画面の見た目は dishCategoryId / dishCategoryLabelEn の有無で変わらない（フォームだけ）ので、
	// カタログは直リンクで撮る（実際の検索は保存トピックからの遷移でのみ成立する）
	test("保存料理カテゴリの地点検索", async ({ appPage }) => {
		await captureScreenIfReachable(appPage, "profile-saved-dish-category-location", async () => {
			await gotoScreen(appPage, "profile-saved-dish-category-location");
			await expect(appPage.getByTestId("saved-dish-category-location-search-input")).toBeVisible();
		});
	});

	// ─ 設定項目とその配下 ─
	// #1368 リーガル文書はモーダルではなく `/[locale]/legal/<doc>` ルートになったため、
	// カタログの ID も URL 準拠（legal-terms / legal-privacy）へ張り替えてある。
	// #1402 設定は独立した画面ではなくマイページの縦リストになったので、
	// «設定画面» のカタログ ID（profile-settings）は無くなった（profile-guest が兼ねる）。
	test("設定項目（法務ドキュメント・フィードバック・ブロック済みトピック）", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);
		const legalPage = new LegalPage(appPage);

		await settingsPage.goto();
		await settingsPage.expectLoaded();

		// 実導線（マイページの行）から遷移する。URL 直リンクでも同じ画面に着くが、
		// 「マイページから開ける」ことまでカタログの撮影経路に含めておく
		await captureScreenIfReachable(appPage, "legal-terms", async () => {
			await settingsPage.openAbout();
			await settingsPage.termsItem.click();
			await legalPage.expectOpened("terms");
		});

		await captureScreenIfReachable(appPage, "legal-privacy", async () => {
			await legalPage.goBack();
			await settingsPage.expectLoaded();
			await settingsPage.privacyItem.click();
			await legalPage.expectOpened("privacy");
		});

		// 公開していない doc の落とし所（既定の文書へ倒さない）も 1 枚残す
		await captureScreenIfReachable(appPage, "legal-not-found", async () => {
			await gotoScreen(appPage, "legal-not-found");
			await legalPage.expectNotFound();
		});

		await gotoScreen(appPage, "profile-feedback");
		await captureScreen(appPage, "profile-feedback");

		await gotoScreen(appPage, "profile-blocked-dish-categories");
		await captureScreen(appPage, "profile-blocked-dish-categories", { settleMs: 2_000 });
	});

	// ─ 直リンクのみで到達する画面 ─
	// #1419 マップは削除したのでここから外した
	test("直リンク画面（NotFound・en-US ロケール）", async ({ appPage }) => {
		await gotoScreen(appPage, "not-found");
		await expect(appPage.getByText("この画面は存在しません。")).toBeVisible();
		await captureScreen(appPage, "not-found");

		// ロケールは URL の先頭セグメントで決まる（ブラウザロケールは ja-JP のまま）
		await gotoScreen(appPage, "search-form-en-US");
		await expect(appPage.getByTestId("search-submit-button")).toBeVisible({ timeout: 30_000 });
		await captureScreen(appPage, "search-form-en-US");
	});

	// ─ 店舗詳細の子ルート（#1386 でモーダルからルートへ移した画面） ─
	// 店舗データを読まないので、ダミー id の直リンクで撮れる
	//（`catalog/screens.json` の note 参照）。フィードは実データが要るため manual。
	// #1411 で入札ルートを消したので、ここは料理カテゴリ選択の 1 枚になった。
	test("料理カテゴリ選択（店舗詳細の子ルート）", async ({ appPage }) => {
		const detailPage = new RestaurantDetailPage(appPage);

		await gotoScreen(appPage, "review-dish-category");
		await expect(detailPage.dishCategoryInput).toBeVisible({ timeout: 30_000 });
		await captureScreen(appPage, "review-dish-category");
	});

	// ─ 運営・協力タスク用ツール（アプリ内導線が無い直リンク専用画面） ─
	test("運営・協力タスクツール", async ({ appPage }) => {
		test.setTimeout(120_000);

		const contributionScreenIds = [
			"contribution-dish-category-image-optimizer",
			"contribution-dish-category-image-review",
			"contribution-dish-category-manual-image-supply",
			"contribution-dish-category-manual-text-supply",
			"contribution-dish-copy-survey",
			"contribution-dish-ranking-summary",
		] as const;

		for (const id of contributionScreenIds) {
			await gotoScreen(appPage, id);
			// いずれも起動直後に実 API からデータを取りに行くため、読み込みが終わるのを待ってから撮る
			await captureScreen(appPage, id, { settleMs: 5_000 });
		}
	});

	// ─ 認証失敗時のフォールバック ─
	// 匿名サインインを 429 に固定して再現する（tests/auth/auth-failure.spec.ts と同じ手法。
	// ブラウザ側で応答を差し替えるため Supabase のレート制限枠は消費しない）
	test.describe("認証失敗フォールバック", () => {
		// 共有の匿名 storageState があると「復元できるセッション」が存在してサインインが走らないため、
		// フレッシュな状態に戻す
		test.use({ storageState: { cookies: [], origins: [] } });

		test("匿名サインイン失敗時のエラー UI", async ({ page }) => {
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

			await captureScreenIfReachable(page, "auth-error-fallback", async () => {
				await page.goto("/");
				await page.waitForURL(/\/ja(-JP)?(\/|$)/);
				await expect(page.getByTestId("auth-error-fallback")).toBeVisible({ timeout: 30_000 });
			});
		});
	});
});
