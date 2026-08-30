import { by, element, existsNow, waitFor, waitUntilGone, waitUntilVisible } from "../fixtures/e2e";

/**
 * #1213 候補画像の先読み完了を待つ上限 (ms)。
 *
 * 先読み対象は **実 API が返すリモート画像**（バンドル同梱のローカルアセットである #1087 と違う）で、
 * 候補数ぶんの HTTP 取得が要る。ネットワークの当たり外れを吸収できる長さにしてある。
 * この上限を払うのは **失敗するときだけ**なので、通過時の実行時間には影響しない。
 */
const VOTE_PRELOAD_PROBE_TIMEOUT = 20_000;

/**
 * プローブ要素そのものの存在確認に費やす上限 (ms)。
 *
 * プローブは投票画面と同時にマウントされるため、カードが出た時点で既に居るはず。
 * 「居ない = E2E ビルドではない」を素早く名指しで報告するための短い待ちで、
 * 先読み完了を待つ `VOTE_PRELOAD_PROBE_TIMEOUT` とは目的が違う。
 */
const VOTE_PRELOAD_PROBE_PRESENCE_TIMEOUT = 3_000;

/**
 * 🗳 友達投票（dish category group vote）画面の Screen Object
 *
 * 対応画面:
 * - app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteVoteScreen.tsx
 * - app-expo/features/dishCategoryGroupVotes/components/DishCategoryGroupVoteCompletionModal.tsx
 *
 * 対応する e2e-web のユーティリティ: e2e-web/utils/dishCategoryGroupVote.ts
 * （web 側は Page Object ではなく「API モック + 直接 getByTestId」で構成している。
 *   モックの組み立てが本体で、画面要素は数個しか触らないため）
 */
export class DishCategoryGroupVoteScreen {
	/** 投票カードの「良い」ボタン */
	readonly likeButton = by.id("dish-category-group-vote-like-button");
	/** 投票カードの「いまいち」ボタン */
	readonly dislikeButton = by.id("dish-category-group-vote-dislike-button");

	/**
	 * ログイン状態の確定待ちに描かれるローディング（#1120）。
	 * これが出ている間は「ゲスト用 / ログイン済み用」どちらの分岐も描かれない。
	 */
	readonly completionLoading = by.id("dish-category-group-vote-completion-loading");
	/** 確定後に描かれる完了モーダルのフォーム本体 */
	readonly completionForm = by.id("dish-category-group-vote-completion-form");
	/** 表示名の入力欄 */
	readonly displayNameInput = by.id("dish-category-group-vote-display-name-input");
	/**
	 * ゲスト向けの名前サジェスト（絵文字候補）。
	 * #1120 で「ログイン済みユーザーにも一瞬だけ出ていた」当該 UI。
	 */
	readonly nameSuggestions = by.id("dish-category-group-vote-name-suggestions");

	/**
	 * #1213 候補画像の先読み件数を載せた E2E 専用プローブ（`ready=<n>/<total>`）。
	 * 実体は app-expo/lib/e2e/voteImagePreloadProbe.tsx。**E2E ビルド限定**で描画される。
	 */
	readonly imagePreloadProbe = by.id("dish-category-group-vote-image-preload-probe");
	/** 同プローブの内訳（`ready=<n> error=<n> total=<n>`）。0 件が未着手か失敗かの切り分けに使う */
	readonly imagePreloadProbeDetail = by.id("dish-category-group-vote-image-preload-probe-detail");

	/** 投票カードが操作できる状態になるまで待つ */
	async expectVoteCardLoaded(timeout?: number): Promise<void> {
		await waitUntilVisible(this.likeButton, timeout);
	}

	/**
	 * 完了モーダルが「確定後の状態」に落ち着くまで待つ。
	 *
	 * ローディングが消えてフォームが出た時点を「安定した」とみなす。
	 * ここを観測点にすることで、後続のアサーションが確定前の一瞬を見てしまうことがない。
	 */
	async expectCompletionSettled(timeout?: number): Promise<void> {
		await waitUntilVisible(this.completionForm, timeout);
		await waitUntilGone(this.completionLoading, timeout);
	}

	/**
	 * #1213 候補画像が **全件** 先読み済みになるまで待つ。
	 *
	 * 「何 ms 以内に表示されたか」ではなく `ready=<n>/<total>` という **状態**を待つので、
	 * ランナーが遅いだけでは赤くならない（e2e-web の onboarding-preload.spec.ts と同じ観測原則）。
	 *
	 * @param total 候補の総数（投票セッションの未削除候補数）
	 * @param timeout 先読み完了を待つ上限 (ms)
	 * @失敗時 プローブの実測値（ready / error / total）を必ずメッセージへ載せる
	 */
	async expectAllCandidateImagesPreloaded(total: number, timeout: number = VOTE_PRELOAD_PROBE_TIMEOUT): Promise<void> {
		// プローブが存在しない = ビルド時にフックが立っていない。先読み待ちを使い切ってから
		// 「テキストが一致しない」と報告されると原因の切り分けに時間を取られるので先に名指しで落とす
		if (!(await existsNow(this.imagePreloadProbe, VOTE_PRELOAD_PROBE_PRESENCE_TIMEOUT))) {
			throw new Error(
				[
					"候補画像プリロードのプローブ（dish-category-group-vote-image-preload-probe）が画面に存在しません。",
					"  このプローブは E2E ビルド限定で描画されます（app-expo/lib/e2e/voteImagePreloadProbe.tsx）。",
					"  ビルド時に EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1 が設定されていたか確認してください",
					"  （このフックは **バンドル時** に metro の resolver で有効/無効が決まります）。",
				].join("\n"),
			);
		}

		const expected = `ready=${total}/${total}`;
		try {
			await waitFor(element(this.imagePreloadProbe)).toHaveText(expected).withTimeout(timeout);
		} catch (error) {
			// ⚠️ このメッセージは **必ず実測値を載せること**。再発時に
			// 「先読みしていない（ready=0 error=0）」のか「先読みしたが取得に失敗した（error>0）」のかを
			// ログだけで切り分けられることが、このテストの価値そのもの
			const actual = await this.readImagePreloadProbeDetail();
			throw new Error(
				[
					`候補画像が ${timeout}ms 以内に全件先読みされませんでした（期待: ${expected}）。`,
					`  プローブの実測値: ${actual}`,
					"  ready=0 error=0 なら、投票画面がプリロード契約に参加していません（#1213 の修正前と同じ状態）。",
					"  ready が 1 で止まるなら、先読みが «表示中の 1 枚だけ» に縮んでいます。",
					"  error>0 なら、先読み要求は出たが取得に失敗しています（画像 URL / ネットワーク側の問題）。",
					`  元の失敗: ${error instanceof Error ? error.message : String(error)}`,
				].join("\n"),
			);
		}
	}

	/**
	 * プローブの内訳テキストを読む（失敗時の切り分け専用。読めなければ理由を文字列で返す）。
	 *
	 * `getAttributes()` の戻り値は iOS / Android で型が分かれるため、`text` だけを拾う形に絞る
	 * （SearchScreen.ts の読み取りと同じ扱い）。
	 */
	private async readImagePreloadProbeDetail(): Promise<string> {
		try {
			const attributes = (await element(this.imagePreloadProbeDetail).getAttributes()) as { text?: string };
			return attributes.text ?? "(text 属性を読めませんでした)";
		} catch (error) {
			return `(プローブを読めませんでした: ${error instanceof Error ? error.message : String(error)})`;
		}
	}
}
