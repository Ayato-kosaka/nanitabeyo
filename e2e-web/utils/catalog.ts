import * as fs from "node:fs";
import * as path from "node:path";
import { test, type Page } from "@playwright/test";

/**
 * 📸 UI カタログ用スクリーンショット取得ユーティリティ
 *
 * ## 目的
 * 「今どんな画面が存在するのか」を後から人・ツール（Claude Design 等）が読める形に
 * 書き出すための仕組み。テストとしての検証はここでは行わない（アサーションは呼び出し側の責務）。
 *
 * ## 設計方針
 * - **画面の定義は repo ルートの catalog/screens.json が唯一の情報源**（Web / モバイル共通）。
 *   ここでは定義を読むだけで増やさない。
 *   spec とドキュメント生成スクリプトが同じ定義を参照するため、名前・URL・説明がズレない。
 * - **ファイル名 = 画面 ID（`<id>.png`）**。公開 URL（GCS）に出たときに、
 *   URL だけを見てどの画面か分かる ASCII 名にすること（evidence-collect.yml が
 *   `[A-Za-z0-9._-]` 以外を `_` に潰すため、日本語名は URL では読めなくなる）。
 * - **取得結果は 1 画面 1 JSON**（`screenshots/.results/<id>.json`）。
 *   Playwright は並列実行するため、単一ファイルへの追記にすると取りこぼす。
 */

/** カタログ定義（1 画面分） */
export type ScreenDefinition = {
	/** 画面 ID。そのままスクリーンショットのファイル名になる */
	id: string;
	/** 画面名（日本語） */
	name: string;
	/** expo-router 上のルート定義 */
	route: string;
	/** 代表的な URL（ja-JP） */
	url: string;
	/** プラットフォームごとの取得方針（このファイルは web を見る） */
	platforms: Record<"web" | "mobile", { capture: CaptureLevel; session: "anon" | "authenticated"; note?: string }>;
	/** 同一 URL 内の UI 状態（モーダル・タブ等）。単独画面なら null */
	state: string | null;
	/** 画面の簡単な説明 */
	description: string;
	/** どの画面から遷移してくるか */
	from: string[];
	/** 主な遷移先 */
	to: string[];
	/** 補足（自動取得しない理由など） */
	note?: string;
};

/**
 * 取得方針。
 * - auto     … 必ず撮る
 * - optional … 実データ次第で撮れないことがある（撮れなくてもジョブは失敗させない）
 * - mutation … dev DB へ書き込むフローのため RUN_MUTATION=1 のときだけ撮る
 * - manual   … 自動取得の対象外
 */
export type CaptureLevel = "auto" | "optional" | "mutation" | "manual";

/** 取得結果（screenshots/.results/<id>.json の中身） */
export type CaptureResult = {
	id: string;
	/** 撮れたかどうか */
	captured: boolean;
	/** ファイル名（`<id>.png`）。撮れなかった場合も「撮るはずだった名前」を残す */
	file: string;
	/** 撮影時に実際にブラウザが表示していた URL */
	capturedUrl: string | null;
	/** Playwright のプロジェクト名 */
	project: string;
	/** ビューポート（例: "1280x720"） */
	viewport: string | null;
	/** 撮れなかった場合の理由 */
	skipReason?: string;
};

/** 画面定義（repo ルートの catalog/screens.json）。JSON import ではなく実行時読み込みにして
 *  ワークスペース外のファイルでも tsconfig の設定に依存せず読めるようにする */
const catalog = JSON.parse(
	fs.readFileSync(path.resolve(__dirname, "..", "..", "catalog", "screens.json"), "utf-8"),
) as {
	schemaVersion: number;
	defaultLocale: string;
	screens: ScreenDefinition[];
};

/** カタログ定義の全画面 */
export const SCREENS: ScreenDefinition[] = catalog.screens;

/**
 * スクリーンショットの出力先。
 * `UI_CATALOG_DIR` で差し替え可能（既定は e2e-web/screenshots）。
 */
export const SCREENSHOT_DIR = process.env.UI_CATALOG_DIR
	? path.resolve(process.env.UI_CATALOG_DIR)
	: path.resolve(__dirname, "..", "screenshots");

/** 取得結果 JSON の出力先 */
export const RESULT_DIR = path.join(SCREENSHOT_DIR, ".results");

/** 画面 ID から定義を引く（未定義 ID は typo なので即座に失敗させる） */
export function getScreen(id: string): ScreenDefinition {
	const screen = SCREENS.find((candidate) => candidate.id === id);
	if (!screen) {
		throw new Error(
			`未定義の画面 ID です: "${id}" — catalog/screens.json に定義を追加してください（定義済み: ${SCREENS.length} 件）`,
		);
	}
	return screen;
}

function writeResult(result: CaptureResult): void {
	fs.mkdirSync(RESULT_DIR, { recursive: true });
	fs.writeFileSync(path.join(RESULT_DIR, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
}

/**
 * 画面が描画し終わるのを「見た目が動かなくなったこと」で待つ。
 *
 * この用途では特定要素の可視化だけでは足りない（画像の遅延読み込み・カルーセルの
 * 初期アニメーションが残っているとスクリーンショットが崩れる）。
 * 逆に `networkidle` は実 API のポーリングやメディアのプリフェッチで永遠に来ないことがあるため使わない。
 *
 * @param page 対象ページ
 * @param settleMs 画面が落ち着くのを待つ時間 (ms)
 */
async function settle(page: Page, settleMs: number): Promise<void> {
	// フォント・画像のデコードが終わるまでの猶予。読み込み中の空フレームを撮らないための最低限の待ち
	await page.waitForLoadState("domcontentloaded").catch(() => undefined);
	await page.waitForTimeout(settleMs);
}

export type CaptureOptions = {
	/** 撮影前に待つ時間 (ms)。アニメーション・画像読み込みが重い画面では長めにする */
	settleMs?: number;
	/** ページ全体を撮るか（既定はビューポートのみ。RN Web はほぼ全画面固定レイアウトのため false が自然） */
	fullPage?: boolean;
};

/**
 * 定義済みの画面を撮影し、結果を JSON に記録する。
 *
 * 呼び出し側は「その画面が表示されている」ことを先に expect で確定させてから呼ぶこと。
 * （この関数は待つだけで、正しい画面かどうかの判定は行わない）
 *
 * @param page 対象ページ（撮影したい画面が表示されている状態）
 * @param id catalog/screens.json の画面 ID
 */
export async function captureScreen(page: Page, id: string, options: CaptureOptions = {}): Promise<void> {
	const screen = getScreen(id);
	const info = test.info();
	const file = `${screen.id}.png`;
	const destination = path.join(SCREENSHOT_DIR, file);

	fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	await settle(page, options.settleMs ?? 700);
	await page.screenshot({
		path: destination,
		fullPage: options.fullPage ?? false,
		// スクロールバーやカーソル点滅で差分が出ないよう、アニメーションと caret は止める
		animations: "disabled",
		caret: "hide",
	});

	const viewport = page.viewportSize();
	writeResult({
		id: screen.id,
		captured: true,
		file,
		capturedUrl: page.url(),
		project: info.project.name,
		viewport: viewport ? `${viewport.width}x${viewport.height}` : null,
	});

	// HTML レポートからも辿れるように添付する（Artifact をブラウズせずに確認できる）
	await info.attach(file, { path: destination, contentType: "image/png" });
}

/**
 * 実データに依存する画面を「撮れたら撮る」で取得する。
 *
 * UI カタログの目的は網羅であって検証ではないため、
 * dev 環境のデータ次第で到達できない画面（保存 0 件・通知 0 件など）で
 * ジョブ全体を赤くしない。撮れなかったことは結果 JSON と一覧表に必ず残す。
 *
 * @param page 対象ページ
 * @param id catalog/screens.json の画面 ID
 * @param navigate その画面へ到達するための操作（失敗しうる）
 */
export async function captureScreenIfReachable(
	page: Page,
	id: string,
	navigate: () => Promise<void>,
	options: CaptureOptions = {},
): Promise<boolean> {
	const screen = getScreen(id);
	try {
		await navigate();
		await captureScreen(page, id, options);
		return true;
	} catch (error) {
		const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
		writeResult({
			id: screen.id,
			captured: false,
			file: `${screen.id}.png`,
			capturedUrl: page.url(),
			project: test.info().project.name,
			viewport: null,
			skipReason: reason,
		});
		test.info().annotations.push({ type: "ui-catalog-skipped", description: `${screen.id}: ${reason}` });
		// CI ログにも残す。撮れなかった理由は Artifact を落とさないと分からない、では調査に手間がかかる
		console.log(`⚠️  UI カタログ: ${screen.id} を取得できませんでした — ${reason}`);
		return false;
	}
}
