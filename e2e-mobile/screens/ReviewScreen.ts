import {
	DEFAULT_TIMEOUT,
	by,
	element,
	existsNow,
	tapWhenVisible,
	waitUntilGone,
	waitUntilVisible,
} from "../fixtures/e2e";

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
 * ## 写真付きレビュー投稿の扱い（#1031 B6 → #1027 で解決）
 * フォトピッカーは OS のアプリ外プロセスで動作するため Detox からは操作できない。
 * 現在は E2E ビルドに限りメディア選択を固定画像へ差し替えるフックを app-expo 側へ用意しており
 *（`app-expo/lib/e2e/selectMediaStub.ts`）、投稿フォームの操作メソッドは実際に
 * tests/mutation/review-post.test.ts から使われている。
 * **`EXPO_PUBLIC_E2E_MEDIA_HOOK=1` を立ててビルドしていないとフォームが開かない**点に注意。
 */
export class ReviewScreen {
	/**
	 * レビュー投稿フォーム関連の待機に使うタイムアウト (ms)。
	 * 店舗レコードの作成・メディアのアップロード・レビュー登録がいずれもバックエンド往復を伴うため、
	 * 画面表示待ちの既定値（DEFAULT_TIMEOUT）では足りない。
	 */
	static readonly FORM_TIMEOUT = 90_000;

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
	 * 投稿ボタン内のローディングスピナー（#1136）。
	 *
	 * `PrimaryButton` は `testID` を渡されたとき、内側の `LoadingIndicator` へ `${testID}-loading` を
	 * 派生させる（app-expo/components/PrimaryButton.tsx）。**`loading` が false の間は
	 * そもそもレンダリングされない**ため、この要素の有無がそのまま `isSubmitting` の観測点になる。
	 * e2e-web が `role="status"` で見ているものと同じ実体を指す。
	 */
	readonly submitLoadingIndicator = by.id("review-submit-button-loading");

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
		await tapWhenVisible(this.guestLoginButton);
	}

	// ── ログイン済み / レビュー投稿フォームの操作（#1031 B6 の再開後に追加） ──────────────

	/** 料理カテゴリ検索モーダルの入力欄（`ReviewForm.tsx` が testID="dish-category-search" を渡している） */
	readonly dishCategoryInput = by.id("dish-category-search-input");

	/** 料理カテゴリ検索モーダルの候補（0 始まり） */
	dishCategorySuggestion(index: number): Detox.NativeMatcher {
		return by.id(`dish-category-search-suggestion-${index}`);
	}

	/** レビュー投稿 CTA をタップして「お店選択」画面へ進む（ログイン済みのみ表示） */
	async gotoPostReview(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.postButton, timeout);
		await tapWhenVisible(this.postButton);
	}

	/**
	 * レビュー投稿フォームが操作可能になるまで待つ。
	 *
	 * #1031 B6 フォームは入場直後のメディア選択が完了するまで本文入力欄を描画しない。
	 * E2E ビルドではメディア選択が固定画像へ差し替わる（app-expo の lib/e2e/selectMediaStub.ts）ため、
	 * ここで待てるのはその差し替えが効いている場合だけ。**待てない場合はフックが無効なビルド**を疑うこと。
	 */
	async expectFormLoaded(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.commentInput, timeout);
	}

	/**
	 * レビュー本文を入力する。
	 * #1031 Android の Detox は ASCII 以外を `typeText` できないため `replaceText` を使う。
	 */
	async fillComment(text: string): Promise<void> {
		await tapWhenVisible(this.commentInput);
		await element(this.commentInput).replaceText(text);
	}

	/** 料理カテゴリを検索して先頭候補を選ぶ（`isValid` に dishCategoryId が必須のため省略できない） */
	async chooseDishCategory(query: string, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await tapWhenVisible(this.dishCategoryRow);
		await waitUntilVisible(this.dishCategoryInput, timeout);
		await element(this.dishCategoryInput).replaceText(query);
		await waitUntilVisible(this.dishCategorySuggestion(0), timeout);
		await tapWhenVisible(this.dishCategorySuggestion(0));
	}

	/** 価格を入力する（数値のみ。`isValid` は 0 より大きい有限数を要求する） */
	async fillPrice(price: string): Promise<void> {
		await element(this.priceInput).atIndex(0).replaceText(price);
	}

	/** 星評価を選ぶ */
	async rate(star: 1 | 2 | 3 | 4 | 5): Promise<void> {
		await tapWhenVisible(this.star(star));
	}

	/** 投稿ボタンをタップする */
	async submit(): Promise<void> {
		await tapWhenVisible(this.submitButton);
	}

	/**
	 * 投稿ボタンにスピナーが出ている（= `isSubmitting` が true）かを **待たずに** 判定する（#1136）。
	 * 「出るまで待つ」側は `waitUntil` と組み合わせて spec 側で行う。
	 */
	async isSubmitting(): Promise<boolean> {
		return existsNow(this.submitLoadingIndicator, 1_000);
	}

	/**
	 * 投稿ボタンが押下可能かを `getAttributes()` で読み取る（#1136）。
	 *
	 * Detox には `accessibilityState` を直接検証するマッチャが無い（utils/waits.ts の `waitUntil` 参照）。
	 * `PrimaryButton` は `disabled={isDisabled}` を `Pressable` へ渡しており、React Native は
	 * これを各プラットフォームのネイティブな「無効」状態へ落とすため、`enabled` 属性として観測できる。
	 *
	 * @returns 押下可能なら true / 無効なら false / **属性自体が取れなかった場合は null**
	 *          （プラットフォーム差で欠ける可能性があるため、呼び出し側が「観測できなかった」と
	 *          「押せてしまう」を区別できるようにする）
	 */
	async isSubmitButtonEnabled(): Promise<boolean | null> {
		// getAttributes() の戻り値は iOS / Android・単一 / 複数一致で型が分かれるため、
		// SearchScreen / ResultScreen と同じく必要なキーだけに絞ってキャストする
		const attributes = (await element(this.submitButton).getAttributes()) as { enabled?: boolean };
		return attributes.enabled ?? null;
	}

	/**
	 * 投稿が完了してフォームが閉じたことを検証する。
	 *
	 * 成功時は `showSnackbar(Map.alerts.reviewSuccess)` のあと `onCancel()` が呼ばれてフォームが閉じる
	 * （`ReviewForm.tsx` の handleSubmit）。スナックバー文言はロケール依存なので、
	 * **フォームが閉じたこと**をユーザーから観測できる成功の証跡として使う。
	 */
	async expectFormClosed(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilGone(this.submitButton, timeout);
	}
}
