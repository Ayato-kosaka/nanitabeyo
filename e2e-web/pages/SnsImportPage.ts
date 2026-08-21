import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 📥 SNS 取り込み確認画面の Page Object（#1400）
 *
 * 対応画面: app-expo/app/[locale]/sns-import.tsx
 *
 * ## この画面は «URL 直叩きで開ける» ことが前提
 * 共有からの着地は「アプリ未起動 → 起動 → この画面」という経路を持つため、画面そのものは
 * 認証を要求しない（ログイン往復は `lib/snsShareIntake.ts` の責務で、画面の外側にある）。
 * したがって E2E は `/{locale}/sns-import?url=<encoded>` を直接開くだけで 3 状態を固定できる。
 * **モックサーバも E2E フックも要らない**（判定は `shared/utils/snsUrl.ts` の純関数だけで閉じている）。
 *
 * ## 3 状態（混ぜてはいけない）
 * | state | testID | 意味 |
 * | --- | --- | --- |
 * | confirm | `sns-import-confirm` | 投稿が特定できた。canonical URL を表示する |
 * | expandPending | `sns-import-expand-pending` | 短縮 URL。展開は API の仕事（#1399）で準備中 |
 * | unsupported | `sns-import-unsupported` | 対応外、または `url` 無しで開かれた |
 *
 * ⚠️ **`expandPending` が `unsupported` に倒れていたら不具合**である。TikTok アプリの共有ボタンが
 * 出すのは `vm.tiktok.com/{code}` なので、混ざると TikTok の主要導線が丸ごと「非対応」に見える。
 */

/** 画面が取りうる 3 状態（app-expo/lib/snsShareIntake.ts の `SnsShareIntakeView` と対応） */
export const SNS_IMPORT_STATES = ["confirm", "expandPending", "unsupported"] as const;

export type SnsImportState = (typeof SNS_IMPORT_STATES)[number];

/** state → 器の testID */
const STATE_TEST_IDS: Record<SnsImportState, string> = {
	confirm: "sns-import-confirm",
	expandPending: "sns-import-expand-pending",
	unsupported: "sns-import-unsupported",
};

export class SnsImportPage {
	readonly page: Page;
	/** 画面本体（testID: sns-import-screen） */
	readonly screen: Locator;
	/** ヘッダのタイトル（ScreenHeader の `${testID}-title` 規約） */
	readonly title: Locator;
	/** ヘッダの戻るボタン（ScreenHeader の `${testID}-back` 規約。#1404 で画面ごとに分かれた） */
	readonly backButton: Locator;
	/** 取り込める状態の器 */
	readonly confirm: Locator;
	/** provider の表示名（固有名詞なので翻訳されない。confirm / expandPending の両方に出る） */
	readonly provider: Locator;
	/** 表示される URL。**canonical だけが出る契約**（生の共有テキストは出さない） */
	readonly url: Locator;
	/** 「保存は準備中」を文字で伝える行。無言で終わる画面にしないための検知点 */
	readonly confirmPending: Locator;
	/** 短縮 URL の展開待ちの器 */
	readonly expandPending: Locator;
	/** 対応外の器 */
	readonly unsupported: Locator;
	/** 対応外のときに «対応している provider» を明示する説明文 */
	readonly unsupportedDescription: Locator;

	constructor(page: Page) {
		this.page = page;
		this.screen = page.getByTestId("sns-import-screen");
		this.title = page.getByTestId("sns-import-screen-title");
		this.backButton = page.getByTestId("sns-import-screen-back");
		this.confirm = page.getByTestId("sns-import-confirm");
		this.provider = page.getByTestId("sns-import-provider");
		this.url = page.getByTestId("sns-import-url");
		this.confirmPending = page.getByTestId("sns-import-confirm-pending");
		this.expandPending = page.getByTestId("sns-import-expand-pending");
		this.unsupported = page.getByTestId("sns-import-unsupported");
		this.unsupportedDescription = page.getByTestId("sns-import-unsupported-description");
	}

	/** state 名から器の locator を引く */
	container(state: SnsImportState): Locator {
		return this.page.getByTestId(STATE_TEST_IDS[state]);
	}

	/**
	 * 共有された URL を載せて画面を直接開く（= 共有からの着地と同じ形）。
	 *
	 * `sharedUrl` を省略すると `?url=` 無しで開く（`unsupported` に倒れるのが仕様）。
	 * `page.goto()` は毎回フルロードなので、**expo-router の履歴は空**になる。
	 * 「履歴が無いときの戻る」を見たいテストはこの状態を前提にしてよい。
	 */
	async goto(sharedUrl?: string, locale = "ja-JP"): Promise<void> {
		const query = sharedUrl === undefined ? "" : `?url=${encodeURIComponent(sharedUrl)}`;
		await this.page.goto(`/${locale}/sns-import${query}`);
		await expect(this.screen).toBeVisible();
	}

	/**
	 * 指定した state «だけ» が出ていることを検証する。
	 *
	 * 3 状態は排他なので、「出ていること」だけでなく **「他の 2 つが出ていないこと」** まで見る。
	 * 特に `expandPending` を見るときは、`unsupported` が出ていないことがそのまま
	 * 「TikTok の共有ボタンが非対応に見えていない」証跡になる。
	 */
	async expectOnlyStateVisible(state: SnsImportState): Promise<void> {
		await expect(this.container(state)).toBeVisible();
		for (const other of SNS_IMPORT_STATES) {
			if (other === state) continue;
			await expect(this.container(other)).toBeHidden();
		}
	}

	/**
	 * 画面に描かれているテキスト全体。
	 *
	 * 「生の共有テキストが画面へ露出していないか」を見るために使う。個別の locator を並べても
	 * 「どこか別の場所に出ている」を否定できないので、**画面ごと**見るのが検知点になる。
	 */
	async visibleText(): Promise<string> {
		return (await this.screen.innerText()).replace(/\s+/g, " ");
	}
}
