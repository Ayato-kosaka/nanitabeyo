import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 📜 法務ドキュメント画面（`/[locale]/legal/[doc]`）の Page Object
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/legal/[doc].tsx`（ルート本体・`doc` の検証）
 * - `app-expo/features/settings/components/LegalDocument.tsx`（Markdown 本文の実体）
 *
 * ## #1368 モーダルからルートへ移した
 * かつては設定画面とログイン画面がそれぞれ BlurModal（`legal-document-modal`）で重ねており、
 * 開いても URL はタブのままだった。いまは通常の push なので **URL が `/legal/<doc>` へ変わる**。
 * `expectOpened()` の `toHaveURL` はそれを守る唯一のアサーションで、
 * うっかりモーダルへ戻す変更を赤で止める（`pages/LoginPage.ts` と同じ役割）。
 *
 * ## 戻る導線をコンテナ配下から探さないこと
 * `legal-screen-document` は本文のコンテナで、`ScreenHeader`（戻るボタン）は **その外側**にある。
 * 戻る導線は `backButton`（`legal-screen-back`）か URL で検証する。
 *
 * ## 「利用規約」をテキストで探さないこと
 * 文書のタイトル・Markdown の見出し・遷移元のリンク文言がすべて同じ文字列になるため、
 * `getByText("利用規約")` は複数ノードへ一致する。可視判定は testID か URL で行う。
 */
export class LegalPage {
	readonly page: Page;
	/** 本文コンテナ（公開中の文書のときだけ描かれる） */
	readonly document: Locator;
	/** 公開していない `doc` のときの not-found 表示 */
	readonly notFound: Locator;
	/** 画面タイトル。ScreenHeader が `${testID}-title` として出す */
	readonly title: Locator;
	/** ヘッダーの戻るボタン（`app-expo/components/ScreenHeader.tsx`） */
	readonly backButton: Locator;

	constructor(page: Page) {
		this.page = page;
		this.document = page.getByTestId("legal-screen-document");
		this.notFound = page.getByTestId("legal-screen-not-found");
		this.title = page.getByTestId("legal-screen-title");
		this.backButton = page.getByTestId("legal-screen-back");
	}

	/** 指定した文書へ直接遷移する（locale プレフィックス必須） */
	async goto(doc: string, locale = "ja-JP"): Promise<void> {
		await this.page.goto(`/${locale}/legal/${doc}`);
	}

	/**
	 * 指定した文書が開いていることを検証する。
	 *
	 * #1368 ルート化そのものを守るアサーション。モーダルへ戻すと URL が変わらず落ちる。
	 */
	async expectOpened(doc: string): Promise<void> {
		await expect(this.page).toHaveURL(new RegExp(`/legal/${doc}(\\?|$)`));
		await expect(this.document).toBeVisible();
	}

	/** 公開していない `doc` で not-found が出ていることを検証する */
	async expectNotFound(): Promise<void> {
		await expect(this.notFound).toBeVisible();
		await expect(this.document).toHaveCount(0);
	}

	/** ヘッダーの戻るボタンで離脱する */
	async goBack(): Promise<void> {
		await this.backButton.click();
	}
}
