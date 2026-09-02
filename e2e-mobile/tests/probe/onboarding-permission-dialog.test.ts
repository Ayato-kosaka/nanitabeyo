import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { LAUNCH_TIMEOUT, describeProbe, device, launchAppWithSession } from "../../fixtures/e2e";
import { LoginScreen } from "../../screens/LoginScreen";
import { OnboardingScreen } from "../../screens/OnboardingScreen";

/**
 * 🔬 #1736 「OS の許可ダイアログの **背後に何が描かれているか**」を実機の絵で確定させる @probe
 *
 * ## なぜ通常の spec では見えないのか
 *
 * Detox は APK を **実行時権限を付与した状態で**インストールするため、権限の説明画面は
 * `probe`（`getForegroundPermissionsAsync`）が `granted` を返して素通りする。
 * つまり tests/search/onboarding.test.ts が緑でも「ダイアログが出ているときの見た目」は
 * 1 度も検証されていない（run 33388750620 の動画でも、位置情報の画面は一瞬で通過している）。
 *
 * そこで **この spec の中だけ** 位置情報の権限を `pm revoke` で剥がし、本物のダイアログを出す。
 *
 * ## 何を撮るか
 *
 * ダイアログが出た瞬間、Android はアプリの Activity を `onPause` にする。React Native は
 * `onHostPause` で JS のタイマーを止めるため、**タイマー依存の描画はそこで凍る**。
 * 修正前の説明画面は「要求 → 400ms 後に説明を描く」構造だったので、この 400ms が永久に来ず、
 * 無地の画面の上にダイアログだけが出ていた（オーナーの実機報告）。
 *
 * 撮った絵は `e2e-mobile/artifacts/probe-location-permission-dialog.png` として Artifact に残る。
 * **修正前**: ダイアログの背後が無地 / **修正後**: 見出し・本文・ダミーダイアログが描かれている。
 *
 * 実測（修正前 / run 33390685508、commit c675ac4）: 背後は**完全な無地**で、
 * Detox も «There are enqueued timers» のまま 84 秒待って落ちた。
 * ダイアログ表示中に JS のタイマーが止まる、という診断そのものがこのログにも出ている。
 *
 * ⚠️ アサーションは «アプリが止まっている間の Detox» に頼らない。ダイアログが前面にある間は
 * Detox の同期機構が window focus を待って進めないため、判定はスクリーンショットで行う
 *（`.claude/skills/evidence-video/SKILL.md` の `has-window-focus=false` の項）。
 * ここは «絵を残すこと» が目的の probe なので、spec 自体は緑で終わってよい。
 */
describeProbe("#1736 位置情報の許可ダイアログの背後 @probe", () => {
	const onboarding = new OnboardingScreen();
	const login = new LoginScreen();

	const APP_ID = "com.nanitabeyo";
	const LOCATION_PERMISSIONS = ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION"];

	const adb = (...args: string[]): Buffer =>
		execFileSync("adb", ["-s", device.id, ...args], { maxBuffer: 64 * 1024 * 1024 });

	it("ダイアログが出ている瞬間の画面を撮る", async () => {
		if (device.getPlatform() !== "android") {
			console.log("[#1736] Android 専用の probe（iOS の許可ダイアログは launchApp で付与済み）");
			return;
		}

		// Detox は付与済みでインストールするので、剥がして «未回答» に戻す
		for (const permission of LOCATION_PERMISSIONS) {
			try {
				adb("shell", "pm", "revoke", APP_ID, permission);
			} catch (error) {
				console.log(`[#1736] ⚠️ ${permission} を revoke できなかった: ${String(error)}`);
			}
		}

		await launchAppWithSession({ as: "anon", tutorialSeen: false, waitForReady: false });
		await onboarding.expectShown(LAUNCH_TIMEOUT);
		await onboarding.advanceToLastStep();
		await onboarding.revealSolution(3);
		await onboarding.pressNext();

		// ログインはスキップする。ログイン経由の «2 枚生える» 側（#1736 原因 1）は
		// dev の frontend ログで確定しており、ここで見たいのは «背後の描画» だけ
		await login.expectOpened();

		// ⚠️ **スキップを押す前に同期を切る。** この 1 押下で許可画面へ進み、OS のダイアログが
		// 出てアプリは paused になる。Detox は «enqueued timers» が捌けるのを待ち続けるので、
		// 同期を入れたままだと tap の Promise が返らずタイムアウトする
		//（run 33390685508 で実測: 84 秒待って失敗。**その瞬間の絵は撮れていた**）。
		await device.disableSynchronization();
		await login.skip();

		// ここから先は «アプリが止まっている» 前提で、素の setTimeout と adb だけで進める
		await new Promise<void>((resolve) => setTimeout(resolve, 3_000));

		const png = adb("exec-out", "screencap", "-p");
		const artifactsDir = join(__dirname, "..", "..", "artifacts");
		mkdirSync(artifactsDir, { recursive: true });
		const file = join(artifactsDir, "probe-location-permission-dialog.png");
		writeFileSync(file, png);
		console.log(`[#1736] 許可ダイアログ表示中のスクリーンショット: ${file}（${png.length} bytes）`);

		// 撮り終えたらダイアログを閉じ、後続へ «開きっぱなし» を持ち越さない
		adb("shell", "input", "keyevent", "KEYCODE_BACK");
		await device.enableSynchronization();
	});
});
