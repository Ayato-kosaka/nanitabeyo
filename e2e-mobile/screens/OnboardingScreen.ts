import {
	DEFAULT_TIMEOUT,
	by,
	existsNow,
	multiTapWhenPresent,
	tapWhenPresent,
	visibleNow,
	waitUntil,
	waitUntilVisible,
} from "../fixtures/e2e";

/**
 * 🚀 オンボーディング（#1486）の Screen Object
 *
 * 対応画面:
 * - `app-expo/app/[locale]/onboarding/index.tsx`（3 ステップ）
 * - `app-expo/app/[locale]/onboarding/location.tsx`（位置情報許可）
 * - `app-expo/app/[locale]/onboarding/notifications.tsx`（通知許可・ログイン済みのみ）
 * - `app-expo/app/[locale]/onboarding/welcome.tsx`（Welcome）
 *
 * 対応する e2e-web の Page Object: e2e-web/pages/OnboardingPage.ts
 *
 * ## 旧チュートリアル（TrueSheet）との違い — ここが重要
 *
 * 旧実装は TrueSheet の BottomSheet で、Detox から見ると次の 2 つの厄介事があった。
 *
 * 1. **Android では中身が必ず 2 つの View に一致する**（run 30445542854 で実測）。
 *    シート内の要素を扱うすべてのヘルパへ `atIndex(0)` を渡す必要があった
 * 2. **iOS では表示中でも `toBeVisible` が成立しない**（面積を持つ実体が無い。run 30432596949）
 *
 * 新実装は **通常のルート（画面）** なので、どちらも起きない。
 * `atIndex` の指定は要らず、`toBeVisible` もそのまま使える。
 *
 * さらに、旧実装のプライマリ CTA は単一ボタンで testID が
 * `search-tutorial-next` ↔ `search-tutorial-finish` と入れ替わっていたため、
 * 「最終ページでは next がツリーに存在しない」という前提を全ヘルパが背負っていた（#1086）。
 * 新実装の「前へ」「次へ」「スキップ」は **別々のボタン**で、押しても別の testID へ化けない。
 *
 * ## ⚠️ 「次へ」は 1 ページにつき **2 回**押す
 *
 * 各ページは «課題フェーズ → 解決フェーズ» の 2 段構えで、自動では切り替わらない
 *（1 押下目で解決フェーズ、2 押下目で次のページ）。«次のページへ送る» つもりの 1 押下は
 * 解決フェーズを出すだけで終わるので、ページを送るときは {@link goToNextStep} を、
 * 解決フェーズを出すだけのときは {@link revealSolution} を使う。
 */
export class OnboardingScreen {
	/** 3 ステップ画面のルート */
	readonly screen = by.id("onboarding-screen");
	/** 上部の丸数字インジケータ */
	readonly stepIndicator = by.id("onboarding-step-indicator");
	/** 左下「前へ」（1 枚目では描画されない） */
	readonly backButton = by.id("onboarding-back");
	/** 右下「次へ」 */
	readonly nextButton = by.id("onboarding-next");
	/** 下部中央の「スキップ」 */
	readonly skipButton = by.id("onboarding-skip");
	/** 位置情報許可の説明画面 */
	readonly locationScreen = by.id("onboarding-location");
	/** 通知許可の説明画面 */
	readonly notificationsScreen = by.id("onboarding-notifications");
	/** Welcome 画面 */
	readonly welcomeScreen = by.id("onboarding-welcome");
	/** Welcome の「はじめる」 */
	readonly startButton = by.id("onboarding-welcome-start");

	/** 指定ステップの課題文 */
	problemText(step: 1 | 2 | 3): Detox.NativeMatcher {
		return by.id(`onboarding-step-${step}-problem`);
	}

	/** 指定ステップの解決文 */
	solutionText(step: 1 | 2 | 3): Detox.NativeMatcher {
		return by.id(`onboarding-step-${step}-solution`);
	}

	/**
	 * オンボーディングが自動表示されていることを検証する。
	 *
	 * ja-JP かつ未読（AsyncStorage の `search_tutorial_seen_v1` が未設定）のときだけ成立する。
	 *
	 * 観測点を «画面のルート» ではなく「次へ」ボタンにしているのは #1027 と同じ理由で、
	 * 「出ていて操作できる」という検証したい事実と 1:1 で対応するのがボタンだから。
	 */
	async expectShown(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.nextButton, timeout);
	}

	/** 指定ステップに居ることを検証する（課題文は解決フェーズでも残るので «居る» の検査になる） */
	async expectStep(step: 1 | 2 | 3, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.problemText(step), timeout);
	}

	/**
	 * 指定ステップの解決フェーズが再生されたことを検証する。
	 *
	 * ⚠️ 解決文は課題フェーズでも **ツリーには存在する**（`opacity: 0` で場所だけ確保している）。
	 * `existsNow` で判定すると課題フェーズと区別できないので、`toBeVisible`（Detox は
	 * 可視性に不透明度を含める）で «見えている» ことを見る。
	 *
	 * ⚠️ 自動では再生されない。「次へ」を押していない状態で待つと必ずタイムアウトする
	 *（押下も込みで待ちたいときは {@link revealSolution}）。
	 */
	async expectSolutionShown(step: 1 | 2 | 3, timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.solutionText(step), timeout);
	}

	/** 解決フェーズを出す（「次へ」を 1 回押して、解決文が見えるまで待つ） */
	async revealSolution(step: 1 | 2 | 3): Promise<void> {
		await this.expectStep(step);
		await this.pressNext();
		await this.expectSolutionShown(step);
	}

	/**
	 * 次のページへ送る（解決フェーズを出してから、もう一度「次へ」を押す）。
	 *
	 * 3 枚目で呼ぶとログイン画面へ抜けるので、ページ送りにだけ使うこと。
	 */
	async goToNextStep(from: 1 | 2 | 3): Promise<void> {
		await this.revealSolution(from);
		await this.pressNext();
	}

	/** 「次へ」を 1 回押す */
	async pressNext(): Promise<void> {
		await tapWhenPresent(this.nextButton);
	}

	/** 「前へ」を 1 回押す */
	async pressBack(): Promise<void> {
		await tapWhenPresent(this.backButton);
	}

	/** 「スキップ」を 1 回押す */
	async pressSkip(): Promise<void> {
		await tapWhenPresent(this.skipButton);
	}

	/** Welcome の「はじめる」を押す */
	async pressStart(): Promise<void> {
		await tapWhenPresent(this.startButton);
	}

	/**
	 * Welcome の「はじめる」を、**画面を抜けるまでタップし直しながら**押し切る。
	 *
	 * Welcome は紙吹雪が無限ループする（確定仕様）うえ、record_videos 有効時は
	 * 画面録画の負荷も乗る。この状態の iOS シミュレータでは 1 回のタップが
	 * 取りこぼされることがあり、「押したのに Welcome のまま」で後続の遷移待ちが
	 * タイムアウトした（録画有効の run 32609985951 / 32615946840 で計 4 連続、
	 * 録画無効の run 32605810775 では成功、という相関の実測）。
	 * タップは冪等（markOnboardingSeen + 遷移）なので、着地確認とセットで繰り返す。
	 *
	 * @param exitedMatcher 遷移先で見えるはずの要素（例: 検索ヘッダのタイトル）
	 */
	async pressStartUntilExited(exitedMatcher: Detox.NativeMatcher, timeout = 60_000): Promise<void> {
		await waitUntil(
			async () => {
				if (await visibleNow(this.startButton, 1_000)) {
					await tapWhenPresent(this.startButton);
				}
				return visibleNow(exitedMatcher, 3_000);
			},
			{ description: "「はじめる」でアプリ本体へ戻ること", timeout },
		);
	}

	/**
	 * 「次へ」を **待機を挟まずに** `times` 回連打する（#1084 P3 と同じ狙い）。
	 *
	 * `pressNext()` の連続呼び出しでは連打にならない（Detox の同期機構が
	 * 1 発目の後に画面遷移の完了を待ってしまう）。詳細は `multiTapWhenPresent`。
	 */
	async pressNextRapid(times = 3): Promise<void> {
		await multiTapWhenPresent(this.nextButton, times);
	}

	/**
	 * 「前へ」が描画されているか（1 枚目では描画されない = #1486 §1「1枚目は戻る操作無効」）。
	 *
	 * 「見えているか」ではなく「存在するか」で見る。1 枚目では要素そのものを描いていないので、
	 * 存在の有無が仕様と 1:1 で対応する。
	 */
	async backButtonExists(timeout = 3_000): Promise<boolean> {
		return existsNow(this.backButton, timeout);
	}

	/** オンボーディングの 3 ステップ画面がまだ開いているか（連打テスト用） */
	async stillOpen(timeout = 3_000): Promise<boolean> {
		return visibleNow(this.nextButton, timeout);
	}

	/**
	 * 3 ステップを最後まで進める（各ページで «解決を出す» → «送る» の 2 押下）。
	 *
	 * 押下ごとに «3 枚目に着いたか» を見て打ち切るのは、呼び出し時点で何ページ目・
	 * どちらのフェーズに居るか分からない（1 枚目の解決フェーズから呼ばれることもある）ため。
	 *
	 * @param maxPresses 「次へ」の押下上限（無限ループ防止。3 ページ × 2 押下に余裕を足した値）
	 */
	async advanceToLastStep(maxPresses = 8): Promise<void> {
		for (let i = 0; i < maxPresses; i += 1) {
			if (await existsNow(this.problemText(3), 1_000)) return;
			await this.pressNext();
		}
		await this.expectStep(3);
	}

	/**
	 * 許可フローを通って Welcome へ着くまで待つ。
	 *
	 * 位置情報・通知の説明画面は «答えが出るまで» しか出ていない。E2E ビルドは
	 * 起動時に権限を付与済み（fixtures/e2e.ts の `platformLaunchOptions()`）なので
	 * OS のダイアログは出ず、最低表示時間を過ぎると自動で次へ進む。
	 * つまり途中の画面は «通り過ぎる» ものとして扱い、着地点だけを待つ。
	 */
	async waitForWelcome(timeout = 60_000): Promise<void> {
		await waitUntil(async () => visibleNow(this.welcomeScreen, 2_000), {
			description: "許可フローを通って Welcome 画面へ着くこと",
			timeout,
		});
	}
}
