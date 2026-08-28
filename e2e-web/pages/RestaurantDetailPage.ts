import { expect, type Locator, type Page } from "@playwright/test";

import { restaurantDetailPath, restaurantSubPath } from "../utils/restaurantDetail";

/**
 * 🏪 店舗詳細とその配下 2 画面（#1386 でルート化）の Page Object
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/restaurant/[restaurantId].tsx`（店舗詳細・アプリ唯一）
 * - `app-expo/features/restaurant/components/SelectedRestaurantDetails.tsx`（中身）
 * - `.../[restaurantId]/dish-category.tsx`（料理カテゴリ選択）
 * - `.../[restaurantId]/feed.tsx`（レビューのフィード）
 *
 * ## #1386 モーダルからルートへ移した
 * かつて店舗詳細は地図タブの `RestaurantBlurModal`（手動 zIndex 1100）で、その中に
 * レビュー投稿（1200）・入札（1300）・料理カテゴリ選択（**1100 = 親より下**）・フィード（1100）が
 * 積まれていた。どれも URL を持たず、開いてもタブの URL のままだった。
 * いまは通常の push なので **URL が変わる**。各 `expect*Opened()` の `toHaveURL` が
 * それを守る唯一のアサーションで、うっかりオーバーレイへ戻す変更を赤で止める
 *（`pages/LegalPage.ts` / `pages/LoginPage.ts` と同じ役割）。
 *
 * ## 戻る導線をコンテナ配下から探さないこと
 * `ScreenHeader`（戻るボタン）は画面のコンテナの外にある。戻る導線は画面ごとの back ロケータ
 *（`${testID}-back`）か URL で検証する。フィードだけはヘッダーを持たず、
 * `search/result.tsx` と同じ «浮かせた ×» なので `feedCloseButton` を使う。
 *
 * ⚠️ 共通の `screen-header-back` を使わないこと（#1404）。ルート化で push した画面と背面の画面が
 * 同時に DOM へ居る（Stack は下の画面を unmount しない）ため、共通 id では 2 件に当たり
 * Playwright が strict mode violation で落ちる。実際に E2E Web run 32243079269 で 4 件落ちた。
 */
export class RestaurantDetailPage {
	readonly page: Page;
	/** 店舗詳細の画面タイトル。ScreenHeader が `${testID}-title` として出す */
	readonly title: Locator;
	/** 「写真・動画を投稿」ボタン（ゲストならログイン画面へ、ログイン済みなら投稿フォームへ） */
	readonly postPhotoButton: Locator;
	/**
	 * 「入札する」ボタン。#1411 で **出さない** ことにしたので、これは «無いこと» を
	 * 検証するためだけに残している（決済が入るまで復活させない）
	 */
	readonly placeBidButton: Locator;
	/**
	 * 「Google マップで開く」ボタン。#1419 で **出さない** ことにしたので、これは «無いこと» を
	 * 検証するためだけに残している（`placeBidButton` と同じ扱い）
	 */
	readonly googleMapsButton: Locator;
	/** 料理カテゴリ選択画面のタイトル */
	readonly dishCategoryTitle: Locator;
	/** 料理カテゴリの検索入力欄（`DishCategoryAutocomplete` の既定 testID 接頭辞 + `-input`） */
	readonly dishCategoryInput: Locator;
	/** フィード画面のコンテナ */
	readonly feed: Locator;
	/** フィードの «見るものが無い» 表示（0 件 / 取得失敗） */
	readonly feedEmpty: Locator;
	/** フィードの閉じる ×（ヘッダーを持たない画面なので浮かせてある） */
	readonly feedCloseButton: Locator;
	/**
	 * 店舗詳細のヘッダー戻る。#1404 で画面ごとの id（`${testID}-back`）になった。
	 *
	 * ⚠️ 子ルート（料理カテゴリ選択 / フィード）を開いている間はこれを押さないこと。
	 * 背面の店舗詳細も DOM に残っているので «押せてしまう» が、押しているのは背面の画面である。
	 * 子ルートから戻るときは `goBackFromDishCategory` を使う。
	 */
	readonly backButton: Locator;
	/**
	 * 料理カテゴリ選択画面のヘッダー戻る。
	 *
	 * 現在の spec は「ルートとして開ける」ところまでしか見ていないため未使用だが、
	 * 子ルートの戻る導線を «片方だけ揃っていない» 状態にしないために置いてある。
	 */
	readonly dishCategoryBackButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.title = page.getByTestId("restaurant-detail-screen-title");
		this.postPhotoButton = page.getByTestId("restaurant-detail-post-photo-button");
		this.placeBidButton = page.getByTestId("restaurant-detail-place-bid-button");
		this.googleMapsButton = page.getByTestId("restaurant-detail-google-maps-button");
		this.dishCategoryTitle = page.getByTestId("dish-category-screen-title");
		this.dishCategoryInput = page.getByTestId("dish-category-search-input");
		this.feed = page.getByTestId("restaurant-feed-screen");
		this.feedEmpty = page.getByTestId("restaurant-feed-empty");
		this.feedCloseButton = page.getByTestId("restaurant-feed-close-button");
		this.backButton = page.getByTestId("restaurant-detail-screen-back");
		this.dishCategoryBackButton = page.getByTestId("dish-category-screen-back");
	}

	/** 店舗詳細へ直接遷移する（locale プレフィックス必須） */
	async goto(restaurantId?: string): Promise<void> {
		await this.page.goto(restaurantDetailPath(restaurantId));
	}

	/** 子ルート（料理カテゴリ選択 / フィード）へ直接遷移する */
	async gotoSub(segment: "dish-category" | "feed", restaurantId?: string): Promise<void> {
		await this.page.goto(restaurantSubPath(segment, restaurantId));
	}

	/**
	 * 店舗詳細が開いていることを検証する。
	 *
	 * #1386 ルート化そのものを守るアサーション。オーバーレイへ戻すと URL が変わらず落ちる。
	 */
	async expectOpened(): Promise<void> {
		await expect(this.page).toHaveURL(/\/restaurant\/[^/]+(\?.*)?$/);
		await expect(this.title).toBeVisible();
	}

	/** 料理カテゴリ選択画面が開いていることを検証する */
	async expectDishCategoryOpened(): Promise<void> {
		await expect(this.page).toHaveURL(/\/restaurant\/[^/]+\/dish-category(\?.*)?$/);
		await expect(this.dishCategoryTitle).toBeVisible();
		await expect(this.dishCategoryInput).toBeVisible();
	}

	/** フィード画面が開いていることを検証する */
	async expectFeedOpened(): Promise<void> {
		await expect(this.page).toHaveURL(/\/restaurant\/[^/]+\/feed(\?.*)?$/);
		await expect(this.feed).toBeVisible();
	}

	/**
	 * 店舗詳細のヘッダー戻るで離脱する。
	 *
	 * ⚠️ 子ルートを開いている状態では使わないこと（`backButton` の注意書きを参照）。
	 */
	async goBack(): Promise<void> {
		await this.backButton.click();
	}

	/** 料理カテゴリ選択画面のヘッダー戻るで離脱する */
	async goBackFromDishCategory(): Promise<void> {
		await this.dishCategoryBackButton.click();
	}
}
