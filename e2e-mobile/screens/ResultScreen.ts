import { DEFAULT_TIMEOUT, by, element, waitFor, waitUntil } from "../fixtures/e2e";

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
	 * 結果フィードの読み込み待ちタイムアウト (ms)。
	 * トピック選択後は店舗 5 件分のリストとサムネイルの事前読み込みが走るため長めに取る。
	 */
	static readonly RESULT_TIMEOUT = 90_000;

	/**
	 * 結果画面が表示されていることを検証する。
	 *
	 * @param timeout タイムアウト (ms)
	 * @失敗時 期限内に閉じるボタンが見えなければ Detox の例外を投げる
	 */
	async expectLoaded(timeout: number = ResultScreen.RESULT_TIMEOUT): Promise<void> {
		await waitFor(element(this.closeButton)).toBeVisible().withTimeout(timeout);
	}

	/** 結果画面を閉じてトピック画面へ戻る */
	async close(): Promise<void> {
		await element(this.closeButton).tap();
	}

	/**
	 * 表示中の料理メディアの「いいね」をタップする。
	 * ⚠️ 書き込みを伴うため @mutation（Tier 3）でのみ使うこと。
	 *
	 * @param index フィード内の何枚目のカードか（既定 0 = 表示中のカード）
	 */
	async like(index = 0): Promise<void> {
		await element(this.likeButton).atIndex(index).tap();
	}

	/**
	 * 表示中の料理メディアの「保存」をタップする。
	 * ⚠️ 書き込みを伴うため @mutation（Tier 3）でのみ使うこと。
	 *
	 * @param index フィード内の何枚目のカードか（既定 0 = 表示中のカード）
	 */
	async save(index = 0): Promise<void> {
		await element(this.saveButton).atIndex(index).tap();
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
