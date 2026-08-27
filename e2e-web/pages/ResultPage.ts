import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 🍽 検索結果フィード画面(料理メディアのフィード/マップ)の Page Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/result.tsx
 *
 * 注意: この画面には静的な見出しテキストが無い(動的な料理メディアのみ)ため、
 * 画面表示の検証は closeButton(result-close-button)の可視性で行う。
 * URL バーはタブグループ内のネスト遷移で実表示と一致しないことがある(既知の挙動)。
 */
export class ResultPage {
	readonly page: Page;
	/** 結果画面を閉じるボタン(検索画面へ戻る) */
	readonly closeButton: Locator;
	/** いいねボタン(表示中の料理メディアカードに対する操作) */
	readonly likeButton: Locator;
	/** 保存ボタン(表示中の料理メディアカードに対する操作) */
	readonly saveButton: Locator;
	/** #1629 «…» メニュー。シェアと報告はこの中にある */
	readonly moreButton: Locator;
	/** 通報ボタン(#1514 SAF-01。**«…» メニューの中**。#1629 でレールから移動した) */
	readonly reportButton: Locator;
	/** 通報シート本体 */
	readonly reportSheet: Locator;
	/** 通報シートの送信ボタン */
	readonly reportSubmitButton: Locator;
	/** 通報の受付完了パネル */
	readonly reportAccepted: Locator;
	/** 受付完了パネルの閉じるボタン */
	readonly reportAcceptedCloseButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.closeButton = page.getByTestId("result-close-button");
		// フィードには複数カードが積まれるため、操作時は .first() 等で表示中カードに絞ること
		this.likeButton = page.getByTestId("dish-action-like");
		this.saveButton = page.getByTestId("dish-action-save");
		this.moreButton = page.getByTestId("dish-action-more");
		this.reportButton = page.getByTestId("dish-action-report");
		this.reportSheet = page.getByTestId("report-sheet");
		this.reportSubmitButton = page.getByTestId("report-submit");
		this.reportAccepted = page.getByTestId("report-accepted");
		this.reportAcceptedCloseButton = page.getByTestId("report-accepted-close");
	}

	/**
	 * 通報理由の選択肢。
	 *
	 * testID は `report-reason-<コード>` で、コードは
	 * shared/api/v1/constants/contentReports.ts の CONTENT_REPORT_REASON_CODES と同じ集合。
	 */
	reportReason(code: string): Locator {
		return this.page.getByTestId(`report-reason-${code}`);
	}

	/** 結果画面が表示されていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.closeButton).toBeVisible({ timeout: 30_000 });
	}

	/** 結果画面を閉じて検索画面へ戻る */
	async close(): Promise<void> {
		await this.closeButton.click();
	}
}
