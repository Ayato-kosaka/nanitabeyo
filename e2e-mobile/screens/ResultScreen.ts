import {
	DEFAULT_TIMEOUT,
	by,
	element,
	tapWhenVisible,
	visibleNow,
	waitFor,
	waitUntil,
	waitUntilNotVisible,
} from "../fixtures/e2e";

/**
 * 🍽 検索結果フィード画面（料理メディアのフィード / マップ）の Screen Object
 *
 * 対応画面: app-expo/app/[locale]/(tabs)/search/result.tsx
 * 対応する e2e-web の Page Object: e2e-web/pages/ResultPage.ts
 *
 * ## 画面表示の観測点
 * この画面には静的な見出しテキストが無く（表示されるのは動的な料理メディアのみ）、
 * 画面到達の判定は閉じるボタン (`result-close-button`) の可視性で行う（e2e-web と同じ判断）。
 *
 * ## 閉じたときの戻り先
 * `useSearchResult.handleClose` は `router.back()` を呼ぶ。ナビゲーション履歴は
 * 検索 → トピック → 結果 と積まれているため、**1 回閉じた戻り先はトピック画面**になる。
 *
 * ## いいね / 保存の状態検証について（#1031 確定判断 B1）
 * `dish-action-like` / `dish-action-save` の **選択状態**（いいね済みかどうか）は、app-expo 側で
 * `aria-selected` と SVG の塗り色でしか表現されておらず、Detox には
 * `accessibilityState` を検証する API が無いため現時点では検証できない。
 * 状態を反映する testID の追加後に、@mutation テスト（PR-6）側で検証する。
 * ここではフィード上のアクションを**タップできる**ところまでをヘルパとして提供する。
 */
export class ResultScreen {
	/** 結果画面を閉じるボタン（トピック画面へ戻る） */
	readonly closeButton = by.id("result-close-button");
	/** いいねボタン（⚠️ フィードには複数カードが積まれるため atIndex で絞ること） */
	readonly likeButton = by.id("dish-action-like");
	/** 保存ボタン（⚠️ 同上） */
	readonly saveButton = by.id("dish-action-save");
	/**
	 * #1742 カード本体。押すと «このお店、気になる？» の ActionSheet が開く。
	 * ⚠️ フィードにはカードが複数積まれるので atIndex(0) で絞ること。
	 */
	readonly card = by.id("dish-media-card");
	/**
	 * #1742 カード押下で開く ActionSheet の見出し（`ActionSheet.title`）。
	 *
	 * ⚠️ このシートは `@expo/react-native-action-sheet` がライブラリ側で描くので testID を挿せない。
	 * 観測点は文言しか無い。CI はシステムロケールを ja-JP に固定している
	 * （e2e-mobile/scripts/setup-android-locale.sh）。文言を変えるときはここも直すこと。
	 */
	readonly actionSheetTitle = by.text("このお店、気になる？");
	/** #1629 «…» メニューを開くボタン。シェアと報告はこの中にある */
	readonly moreButton = by.id("dish-action-more");
	/** 通報ボタン（#1514 SAF-01。**«…» メニューの中**。#1629 でレールから移動した） */
	readonly reportButton = by.id("dish-action-report");
	/** 通報シート本体（Modal） */
	readonly reportSheet = by.id("report-sheet");
	/** 通報シートの送信ボタン */
	readonly reportSubmitButton = by.id("report-submit");
	/** 通報の受付完了パネル */
	readonly reportAccepted = by.id("report-accepted");
	/** 受付完了パネルの閉じるボタン */
	readonly reportAcceptedCloseButton = by.id("report-accepted-close");
	/** 通報の送信失敗時に出るメッセージ（migration 未適用のときはここが出る） */
	readonly reportError = by.id("report-error");
	/**
	 * #1156 検索結果 0 件のときに出る Google Maps 退避ダイアログの「閉じる」。
	 * DialogProvider の既定 2 ボタンに付く安定 testID で、i18n のラベルに依存しない。
	 */
	readonly googleMapsFallbackCancelButton = by.id("dialog-action-cancel");
	/**
	 * #1501 いいね / 保存の API が失敗したときに出るグローバルスナックバー
	 * （SnackbarProvider の `global-snackbar`。SearchScreen も同じ testID を観測点にしている）。
	 *
	 * ⚠️ 既定で 4 秒後に自動で消える。Detox の同期機構を有効にしたまま待つと
	 * 「タイマーが終わるまで idle にならない」→「消えてから評価される」になるため、
	 * 観測する側は `device.disableSynchronization()` してから待つこと。
	 */
	readonly snackbar = by.id("global-snackbar");

	/**
	 * 結果フィードの読み込み待ちタイムアウト (ms)。
	 * トピック選択後は店舗 5 件分のリストとサムネイルの事前読み込みが走るため長めに取る。
	 */
	static readonly RESULT_TIMEOUT = 90_000;

	/**
	 * 「結果フィードが表示された」と判定する前に、その状態が続いていることを確かめる時間 (ms)。
	 * 0 件時は退避ダイアログの表示と `handleClose()` が同じ commit の直後に走るため、
	 * この程度の猶予があれば「一瞬見えただけ」と「本当に表示された」を区別できる。
	 */
	static readonly SETTLE_MS = 2_000;

	/**
	 * 結果画面が表示されていることを検証する。
	 *
	 * @param timeout タイムアウト (ms)
	 * @失敗時 期限内に閉じるボタンが見えなければ Detox の例外を投げる
	 */
	async expectLoaded(timeout: number = ResultScreen.RESULT_TIMEOUT): Promise<void> {
		await waitFor(element(this.closeButton)).toBeVisible().withTimeout(timeout);
	}

	/**
	 * #1156 トピック選択後に成立しうる 2 つの結末のうち、どちらになったかを待って返す。
	 *
	 * ## なぜ必要か
	 * このフィードは dev の実 API を叩くため、選んだ料理カテゴリに表示できる店舗が
	 * 1 件も無いことがある。その場合 `search/result.tsx` は Google Maps への退避
	 * ダイアログを出したうえで **即座に `handleClose()` でトピック画面へ戻す**（#828）。
	 * つまり 0 件のときは `result-close-button` が可視になることは無く、
	 * `expectLoaded` は 90 秒待って必ずタイムアウトする。
	 *
	 * 実際に run 31074793886 の Android がこれで落ちた（同じ commit の別 run は成功）。
	 * 「結果が返る日は緑・返らない日は赤」という実 API のデータ依存フレーキーになるため、
	 * どちらの結末になったかを判別できるようにして、テスト側で扱えるようにする。
	 *
	 * ## 「閉じるボタンが見えた」だけで result と判定してはいけない理由
	 * `result.tsx` の 0 件判定は **描画のあとの `useEffect`** で走る。読み込み中は
	 * `RestaurantLoading` が `absoluteFill` + `zIndex: 9999` で全面を覆っているが、
	 * 0 件が確定して `isLoading` が false になった瞬間にその覆いが外れるため、
	 * 「退避ダイアログが出て `handleClose()` が効くまで」のごく短い間だけ
	 * `result-close-button` が可視になる窓がある。
	 *
	 * 実際 run 31094008189 の iOS はこの窓を踏み、`waitForResultOrFallback` が "result" を
	 * 返した直後に画面ごと消えて `close()` が 25 秒タイムアウトした。
	 * そこで **「見えた」ではなく「見え続けている」** ことを確認してから result と判定する。
	 *
	 * @returns "result" = 結果フィードが表示された / "fallback" = 0 件で退避ダイアログが出た
	 */
	async waitForResultOrFallback(timeout: number = ResultScreen.RESULT_TIMEOUT): Promise<"result" | "fallback"> {
		let outcome: "result" | "fallback" | null = null;

		await waitUntil(
			async () => {
				// 退避ダイアログは終着状態（この後の遷移で消えたりしない）なので先に見る。
				if (await visibleNow(this.googleMapsFallbackCancelButton, 1_000)) {
					outcome = "fallback";
					return true;
				}
				if (!(await visibleNow(this.closeButton, 1_000))) return false;

				// 0 件確定の瞬間にだけ現れる「一瞬だけ閉じるボタンが見える」窓を除外する。
				await new Promise((resolve) => setTimeout(resolve, ResultScreen.SETTLE_MS));

				if (await visibleNow(this.googleMapsFallbackCancelButton, 1_000)) {
					outcome = "fallback";
					return true;
				}
				if (await visibleNow(this.closeButton, 1_000)) {
					outcome = "result";
					return true;
				}
				return false;
			},
			{ timeout, description: "結果フィードの表示、または 0 件時の Google Maps 退避ダイアログ" },
		);

		// waitUntil は成立時に必ず outcome を埋めてから true を返す
		return outcome as unknown as "result" | "fallback";
	}

	/**
	 * 0 件時の Google Maps 退避ダイアログを「閉じる」で閉じる。
	 *
	 * `dialog-action-cancel` は DialogProvider の既定 2 ボタンに付いている安定 testID で、
	 * ラベル（i18n）に依存しない。
	 */
	async dismissGoogleMapsFallback(): Promise<void> {
		await tapWhenVisible(this.googleMapsFallbackCancelButton);
		await waitUntilNotVisible(this.googleMapsFallbackCancelButton);
	}

	/** 結果画面を閉じてトピック画面へ戻る */
	async close(): Promise<void> {
		await tapWhenVisible(this.closeButton);
	}

	/**
	 * 表示中の料理メディアの「いいね」をタップする。
	 * ⚠️ 書き込みを伴うため @mutation（Tier 3）でのみ使うこと。
	 *
	 * @param index フィード内の何枚目のカードか（既定 0 = 表示中のカード）
	 */
	async like(index = 0): Promise<void> {
		await tapWhenVisible(this.likeButton, DEFAULT_TIMEOUT, index);
	}

	/**
	 * 表示中の料理メディアの「保存」をタップする。
	 * ⚠️ 書き込みを伴うため @mutation（Tier 3）でのみ使うこと。
	 *
	 * @param index フィード内の何枚目のカードか（既定 0 = 表示中のカード）
	 */
	async save(index = 0): Promise<void> {
		await tapWhenVisible(this.saveButton, DEFAULT_TIMEOUT, index);
	}

	/**
	 * いいねボタンの accessibilityLabel を読み取る。
	 *
	 * #1031 【設計】B1 の回避策: いいね済みかどうかは `aria-selected` と SVG の塗り色でしか
	 * 表現されておらず、Detox には `accessibilityState` を検証する API が無い。
	 * ただし app-expo 側が **状態別の accessibilityLabel**
	 * （`DishMediaContent.accessibility.likeActive` / `likeInactive`）を付けているため、
	 * `getAttributes()` でラベルを読めば状態を観測できる。
	 */
	async likeLabel(index = 0): Promise<string> {
		return readLabel(this.likeButton, index);
	}

	/** 保存ボタンの accessibilityLabel を読み取る（likeLabel と同じ仕組み） */
	async saveLabel(index = 0): Promise<string> {
		return readLabel(this.saveButton, index);
	}

	/* ------------------------------------------------------------------ */
	/*                    通報（#1514 / SAF-01）                           */
	/* ------------------------------------------------------------------ */

	/**
	 * 表示中の料理メディアの「報告」をタップして通報シートを開く。
	 * ⚠️ ここから先は dev DB へ書き込むため @mutation（Tier 3）でのみ使うこと。
	 *
	 * @param index フィード内の何枚目のカードか（既定 0 = 表示中のカード）
	 */
	async openReportSheet(index = 0): Promise<void> {
		// #1629 通報はレール直置きから «…» メニューの中へ移った。先にメニューを開く
		await tapWhenVisible(this.moreButton, DEFAULT_TIMEOUT, index);
		await tapWhenVisible(this.reportButton, DEFAULT_TIMEOUT, 0);
		await waitFor(element(this.reportSheet)).toBeVisible().withTimeout(DEFAULT_TIMEOUT);
	}

	/**
	 * 通報理由を選ぶ。
	 *
	 * testID は `report-reason-<コード>` で、コードは
	 * shared/api/v1/constants/contentReports.ts の CONTENT_REPORT_REASON_CODES と同じ集合。
	 */
	async chooseReportReason(code: string): Promise<void> {
		await tapWhenVisible(by.id(`report-reason-${code}`));
	}

	/**
	 * 通報理由の accessibilityLabel を読み取る。
	 *
	 * #1031 と同じ回避策: 選択状態は `aria-selected` と色でしか表現されておらず、
	 * Detox には `accessibilityState` を検証する API が無い。app-expo 側が
	 * 状態別のラベル（`Report.accessibility.reason` / `reasonSelected`）を付けているため、
	 * `getAttributes()` でラベルを読めば «選ばれたか» を観測できる。
	 */
	async reportReasonLabel(code: string): Promise<string> {
		return readLabel(by.id(`report-reason-${code}`), 0);
	}

	/** 通報を送信する */
	async submitReport(): Promise<void> {
		await tapWhenVisible(this.reportSubmitButton);
	}

	/**
	 * 送信後の結末を待って返す。
	 *
	 * `content_reports` の migration が dev へ未適用のあいだは送信が必ず失敗し、
	 * 受付完了ではなく `report-error` が出る。どちらになったか区別できないと
	 * 「90 秒待って落ちる」だけになり、原因が読めない。
	 *
	 * @returns "accepted" = 受付完了 / "error" = 送信失敗（migration 未適用など）
	 */
	async waitForReportOutcome(timeout: number = DEFAULT_TIMEOUT): Promise<"accepted" | "error"> {
		let outcome: "accepted" | "error" | null = null;

		await waitUntil(
			async () => {
				if (await visibleNow(this.reportAccepted, 1_000)) {
					outcome = "accepted";
					return true;
				}
				if (await visibleNow(this.reportError, 1_000)) {
					outcome = "error";
					return true;
				}
				return false;
			},
			{ timeout, description: "通報の受付完了、または送信失敗メッセージ" },
		);

		return outcome as unknown as "accepted" | "error";
	}

	/** 受付完了パネルを閉じる */
	async closeReportAccepted(): Promise<void> {
		await tapWhenVisible(this.reportAcceptedCloseButton);
		await waitUntilNotVisible(this.reportSheet);
	}

	/**
	 * いいねボタンのラベルが `from` から変化するまで待ち、変化後のラベルを返す。
	 *
	 * ラベルは `{{name}}にいいね` / `{{name}}のいいねを解除` のように **店名が差し込まれた i18n 文字列**で、
	 * 店名は AI が選ぶため事前に確定できない。そこで文字列そのものを期待値にせず
	 * 「タップ前後で変化したこと」を検証する。こうすると ja-JP 以外のロケールでも成立する。
	 */
	async waitForLikeLabelChange(from: string, index = 0, timeout: number = DEFAULT_TIMEOUT): Promise<string> {
		await waitUntil(async () => (await this.likeLabel(index)) !== from, {
			timeout,
			description: "いいねボタンのラベル変化",
		});
		return this.likeLabel(index);
	}

	/** 保存ボタンのラベルが `from` から変化するまで待ち、変化後のラベルを返す（waitForLikeLabelChange と同じ考え方） */
	async waitForSaveLabelChange(from: string, index = 0, timeout: number = DEFAULT_TIMEOUT): Promise<string> {
		await waitUntil(async () => (await this.saveLabel(index)) !== from, {
			timeout,
			description: "保存ボタンのラベル変化",
		});
		return this.saveLabel(index);
	}
}

/**
 * 指定要素の accessibilityLabel を取得する。
 *
 * `getAttributes()` の戻り値は iOS / Android・単一 / 複数一致で型が分かれるが、
 * `atIndex()` で 1 件に絞っているため `label` を持つ形にしかならない。
 * 型定義がその絞り込みを表現できないので、ここで局所的に吸収する。
 */
async function readLabel(matcher: Detox.NativeMatcher, index: number): Promise<string> {
	const attributes = (await element(matcher).atIndex(index).getAttributes()) as { label?: string };
	return attributes.label ?? "";
}
