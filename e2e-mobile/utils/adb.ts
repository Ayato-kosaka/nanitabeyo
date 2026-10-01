import { execFileSync } from "node:child_process";

import { device } from "detox";

/**
 * 🔌 adb を同期で呼ぶための唯一の入口
 *
 * ## なぜ 1 本に集約するのか（#1579 【バグ】2026-09-30 の夜間 iOS が 1 suite も走らなかった）
 *
 * `utils/locale.ts` の実行時ロケール観測に «1 回目で取れなければ `adb wait-for-device` で
 * 再接続を待ってから試し直す» を入れた（[PR #2091](https://github.com/Ayato-kosaka/nanitabeyo/pull/2091)）。
 * `adb wait-for-device` は **指定シリアルの端末が現れるまで無限に待つ**（上限が無い）。
 *
 * - macOS ランナーには Android SDK Platform-Tools が入っている
 *   （`ANDROID_SDK_ROOT=/Users/runner/Library/Android/sdk`）。つまり **iOS でも `adb` は在る**
 * - iOS の `device.id` はシミュレータの UDID なので、その端末は **永遠に現れない**
 * - 観測は `fixtures/e2e.ts` の **モジュール評価時**（`describeJapaneseLocale`）に走る。
 *   `fixtures/e2e.ts` は全 spec が import するので、**最初の spec の import で jest が固まる**
 *
 * 結果、[run 36787284601](https://github.com/Ayato-kosaka/nanitabeyo/actions/runs/36787284601) の
 * iOS 2 シャードは globalSetup の 2 行を出したあと **3 時間半 無言**で、240 分の
 * `timeout-minutes` に当たって `cancelled` になった（`assert-suite-coverage` は両シャードとも
 * **報告 0 / 期待 23**）。Android は端末が在るので `wait-for-device` が即返り、気付けなかった。
 *
 * ## 欠陥を 1 文で言うと
 *
 * **«観測のための待機» に上限が無く、しかもテスト本体より前に走るので、落ちずに全 suite が消えた。**
 *
 * これは «skip は pass ではない»（{@link import("./locale").getAndroidRuntimeLocale}）と同じ家族で、
 * 症状が «黙って縮む» から «黙って止まる» に変わっただけである。だから直し方も同じ形にする:
 *
 * 1. **上限を付ける。** adb は «相手の都合で返ってこない» ことがある外部コマンドなので、
 *    呼び出し 1 回ごとに `timeout` を課す。超えたら例外 = «観測できなかった» に落ちる
 * 2. **入口を 1 本にする。** 上限の有無が呼び出し側ごとにばらけると、次に誰かが
 *    ブロックする adb サブコマンドを足したときに同じ事故が起きる。
 *    `scripts/assert-adb-sync-timeout.mjs` が «ここを通さない adb 呼び出し» を CI で落とす
 * 3. **Android 以外では触らない。** {@link isAndroidDevice} で先に降りる
 */

/**
 * adb 1 回あたりの上限（ms）。
 *
 * `adb shell` は通常 1 秒未満、`dumpsys meminfo` でも数秒で返る。30 秒は «端末が居るのに
 * 返ってこない = 何かが詰まっている» と判断してよい長さで、jest の 1 テストの上限より十分短い。
 */
export const ADB_TIMEOUT_MS = 30_000;

export type AdbSyncOptions = {
	/** 上限（ms）。既定は {@link ADB_TIMEOUT_MS} */
	timeoutMs?: number;
	/** stdout の上限（byte）。`dumpsys` 系は既定の 1 MB を超えることがある */
	maxBuffer?: number;
};

/**
 * 現在の Detox デバイスに対して adb コマンドを同期実行する。
 *
 * @param args adb のサブコマンド（`-s <deviceId>` は自動で前置する）
 * @returns 標準出力（前後の空白を除去したもの）
 * @失敗時 adb が無い / コマンドが失敗した / **上限を超えた** 場合は例外を投げる。
 *   呼び出し側は «観測できなかった» として扱うこと（«否定的な結論» にしてはいけない）
 */
export function adbSync(args: string[], options: AdbSyncOptions = {}): string {
	return execFileSync("adb", ["-s", device.id, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		// ⚠️ ここを外さないこと（理由はこのファイル冒頭）。超過時は SIGTERM で殺して例外になる
		timeout: options.timeoutMs ?? ADB_TIMEOUT_MS,
		maxBuffer: options.maxBuffer,
	}).trim();
}

/**
 * いま走っているデバイスが Android か。
 *
 * ⚠️ **判定できなかったときは false を返す**（adb を触らない方へ倒す）。
 * Detox の初期化前にモジュール評価から呼ばれる経路があり、そこで `device.getPlatform()` は
 * 投げうる。«Android かもしれないから触ってみる» は #1579 の再発なので選ばない。
 */
export function isAndroidDevice(): boolean {
	try {
		return device.getPlatform() === "android";
	} catch {
		return false;
	}
}
