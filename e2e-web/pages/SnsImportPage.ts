import { expect, type Locator, type Page } from "@playwright/test";

import { waitForHydrated } from "../utils/hydration";

/**
 * 📥 SNS 取り込み画面の Page Object（#1400 → #1375 実機確認で作り直し）
 *
 * 対応画面: app-expo/app/[locale]/add-record.tsx
 *（#1375 5 巡目で sns-import.tsx から改名。旧パスは転送だけを置いてある）
 *
 * ## この画面は «URL 直叩きで開ける» ことが前提
 * 共有からの着地は「アプリ未起動 → 起動 → この画面」という経路を持つため、画面そのものは
 * ログインを要求しない。取り込んだ `dish_media` の投稿者はアプリのユーザーではないので
 * `user_id` は NULL のままで、ユーザーとの紐付けは `reactions(save)` が持つ（#1375）。
 * したがって E2E は `/{locale}/add-record?url=<encoded>` を直接開くだけで成立する。
 *
 * ## #1375 実機確認で «3 状態の掲示板» ではなくなった
 *
 * 以前は `confirm` / `expandPending` / `unsupported` の 3 つの器を排他で出すだけの画面で、
 * 保存は「準備中」と文字で言っていた。いまは:
 *
 * - **入口が 2 つ、着地は 1 つ** … OS の共有シート（`?url=`）と、my-dishes の ＋ ボタン（`?url=` 無し）
 * - **貼り付け欄が主役** … `?url=` があれば初期値に入り、無ければ空で開く。どちらも同じ 1 本の入力欄
 * - **上部タブ** … 「SNS から」/「食べたを記録」（後者は既存のレビュー投稿導線へ抜ける）
 * - 「読み取る」→ 候補表示 →「食べたいに保存」まで画面内で完結する
 *
 * ⚠️ **貼られた文字列が画面に出るのは仕様である。** 旧 spec は「生の共有テキストを画面へ
 * 出さない」を検知点にしていたが、編集できる貼り付け欄が主役になったので前提が変わった。
 * 代わりに «対応外のときは対応 provider を必ず明示する» を検知点として残している
 * （黙って落とさない、という設計 §3 の要求はそのまま生きている）。
 *
 * ⚠️ **短縮 URL が «非対応» に倒れていたら不具合**である。TikTok アプリの共有ボタンが
 * 出すのは `vm.tiktok.com/{code}` なので、混ざると TikTok の主要導線が丸ごと「非対応」に見える。
 *
 * ## 「読み取る」「保存」はこの Page Object では叩かない
 * どちらも実 API（`POST /v1/dish-media/imports/resolve` / `.../imports`）を叩く。
 * 実 API に依存すると «実装が壊れた» のか «外部 provider / dev DB が変わった» のかを
 * 区別できないテストになるので、押下を伴う検証は mock を用意した別 spec の責務とする。
 * ここが守るのは «配信経路・文言・戻る» の 3 つである。
 */

export class SnsImportPage {
	readonly page: Page;
	/** 画面本体（testID: sns-import-screen） */
	readonly screen: Locator;
	/** ヘッダのタイトル（ScreenHeader の `${testID}-title` 規約） */
	readonly title: Locator;
	/** ヘッダの戻るボタン（ScreenHeader の `${testID}-back` 規約。#1404 で画面ごとに分かれた） */
	readonly backButton: Locator;
	/** 上部タブ「SNS から」（既定で選択されている） */
	readonly snsTab: Locator;
	/** 上部タブ「食べたを記録」。押すと既存のレビュー投稿導線（店舗選択）へ抜ける */
	readonly eatenTab: Locator;
	/** URL の貼り付け欄。`?url=` があれば初期値に入る */
	readonly urlInput: Locator;
	/** 「読み取る」ボタン。空欄の間は押せない */
	readonly resolveButton: Locator;
	/** 対応外のときに «対応している provider» を明示する説明文 */
	readonly unsupportedDescription: Locator;
	/** 短縮 URL のときの案内。**`unsupportedDescription` と混ざってはいけない** */
	readonly expandPending: Locator;

	constructor(page: Page) {
		this.page = page;
		this.screen = page.getByTestId("sns-import-screen");
		this.title = page.getByTestId("sns-import-screen-title");
		this.backButton = page.getByTestId("sns-import-screen-back");
		this.snsTab = page.getByTestId("sns-import-tab-sns");
		this.eatenTab = page.getByTestId("sns-import-tab-eaten");
		this.urlInput = page.getByTestId("sns-import-url-input");
		this.resolveButton = page.getByTestId("sns-import-resolve-button");
		this.unsupportedDescription = page.getByTestId("sns-import-unsupported-description");
		this.expandPending = page.getByTestId("sns-import-expand-pending");
	}

	/**
	 * 共有された URL を載せて画面を直接開く（= 共有からの着地と同じ形）。
	 *
	 * `sharedUrl` を省略すると `?url=` 無しで開く（＝ ＋ ボタンから開いた形）。
	 * `page.goto()` は毎回フルロードなので、**expo-router の履歴は空**になる。
	 * 「履歴が無いときの戻る」を見たいテストはこの状態を前提にしてよい。
	 */
	async goto(sharedUrl?: string, locale = "ja-JP"): Promise<void> {
		const query = sharedUrl === undefined ? "" : `?url=${encodeURIComponent(sharedUrl)}`;
		// ⚠️ 旧 `/sns-import` にも転送は置いてあるが、E2E は **正となるパス**を直接開く
		// （転送を挟むと «転送が壊れた» のか «画面が壊れた» のかが切り分けられない）
		await this.page.goto(`/${locale}/add-record${query}`);
		await expect(this.screen).toBeVisible();
		// ⚠️ ここで止めてはいけない。静的エクスポートなので、上の `toBeVisible()` は
		// **ビルド時に描かれた HTML** で満たされる（`?url=` はビルド時に存在しないので空）。
		// 貼り付け欄が hydrate されるまで待つ。理由は `utils/hydration.ts`（#1785）
		await waitForHydrated(this.urlInput);
	}

	/** 貼り付け欄にいま入っている文字列 */
	async inputValue(): Promise<string> {
		return this.urlInput.inputValue();
	}

	/** 貼り付け欄へ入力する（共有ではなく手で貼った形） */
	async paste(text: string): Promise<void> {
		await this.urlInput.fill(text);
	}

	/**
	 * 短縮 URL が «非対応» に倒れていないことを検証する。
	 *
	 * 「展開の案内が出ている」だけでなく **「非対応の説明が出ていない」** まで見る。
	 * ここが混ざると TikTok の主要導線が丸ごと壊れて見えるためである。
	 */
	async expectShortlinkNotTreatedAsUnsupported(): Promise<void> {
		await expect(this.expandPending).toBeVisible();
		await expect(this.unsupportedDescription).toBeHidden();
	}

	/** 画面に描かれているテキスト全体（文言が引けずに空になっていないかを見るために使う） */
	async visibleText(): Promise<string> {
		return (await this.screen.innerText()).replace(/\s+/g, " ");
	}
}
