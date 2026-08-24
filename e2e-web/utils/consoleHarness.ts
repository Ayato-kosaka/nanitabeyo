import type { Page } from "@playwright/test";

/**
 * 🧪 console error ゲート（REL-08 / #1500）自体を検証するためのダミーページ用ユーティリティ
 *
 * `fixtures/test.ts` の auto フィクスチャ `consoleErrors` は、収集した console error /
 * pageerror が 1 件でもあればテストを失敗させる。この「ハーネス自身の振る舞い」を
 * 固定するために、**アプリを一切起動せず**、意図的に console 出力や未捕捉例外を
 * 発生させるだけのダミーページを使う。
 *
 * ## なぜ実アプリではなくダミーページなのか
 * 実アプリの画面で console error を再現させようとすると、再現手段（壊れた API レスポンス等）が
 * アプリ実装の変更で簡単に効かなくなり、ゲートの検証だったはずのテストが
 * 「アプリが変わったから」赤くなる。ゲートの検証はアプリから完全に切り離す。
 *
 * ## なぜ `setContent` なのか
 * ダミーページは静的サーバ（`scripts/serve-dist.mjs` = `app-expo/dist`）に依存させたくない。
 * `page.setContent()` なら about:blank 上に文書を作れるため、dist のビルド有無に関係なく動く。
 */

/** ダミーページの見出しに付けた testID（ページが確かに開けたことの確認用） */
export const CONSOLE_HARNESS_TEST_ID = "console-harness-dummy";

/**
 * console 出力・未捕捉例外を発生させるためだけのダミーページを開く。
 *
 * @param page 対象ページ
 */
export async function openConsoleHarnessPage(page: Page): Promise<void> {
	await page.setContent(
		`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>console error gate harness</title></head>` +
			`<body><h1 data-testid="${CONSOLE_HARNESS_TEST_ID}">console error gate harness</h1></body></html>`,
	);
}

/**
 * ページ内で `console.error` を 1 回発生させ、**フィクスチャ側の listener に届くまで待つ**。
 *
 * ⚠️ `evaluate()` の完了と console イベントの配送は別経路なので、待たずにアサートすると
 * 「まだ届いていないだけ」で緑になり、ゲートが壊れても気付けないテストになる。
 * ここで `waitForEvent` を張るのは、フィクスチャの listener（先に登録されている）が
 * 確実に呼ばれ終わった状態を作るため。
 *
 * @param page 対象ページ
 * @param message 出力するメッセージ
 */
export async function emitConsoleError(page: Page, message: string): Promise<void> {
	const delivered = page.waitForEvent("console", (m) => m.type() === "error" && m.text().includes(message));
	await page.evaluate((text) => console.error(text), message);
	await delivered;
}

/**
 * ページ内で `console.warn` / `console.log` を 1 回発生させ、配送まで待つ。
 * ゲートが error 以外を拾っていないことの確認に使う。
 *
 * @param page 対象ページ
 * @param type 出力種別
 * @param message 出力するメッセージ
 */
export async function emitConsoleMessage(page: Page, type: "warning" | "log", message: string): Promise<void> {
	const delivered = page.waitForEvent("console", (m) => m.type() === type && m.text().includes(message));
	await page.evaluate(([kind, text]) => (kind === "warning" ? console.warn(text) : console.log(text)), [
		type,
		message,
	] as const);
	await delivered;
}

/**
 * ページ内で未捕捉例外（= `pageerror`）を 1 回発生させ、配送まで待つ。
 *
 * `setTimeout` 越しに throw するのは、`evaluate()` の中で直接 throw すると
 * Playwright が呼び出し側の Promise を reject するだけで **ページの未捕捉例外にならない**ため。
 *
 * @param page 対象ページ
 * @param message 例外メッセージ
 */
export async function emitPageError(page: Page, message: string): Promise<void> {
	const delivered = page.waitForEvent("pageerror", (error) => error.message.includes(message));
	await page.evaluate((text) => {
		setTimeout(() => {
			throw new Error(text);
		}, 0);
	}, message);
	await delivered;
}

/**
 * 収集済みの console error を握りつぶして、ゲートの発火を回避する。
 *
 * 「収集されたこと」を検証するテストは、そのまま終わるとゲートが発火して赤くなる。
 * `consoleErrors` はフィクスチャが握っている配列そのものなので、**同じ参照を空にする**ことで
 * teardown の `toEqual([])` を通す。（新しい配列を代入しても意味が無い点に注意）
 *
 * @param consoleErrors フィクスチャから受け取った配列
 * @returns 空にする前の内容のコピー
 */
export function drainConsoleErrors(consoleErrors: string[]): string[] {
	return consoleErrors.splice(0, consoleErrors.length);
}
