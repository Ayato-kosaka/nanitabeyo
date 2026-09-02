import { DEFAULT_TIMEOUT, by, element, existsNow, expect, tapWhenVisible, waitUntilVisible } from "../fixtures/e2e";

/**
 * 📜 法務ドキュメント画面（`/[locale]/legal/[doc]`）の Screen Object（e2e-web の pages/LegalPage.ts に対応）
 *
 * 対応コンポーネント:
 * - `app-expo/app/[locale]/legal/[doc].tsx`（ルート本体・`doc` の検証）
 * - `app-expo/features/settings/components/LegalDocument.tsx`（Markdown 本文の実体）
 *
 * ## #1368 モーダルからルートへ移した
 * かつては設定画面とログイン画面がそれぞれ BlurModal（`legal-document-modal`）で重ねていた。
 * ネイティブで最も重要なのは **ハードウェアバックで元の画面へ戻れること**で、
 * BlurModal は自前の BackHandler（`features/blurModal/hooks/useBlurModal.tsx`）で戻るキーを
 * 握っていた。ルート化でその責務は Navigator に移る。その乗り換えが効いているかを実端末で見る。
 *
 * ## テキストで探さないこと
 * 文書のタイトル・Markdown の見出し・遷移元の行ラベルがすべて同じ文字列（例:「利用規約」）に
 * なるため、`by.text("利用規約")` は複数要素へ一致し Detox は例外を投げる
 *（utils/waits.ts の `target()` 参照）。可視判定は必ず testID で行う。
 *
 * ## タイトルを可視判定に使わない理由
 * `legal-screen-title`（ScreenHeader が `${testID}-title` として出す）は
 * 「ルートであること」の固定には有効だが、not-found のときも文言が変わって描かれる。
 * 「どの文書が開いたか」は本文コンテナ（`legal-screen-document`）の有無で見る。
 */
export class LegalScreen {
	/** 本文コンテナ（公開中の文書のときだけ描かれる） */
	readonly document = by.id("legal-screen-document");
	/** 公開していない `doc` のときの not-found 表示 */
	readonly notFound = by.id("legal-screen-not-found");
	/**
	 * 画面タイトル（ScreenHeader が `${testID}-title` として付ける）。
	 *
	 * #1368 これは **「ルートであること」を守るための固定**。BlurModal 実装には存在しない要素なので、
	 * 本文だけを見ているとオーバーレイへ戻す変更を通してしまう（e2e-mobile/screens/LoginScreen.ts と同じ発想）。
	 */
	readonly title = by.id("legal-screen-title");
	/** ヘッダーの戻るボタン（`app-expo/components/ScreenHeader.tsx`） */
	// #1404 ScreenHeader の戻るボタンは `${testID}-back`。共通 id だった頃は、push で背面に残る
	// 画面のヘッダーと同じ id になり «背面を押していた»
	readonly backButton = by.id("legal-screen-back");

	/** 法務ドキュメント画面が開いていることを検証する */
	async expectOpened(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.document, timeout);
		await expect(element(this.title)).toBeVisible();
	}

	/** 公開していない `doc` で not-found が出ていることを検証する */
	async expectNotFound(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.notFound, timeout);
	}

	/**
	 * 本文コンテナが描かれているかを **待たずに** 判定する。
	 * 「not-found のときに本文が出ていないこと」の検証に使う（待つと必ず 25 秒待たされる）。
	 */
	async hasDocument(): Promise<boolean> {
		return existsNow(this.document);
	}

	/** ヘッダーの戻るボタンをタップして離脱する */
	async goBack(): Promise<void> {
		await tapWhenVisible(this.backButton);
	}
}
