import * as fs from "node:fs";
import * as path from "node:path";

import { device } from "detox";

/**
 * 📸 UI カタログ用スクリーンショット取得ユーティリティ（Detox 版）
 *
 * e2e-web/utils/catalog.ts のネイティブ対応版。**画面定義は repo ルートの
 * `catalog/screens.json` を Web と共有する**（名前・URL・説明・遷移関係の二重管理を防ぐ）。
 *
 * ## Web 版との違い
 * - ファイル名は `<画面 ID>-<android|ios>.png`。同じ画面でも OS で見た目が変わるため、
 *   1 つの Artifact に両方入れても取り違えないよう OS 名を付ける
 * - `device.takeScreenshot()` が返す一時パスは **テスト終了までしか有効でない**ため、
 *   受け取った直後に自前のディレクトリへコピーする（Detox の artifacts プラグインの
 *   保存方針＝既定では失敗時のみ、に左右されないようにする）
 */

/** 取得方針（catalog/screens.json の platforms.<platform>.capture） */
export type CaptureLevel = "auto" | "optional" | "mutation" | "manual";

/** カタログ定義（1 画面分） */
export type ScreenDefinition = {
	id: string;
	name: string;
	route: string;
	url: string;
	platforms: Record<"web" | "mobile", { capture: CaptureLevel; session: "anon" | "authenticated"; note?: string }>;
	state: string | null;
	description: string;
	from: string[];
	to: string[];
	note?: string;
};

/** 取得結果（screenshots/.results/<file>.json の中身） */
export type CaptureResult = {
	id: string;
	captured: boolean;
	/** ファイル名（`<id>-<platform>.png`）。撮れなかった場合も「撮るはずだった名前」を残す */
	file: string;
	/** android / ios */
	platform: string;
	skipReason?: string;
};

const CATALOG_PATH = path.resolve(__dirname, "..", "..", "catalog", "screens.json");

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf-8")) as {
	schemaVersion: number;
	defaultLocale: string;
	screens: ScreenDefinition[];
};

/** カタログ定義の全画面 */
export const SCREENS: ScreenDefinition[] = catalog.screens;

/** スクリーンショットの出力先（`UI_CATALOG_DIR` で差し替え可能） */
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

/** 実行中のプラットフォーム（android / ios） */
export function currentPlatform(): string {
	return device.getPlatform();
}

/** 画面 ID からこの OS でのファイル名を組み立てる */
export function fileNameOf(id: string): string {
	return `${id}-${currentPlatform()}.png`;
}

function writeResult(result: CaptureResult): void {
	fs.mkdirSync(RESULT_DIR, { recursive: true });
	fs.writeFileSync(path.join(RESULT_DIR, `${result.file}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf-8");
}

/** 画面の描画・アニメーションが落ち着くのを待つ */
export async function settle(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 待ちの失敗を握りつぶして続行する。
 *
 * カタログでは「その画面に居ることを厳密に判定すること」より
 * **「その画面を撮れること」** の方が価値が高い場面がある
 * （例: グリッドが空でリストの testID が出ない、iOS で要素が画面外にある等）。
 * そういう待ちはこれで包み、撮影自体は必ず行う。
 */
export async function tolerate(action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error) {
		const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
		console.log(`ℹ️  UI カタログ: 待ちに失敗したが、そのまま撮影を続けます — ${reason}`);
	}
}

export type CaptureOptions = {
	/** 撮影前に待つ時間 (ms)。画像の読み込みやアニメーションが重い画面では長めにする */
	settleMs?: number;
};

/**
 * 定義済みの画面を撮影し、結果を JSON に記録する。
 *
 * 呼び出し側は「その画面が表示されている」ことを先に待ってから呼ぶこと
 * （この関数は待つだけで、正しい画面かどうかの判定は行わない）。
 */
export async function captureScreen(id: string, options: CaptureOptions = {}): Promise<void> {
	const screen = getScreen(id);
	const file = fileNameOf(screen.id);

	await settle(options.settleMs ?? 1_200);

	// Detox が返すのは一時ファイル。テスト終了後に移動・破棄されるため、その場でコピーする
	const temporaryPath = await device.takeScreenshot(screen.id);
	fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	fs.copyFileSync(temporaryPath, path.join(SCREENSHOT_DIR, file));

	writeResult({ id: screen.id, captured: true, file, platform: currentPlatform() });
}

/**
 * 実データ・端末状態に依存する画面を「撮れたら撮る」で取得する。
 *
 * UI カタログの目的は網羅であって検証ではないため、到達できない画面があっても
 * ジョブ全体を赤くしない。撮れなかったことは結果 JSON と一覧表に必ず残す。
 */
export async function captureScreenIfReachable(
	id: string,
	navigate: () => Promise<void>,
	options: CaptureOptions = {},
): Promise<boolean> {
	const screen = getScreen(id);
	try {
		await navigate();
		await captureScreen(id, options);
		return true;
	} catch (error) {
		const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
		writeResult({
			id: screen.id,
			captured: false,
			file: fileNameOf(screen.id),
			platform: currentPlatform(),
			skipReason: reason,
		});
		// Artifact を落とさずに CI ログだけで原因を追えるようにする
		console.log(`⚠️  UI カタログ: ${screen.id} を取得できませんでした — ${reason}`);
		return false;
	}
}
