import { DEFAULT_TIMEOUT, by, element, waitUntilVisible } from "../fixtures/e2e";

/**
 * ✏️ 「レビュー」タブの Screen Object（e2e-web の pages/ReviewPage.ts に対応）
 *
 * 対応画面:
 * - `app-expo/app/[locale]/(tabs)/review/index.tsx`（タブ本体。ログイン状態で表示が分岐する）
 * - `app-expo/app/[locale]/(tabs)/review/restaurant/[restaurantId]/review.tsx`
 *   （`features/map/components/ReviewForm.tsx`。レビュー投稿フォーム本体）
 *
 * 表示内容はログイン状態で分岐する（index.tsx）:
 * - 匿名ユーザー: ゲスト向け説明 + ログイン CTA（`Review.guest.*`）
 * - ログイン済み: レビュー投稿 CTA（`Review.authenticated.postButton`）→ SelectRestaurantScreen へ
 *
 * ## このクラスがカバーする範囲（#1031 B6 確定 / このリーダー指示の範囲）
 * この PR（PR-5）で実際にテストから使うのは **ゲスト向け表示 2 要素のみ**。
 * フォーム部分（comment/dishCategory/price/star/submit）は認証済み前提のため、
 * この PR のテストからは使わない。**将来のレビュー投稿テスト（別 PR・認証済みセッション利用）が
 * 迷わず使えるよう、実在する testID を調べたうえで定義だけ用意する**（#1031 B6 レビュー指摘の反映）。
 *
 * ## 写真付きレビュー投稿はスコープ外（#1031 B6 確定）
 * フォトピッカーは OS のアプリ外プロセスで動作するため、Detox からは操作できない。
 * そのため `ReviewForm` が起動直後に呼ぶメディア選択（`selectMedia`）を伴う画面遷移そのものを
 * この Screen Object / この PR のテストでは検証しない。テキスト入力欄（comment/dishCategory/price/star/submit）の
 * 定義だけを残しておき、実装は「メディア選択をアプリ側テストフックで固定画像に差し替える」方式が
 * 決まった将来の PR に委ねる。
 */
export class ReviewScreen {
	// ── ゲスト向け表示（この PR のテストで実際に使う） ──────────────────────────
	/** ゲスト向け説明文（ja-JP: `Review.guest.description` = "ログインしてレビューを書こう"） */
	readonly guestDescription = by.id("review-guest-description");
	/** ゲスト向けログイン CTA（ja-JP: `Review.guest.loginButton` = "ログインする"） */
	readonly guestLoginButton = by.id("review-guest-login-button");

	// ── ログイン済み向け表示（#1031 B6: 定義のみ。認証済みセッションが前提のため別 PR で使用） ──
	/** レビュー投稿 CTA（ja-JP: `Review.authenticated.postButton`）。タップで SelectRestaurantScreen へ遷移 */
	readonly postButton = by.id("review-post-button");

	// ── レビュー投稿フォーム（#1031 B6: 定義のみ。`ReviewForm.tsx` 由来、認証済み専用） ──────
	/** レビュー本文入力欄（`ReviewForm.tsx:578`） */
	readonly commentInput = by.id("review-comment-input");
	/** 料理カテゴリ選択行（`ReviewForm.tsx:596`）。タップで dishCategorySearch モーダルが開く */
	readonly dishCategoryRow = by.id("review-dish-category-row");
	/** 料理カテゴリ検索モーダル本体（`ReviewForm.tsx:722`, `DishCategorySearchForm`） */
	readonly dishCategorySearch = by.id("dish-category-search");
	/** 価格入力欄（`ReviewForm.tsx:635,646`） */
	readonly priceInput = by.id("review-price-input");
	/** 投稿ボタン（`ReviewForm.tsx:706`） */
	readonly submitButton = by.id("review-submit-button");

	/**
	 * 星評価ボタン（`ReviewForm.tsx:671`）。1〜5 の整数を渡す。
	 * @param star 1〜5
	 */
	star(star: 1 | 2 | 3 | 4 | 5) {
		return by.id(`review-star-${star}`);
	}

	/** ゲスト向けログイン CTA が表示されるまで待つ */
	async expectGuestViewLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.guestLoginButton, timeout);
	}

	/** ゲスト向けログイン CTA をタップする */
	async tapGuestLogin(): Promise<void> {
		await element(this.guestLoginButton).tap();
	}
}
