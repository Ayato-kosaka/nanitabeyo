import { expect, type Locator, type Page } from "@playwright/test";
import { clickRapid } from "../utils/rapid-click";

/**
 * 🚀 オンボーディング（#1486）の Page Object
 *
 * 対応画面:
 * - `app-expo/app/[locale]/onboarding/index.tsx`（3 ステップ）
 * - `app-expo/app/[locale]/onboarding/location.tsx`（位置情報許可）
 * - `app-expo/app/[locale]/onboarding/notifications.tsx`（通知許可・ログイン済みのみ）
 * - `app-expo/app/[locale]/onboarding/welcome.tsx`（Welcome）
 *
 * ## 旧チュートリアル（BottomSheet）との違い
 *
 * 旧実装は 1 枚のシートの中を FlatList で横スクロールしており、
 * 「ページ送りアニメーション中に `onViewableItemsChanged` が `currentPage` を揺らす」ことが
 * 原因の偽の赤（#1086 / #1091 / #1097）を延々と踏んでいた。CTA が単一の DOM ノードで
 * testID だけ入れ替わる構造だったため、Playwright が解決したノードがクリック到達時には
 * 別物へ化けている、という取り違えも起きていた。
 *
 * 新実装はページ送りが `useState` の単純な加算で、CTA は
 * `onboarding-back` / `onboarding-next` / `onboarding-skip` の **3 つの独立したノード**である。
 * どれも押しても消えない（1 枚目の「前へ」だけは描画されない）ので、
 * `pressByTestIdIfPresent` のような «特定と押下を同一タスクで» という回避策は要らない。
 *
 * ⚠️ ただし **「次へ」を押した直後に検証しないこと**。各ページは表示から約 1.5 秒後に
 * 課題フェーズ→解決フェーズへ切り替わる（`PROBLEM_PHASE_DURATION_MS`）。
 * 解決文言を見たいときは {@link expectSolutionVisible} を使い、
 * 固定 sleep ではなく «その文言が見えるまで» 待つこと。
 */
export class OnboardingPage {
	readonly page: Page;
	/** 3 ステップ画面のルート */
	readonly screen: Locator;
	/** 上部の丸数字インジケータ */
	readonly stepIndicator: Locator;
	/** 左下「前へ」（1 枚目では描画されない） */
	readonly backButton: Locator;
	/** 右下「次へ」 */
	readonly nextButton: Locator;
	/** 下部中央の「スキップ」 */
	readonly skipButton: Locator;
	/** 位置情報許可の説明画面 */
	readonly locationScreen: Locator;
	/** 通知許可の説明画面 */
	readonly notificationsScreen: Locator;
	/** Welcome 画面 */
	readonly welcomeScreen: Locator;
	/** Welcome の「はじめる」 */
	readonly startButton: Locator;
	/**
	 * オンボーディング画面内に描画されている画像。
	 *
	 * ⚠️ `screen` 配下に限定するのは、検索画面末尾の先読み用 1x1 View を除外するため。
	 * 先読み View は «検索画面» に属していて、オンボーディングは別ルートなので、
	 * ここで拾えるのは「オンボーディングが実際に表示している画像」だけになる。
	 */
	readonly images: Locator;

	constructor(page: Page) {
		this.page = page;
		this.screen = page.getByTestId("onboarding-screen");
		this.stepIndicator = page.getByTestId("onboarding-step-indicator");
		this.backButton = page.getByTestId("onboarding-back");
		this.nextButton = page.getByTestId("onboarding-next");
		this.skipButton = page.getByTestId("onboarding-skip");
		this.locationScreen = page.getByTestId("onboarding-location");
		this.notificationsScreen = page.getByTestId("onboarding-notifications");
		this.welcomeScreen = page.getByTestId("onboarding-welcome");
		this.startButton = page.getByTestId("onboarding-welcome-start");
		this.images = this.screen.locator("img");
	}

	/** 指定ステップの課題文（`onboarding-step-N-problem`） */
	problemText(step: 1 | 2 | 3): Locator {
		return this.page.getByTestId(`onboarding-step-${step}-problem`);
	}

	/** 指定ステップの解決文（`onboarding-step-N-solution`） */
	solutionText(step: 1 | 2 | 3): Locator {
		return this.page.getByTestId(`onboarding-step-${step}-solution`);
	}

	/** 3 ステップ画面が開いていることを検証する */
	async expectLoaded(): Promise<void> {
		await expect(this.screen).toBeVisible();
	}

	/**
	 * 指定ステップの «課題フェーズ» が出ていることを検証する。
	 *
	 * 課題文は解決フェーズでも残る（#1486 §1）ので、これは «そのステップに居る» ことの検査であって
	 * 「まだ解決フェーズへ移っていない」ことの検査ではない。
	 */
	async expectStep(step: 1 | 2 | 3): Promise<void> {
		await expect(this.problemText(step)).toBeVisible();
	}

	/**
	 * 指定ステップの解決フェーズが再生されるまで待つ。
	 *
	 * 解決文は課題フェーズでも DOM 上には存在する（`opacity: 0` で «場所だけ» 確保している）。
	 * そのため `toBeVisible()` では課題フェーズと区別できない。**不透明になったか**を見る。
	 */
	async expectSolutionVisible(step: 1 | 2 | 3): Promise<void> {
		const solution = this.solutionText(step);
		await expect(solution).toBeVisible();

		await expect
			.poll(
				async () => {
					// 解決ブロックは Animated.View なので、opacity は «祖先» に付く。
					// 要素自身から祖先をたどって、実効的な不透明度を掛け合わせる
					return solution.evaluate((node: Element) => {
						let opacity = 1;
						let current: Element | null = node;
						while (current) {
							const value = Number.parseFloat(window.getComputedStyle(current).opacity || "1");
							if (Number.isFinite(value)) opacity *= value;
							current = current.parentElement;
						}
						return opacity;
					});
				},
				{ message: `ステップ ${step} の解決フェーズが再生されなかった` },
			)
			.toBeGreaterThan(0.9);
	}

	/** 「次へ」を 1 回押す */
	async pressNext(): Promise<void> {
		await this.nextButton.click();
	}

	/** 「前へ」を 1 回押す */
	async pressBack(): Promise<void> {
		await this.backButton.click();
	}

	/** 「スキップ」を 1 回押す */
	async pressSkip(): Promise<void> {
		await this.skipButton.click();
	}

	/**
	 * 「次へ」を待機を挟まず `times` 回連打する（#1084 P3 と同じ狙い）。
	 *
	 * `locator.click()` のループにしないのは `SearchPage.submitRapid` と同じ理由
	 * （actionability チェックで待機が挟まり «連打» にならない）。
	 */
	async pressNextRapid(times: number): Promise<void> {
		await clickRapid(this.nextButton, times);
	}

	/** 3 ステップを最後まで進める（各ページの解決フェーズは待たない） */
	async advanceToLastStep(): Promise<void> {
		await this.expectStep(1);
		await this.pressNext();
		await this.expectStep(2);
		await this.pressNext();
		await this.expectStep(3);
	}
}
