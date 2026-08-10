import { test, expect } from "../../fixtures/test";
import { SearchPage } from "../../pages/SearchPage";
import { TopicsPage } from "../../pages/TopicsPage";
import { ResultPage } from "../../pages/ResultPage";
import { ReviewPage } from "../../pages/ReviewPage";
import { ProfilePage } from "../../pages/ProfilePage";
import { SettingsPage } from "../../pages/SettingsPage";
import { LoginModal } from "../../pages/LoginModal";
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
	test("さがすタブ（フォーム・詳細条件・チュートリアル）", async ({ appPage }) => {
		const searchPage = new SearchPage(appPage);

		await searchPage.expectLoaded();
		await captureScreen(appPage, "search-form");

		// 詳細条件（距離・予算・食べたい系統）を展開した状態
		await captureScreenIfReachable(appPage, "search-form-advanced-open", async () => {
			await searchPage.advancedToggle.click();
			await expect(searchPage.distanceSlider).toBeVisible();
		});

		// チュートリアルは初回のみ自動表示される（fixtures が視聴済みをシードしている）ため、
		// ヘッダーの「？」から開いて同じ UI を撮る。
		// 展開した詳細条件を引きずらないよう画面を開き直す
		await captureScreenIfReachable(appPage, "search-tutorial", async () => {
			await searchPage.goto();
			await searchPage.expectLoaded();
			await searchPage.openTutorial();
		});
	});

	// ─ 検索フロー（実 API・AI のトピック生成を待つ） ─
	test("検索フロー（料理提案・チュートリアル・結果フィード）", async ({ appPage }) => {
		// トピック生成は実測で 30 秒近くかかることがあるため、既定の 30 秒では足りない
		test.setTimeout(150_000);

		const searchPage = new SearchPage(appPage);
		const topicsPage = new TopicsPage(appPage);
		const resultPage = new ResultPage(appPage);

		// 場所サジェスト（実 API）は検索フローの一部なので、同じ入力をここでそのまま撮る
		// （別テストで再入力すると同じ API 呼び出しを二重に踏むうえ、フレークの原因も増える）
		await captureScreenIfReachable(appPage, "search-form-location-suggestions", async () => {
			await searchPage.typeLocation("渋谷");
			await expect(searchPage.locationSuggestion(0)).toBeVisible();
		});

		const reachedTopics = await captureScreenIfReachable(
			appPage,
			"search-topics",
			async () => {
				await searchPage.typeLocation("渋谷");
				await searchPage.selectLocationSuggestion(0);
				await searchPage.submitButton.click();
				await topicsPage.expectLoaded();
			},
			// カード画像の読み込みとカルーセルの初期アニメーションを待つ
			{ settleMs: 2_000 },
		);

		if (!reachedTopics) return;

		await captureScreenIfReachable(appPage, "search-topics-tutorial", async () => {
			await topicsPage.tutorialHelpButton.click();
			await topicsPage.expectTutorialStarted();
		});

		await captureScreenIfReachable(
			appPage,
			"search-result-feed",
			async () => {
				// チュートリアルを開いていた場合は閉じてからカードを選ぶ
				if (await topicsPage.tutorialOverlay.isVisible()) {
					await topicsPage.tutorialSkipButton.click();
					await expect(topicsPage.tutorialOverlay).toBeHidden();
				}
				await topicsPage.chooseFirstTopic();
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

	// ─ レビュータブ（ゲスト） ─
	test("レビュータブ（ゲスト表示・ログインモーダル）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const reviewPage = new ReviewPage(appPage);
		const loginModal = new LoginModal(appPage);

		await tabBar.gotoReview();
		await reviewPage.expectGuestViewLoaded();
		await captureScreen(appPage, "review-guest");

		await captureScreenIfReachable(appPage, "review-guest-login-modal", async () => {
			await appPage.getByTestId("review-guest-login-button").click();
			await loginModal.expectOpened();
		});
	});

	// ─ マイページ（ゲスト） ─
	test("マイページ（ゲスト表示・保存トピック・いいね・ログインモーダル）", async ({ appPage }) => {
		const tabBar = new TabBar(appPage);
		const profilePage = new ProfilePage(appPage);
		const loginModal = new LoginModal(appPage);

		await tabBar.gotoProfile();
		await profilePage.expectGuestViewLoaded();
		await expect(profilePage.savedPostsGrid).toBeVisible();
		await captureScreen(appPage, "profile-guest");

		// 「保存」グループ内のサブタブ（ja-JP: Profile.tabs.saved-topics = "料理"）
		await captureScreenIfReachable(appPage, "profile-guest-saved-topics", async () => {
			await appPage.getByText("料理", { exact: true }).click();
			await expect(profilePage.savedTopicsGrid).toBeVisible();
		});

		await captureScreenIfReachable(appPage, "profile-guest-liked", async () => {
			await appPage.getByTestId("profile-tab-group-liked").click();
			await expect(profilePage.likedGrid).toBeVisible();
		});

		await captureScreenIfReachable(appPage, "profile-guest-login-modal", async () => {
			await profilePage.openLoginModal();
			await loginModal.expectOpened();
		});
	});

	// ─ 設定とその配下 ─
	test("設定（メニュー・リーガルモーダル・フィードバック・ブロック済みトピック）", async ({ appPage }) => {
		const settingsPage = new SettingsPage(appPage);

		await settingsPage.goto();
		await settingsPage.expectLoaded();
		await captureScreen(appPage, "profile-settings");

		await captureScreenIfReachable(appPage, "profile-settings-terms-modal", async () => {
			await settingsPage.termsItem.click();
			await expect(appPage.getByTestId("legal-document-modal")).toBeVisible();
		});

		await captureScreenIfReachable(appPage, "profile-settings-privacy-modal", async () => {
			// モーダルを閉じる導線に testID が無いため、画面を開き直して別の文書を開く
			await settingsPage.goto();
			await settingsPage.expectLoaded();
			await settingsPage.privacyItem.click();
			await expect(appPage.getByTestId("legal-document-modal")).toBeVisible();
		});

		await gotoScreen(appPage, "profile-feedback");
		await captureScreen(appPage, "profile-feedback");

		await gotoScreen(appPage, "profile-blocked-topics");
		await captureScreen(appPage, "profile-blocked-topics", { settleMs: 2_000 });
	});

	// ─ 直リンクのみで到達する画面 ─
	test("直リンク画面（マップ・NotFound・en-US ロケール）", async ({ appPage }) => {
		// マップはタブに出ない隠しルート（href: null）。地図タイルの読み込みを待つ
		await gotoScreen(appPage, "map");
		await captureScreen(appPage, "map", { settleMs: 4_000 });

		await gotoScreen(appPage, "not-found");
		await expect(appPage.getByText("この画面は存在しません。")).toBeVisible();
		await captureScreen(appPage, "not-found");

		// ロケールは URL の先頭セグメントで決まる（ブラウザロケールは ja-JP のまま）
		await gotoScreen(appPage, "search-form-en-US");
		await expect(appPage.getByTestId("search-submit-button")).toBeVisible({ timeout: 30_000 });
		await captureScreen(appPage, "search-form-en-US");
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
