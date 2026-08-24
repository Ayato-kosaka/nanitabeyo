import { execFileSync } from "node:child_process";

import { device } from "detox";

/**
 * 📵 端末のネットワークを一時的に落とすヘルパ（Android エミュレータ専用）
 *
 * ## なぜ必要か（#1501 / DAT-01）
 * 「API が失敗したときに楽観更新をロールバックする」ことを検証するには、
 * **API を失敗させる手段**が要る。e2e-web は `page.route()` でリクエストを差し替えられるが、
 * **Detox には `page.route()` に相当する仕組みが無い**
 * （tests/mutation/review-submit-loading.test.ts の「web 側とのカバレッジ差」に同じ記述がある）。
 * app-expo 側の E2E フック（`lib/e2e/`）にもネットワークを差し替えるものは存在しない。
 *
 * そこで **端末側の通信そのものを落とす**。これならアプリにテスト専用の分岐を足さずに済み、
 * `useAPICall` から見れば通常のネットワークエラーと区別が付かないので、
 * 検証したい catch 経路をそのまま通せる。
 *
 * ## ⚠️ `device.setURLBlacklist` は使えない
 * あれは **Detox の同期機構（idle 判定）から特定 URL を除外する**だけで、
 * リクエストをブロックしない。呼んでも API は普通に成功する。
 *
 * ## ⚠️ Android 専用である
 * iOS シミュレータには通信を落とす公式手段が無い（`device.setStatusBar` は見た目だけ）。
 * iOS では {@link isNetworkControlAvailable} が false を返すので、
 * 呼び出し側は spec ごと skip すること（黙って通信ありのまま走らせると
 * 「テストは緑だが検証内容が嘘」になる）。
 *
 * ## ⚠️ 必ず戻すこと
 * 落としたまま次の spec へ持ち越すと、後続が軒並みネットワークエラーで落ちる。
 * 呼び出し側は `afterEach` で必ず {@link enableNetwork} を呼ぶこと。
 * Detox 自身とアプリの通信は adb 経由のループバックなので、
 * `svc wifi/data disable` の影響を受けない（= 落としても操作は続けられる）。
 */

/** ネットワーク制御が使えるか（= Android で、かつ adb が動くか） */
export function isNetworkControlAvailable(): boolean {
	if (device.getPlatform() !== "android") return false;
	try {
		adb(["shell", "echo", "ok"]);
		return true;
	} catch {
		return false;
	}
}

/**
 * 端末の Wi-Fi / モバイルデータを落とす（= 以降の HTTP リクエストは即座に失敗する）。
 *
 * @失敗時 adb の実行に失敗した場合は例外を投げる。
 *   「落とせなかったのに落ちたつもりで検証する」と嘘の緑になるため、握り潰さない
 */
export function disableNetwork(): void {
	adb(["shell", "svc", "wifi", "disable"]);
	adb(["shell", "svc", "data", "disable"]);
}

/**
 * 端末の Wi-Fi / モバイルデータを戻す。
 *
 * 後片付け用なので **例外を投げない**（テスト本体の失敗を後始末の失敗で隠さない）。
 * 戻せなかった場合は警告を出す。
 *
 * @returns 戻せたら true
 */
export function enableNetwork(): boolean {
	try {
		adb(["shell", "svc", "wifi", "enable"]);
		adb(["shell", "svc", "data", "enable"]);
		return true;
	} catch (error) {
		console.warn(
			[
				"⚠️ 端末のネットワークを元に戻せませんでした。後続の spec がネットワークエラーで落ちる可能性があります。",
				"  手動で戻す場合: adb shell svc wifi enable && adb shell svc data enable",
				`  原因: ${String(error)}`,
			].join("\n"),
		);
		return false;
	}
}

/**
 * 現在の Detox デバイスに対して adb コマンドを実行する（utils/locale.ts と同じ実装）。
 *
 * @param args adb のサブコマンド（`-s <deviceId>` は自動で前置する）
 * @失敗時 adb が見つからない / コマンドが失敗した場合は例外を投げる
 */
function adb(args: string[]): string {
	return execFileSync("adb", ["-s", device.id, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}
