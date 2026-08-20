import {
	DEFAULT_TIMEOUT,
	by,
	element,
	tapWhenVisible,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 📍 レビュー投稿用の「お店選択」Screen Object。
 *
 * 対応画面:
 * - `app-expo/app/[locale]/(tabs)/review/selectRestaurant.tsx`（地図 + 検索でお店を選ぶ画面）
 * - `app-expo/app/[locale]/restaurant/[restaurantId].tsx`
 *   （`features/restaurant/components/SelectedRestaurantDetails.tsx`。選択後の詳細画面）
 *
 * ## この PR（PR-5）では定義のみ（#1031 B6 レビュー指摘の反映）
 * この画面へ到達する唯一の UI 導線は `ReviewScreen.postButton`（レビュータブの投稿 CTA）で、
 * ログイン済みユーザーにしか表示されない（`app-expo/.../review/index.tsx` の
 * `user?.is_anonymous !== false` 分岐）。つまり **匿名ユーザーはこの画面へ到達する手段が無い**ため、
 * この PR（匿名のみで検証する PR-5）のテストからは使わない。
 * 将来の認証済みレビュー投稿テスト（別 PR）がそのまま使えるよう、実在する testID を確認したうえで
 * 定義だけ用意しておく。
 */
export class SelectRestaurantScreen {
	/** 検索バー内の現在地ボタン（`selectRestaurant.tsx:480`） */
	readonly currentLocationButton = by.id("review-select-restaurant-current-location-button");

	/**
	 * 選択したお店の詳細画面にある「写真・動画を投稿」ボタン（`SelectedRestaurantDetails.tsx:137`）。
	 * ログイン済みなら ReviewScreen（フォーム）へ、匿名ならログインモーダルへ遷移する
	 * （`handleReviewButtonPress`、`SelectedRestaurantDetails.tsx:68-88`）。
	 */
	readonly postPhotoButton = by.id("restaurant-detail-post-photo-button");

	/**
	 * 店名・エリア検索の入力欄。
	 *
	 * この画面の `LocationAutocomplete` は `testID` を渡していないため、コンポーネント既定の
	 * `location-autocomplete` 接頭辞になる（検索画面側は `search-location-autocomplete` を渡しており別物）。
	 */
	readonly searchInput = by.id("location-autocomplete-input");

	/** 検索候補（0 始まり） */
	suggestion(index: number): Detox.NativeMatcher {
		return by.id(`location-autocomplete-suggestion-${index}`);
	}

	/** 店名・エリア検索の入力欄が表示されるまで待つ */
	async expectLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.searchInput, timeout);
	}

	/**
	 * 店名で検索する。
	 *
	 * #1031 【設計】`typeText` ではなく `replaceText` を使う（Android の Detox は Espresso の
	 * `typeTextIntoFocusedView` を使うため ASCII 以外を入力できない）。
	 * 候補パネルは「入力あり && フォーカス中」で開くため、入力前に必ずタップしてフォーカスを与える。
	 */
	async searchRestaurant(query: string): Promise<void> {
		await tapWhenVisible(this.searchInput);
		await element(this.searchInput).replaceText(query);
	}

	/**
	 * 検索候補を選ぶ。
	 *
	 * ⚠️ 飲食店カテゴリの候補を選ぶと `createAndOpenRestaurant()` が走り、
	 * **dev DB に restaurants レコードが作られる**（@mutation の領分）。
	 */
	async selectSuggestion(index: number, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.suggestion(index), timeout);
		await tapWhenVisible(this.suggestion(index));
	}

	/** 選択したお店の詳細で「写真・動画を投稿」をタップしてレビューフォームへ進む */
	async gotoReviewForm(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.postPhotoButton, timeout);
		await tapWhenVisible(this.postPhotoButton);
	}
}
