import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🗺 Google マップ fallback ダイアログの Page Object
 *
 * 対応実装:
 * - app-expo/features/search/hooks/useGoogleMapsFallback.ts（ダイアログ表示・openExternalUrl 呼び出し）
 * - app-expo/contexts/DialogProvider.tsx（共通ダイアログ。OK/キャンセルの testID を持つ）
 *
 * 検索結果が 0 件のときに「条件に合うお店を Googleマップ上でご確認頂けます。」という
 * 退避導線として表示される共通ダイアログ。DialogProvider は OK/キャンセルに
 * `dialog-confirm-button` / `dialog-cancel-button` の既定 testID を与えるため（#1131）、
 * ボタンはラベル文字列ではなく testID で特定する。
 *
 * ⚠️ このダイアログはアプリ全体の Portal に描画されるため、どの画面が表示中かに
 * 依存しない。0 件確定時は search/result 側が `handleClose()` も呼ぶので、
 * ダイアログが出た時点で背後の画面はトピック画面に戻っている（#828）。
 */
export class GoogleMapsFallbackDialog {
	readonly page: Page;
	/** ダイアログ本文（ja-JP: Search.googleMapsFallback.message） */
	readonly message: Locator;
	/** 「Google マップで開く」ボタン */
	readonly confirmButton: Locator;
	/** 「閉じる」ボタン */
	readonly cancelButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.message = page.getByText("条件に合うお店を Googleマップ上でご確認頂けます。");
		// ⚠️ `dialog-confirm-button` / `dialog-cancel-button` ではない。
		// `DialogProvider` には testID の規約が 2 つ同居しており、#1131 が入れた
		// 既定値（`dialog-confirm-button`）は `a.testID ?? ...` の形なので、
		// **`showDialog()` が testID を明示している経路では既定値が必ず負ける**。
		// Google マップ fallback は #1156 で `dialog-action-ok` を明示しているため、
		// 既定値の方を待つと永久に見つからない。
		this.confirmButton = page.getByTestId("dialog-action-ok");
		this.cancelButton = page.getByTestId("dialog-action-cancel");
	}

	/**
	 * fallback ダイアログが表示されるまで待つ。
	 *
	 * 0 件確定は「dish-media 検索 → bulk-import」の 2 リクエストを経てから決まるため、
	 * 既定の 10 秒では足りないことがある。ここだけ長めに待つ。
	 */
	async expectVisible(): Promise<void> {
		await expect(this.message).toBeVisible({ timeout: 30_000 });
		await expect(this.confirmButton).toBeVisible();
	}
}
