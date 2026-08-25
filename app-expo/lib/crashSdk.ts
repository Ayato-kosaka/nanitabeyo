import { Platform } from "react-native";
import { Env } from "@/constants/Env";

/*
#1375（オーナー指摘「クラッシュはマップ画面だけじゃない」）
**ネイティブのクラッシュを «その瞬間» に、原因つきで捕まえる層。**

## なぜ `lib/crashReporting.ts` と別なのか

`crashReporting.ts` は **OTA で配れる範囲**（JS の例外・未処理の Promise・
«前回が落ちて終わった» の記録）を担当する。あちらは依存を 1 つも増やさない。

こちらは `@sentry/react-native`（＝ネイティブ差分）に触るので、
**このブランチ（ネイティブ変更を集めるブランチ）にだけ存在する。**
OTA ブランチへ混ぜると、ネイティブ差分ゼロという前提が崩れて EAS Build が要るようになる。

## 読み込み方（ここが要）

`require` を try/catch で包み、**モジュールが無いビルドでは何もせず縮退**する。
このリポジトリの `ExternalEmbedPlayer`（react-native-webview）と同じ作法である。
これにより、

- この層を含まないビルド（＝現行の配信ビルド）でも `installCrashSdk()` は安全に no-op
- OTA でこのファイルが降ってきても、ネイティブ側に SDK が無ければ落ちない

## DSN が無ければ何もしない

`EXPO_PUBLIC_SENTRY_DSN` が空なら初期化しない。**キーをコードに埋めない**ためと、
未設定の環境（ローカル・E2E）で «送信できない» 例外を出さないため。

⚠️ **web では読み込まない。** web は既存の `frontend_event_logs` で足りており、
ここでネイティブ SDK を引くとバンドルに無用な重さが乗る。
*/

/** 初期化済みか。二重初期化は Sentry 側が警告を出すので自前でも止める */
let initialized = false;

type SentryLike = {
	init: (options: Record<string, unknown>) => void;
	captureException?: (error: unknown) => void;
};

/** モジュールが無いビルドでは null を返す（縮退の唯一の入口） */
export function loadSentry(): SentryLike | null {
	if (Platform.OS === "web") return null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("@sentry/react-native") as SentryLike | undefined;
		return mod && typeof mod.init === "function" ? mod : null;
	} catch {
		return null;
	}
}

/**
 * クラッシュレポートを仕掛ける。**アプリ起動時に 1 回だけ呼ぶ。**
 *
 * @returns 実際に初期化したか（テストと、状況をログに残すため）
 */
export function installCrashSdk(): boolean {
	if (initialized) return false;
	const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
	if (!dsn) return false;
	const sentry = loadSentry();
	if (!sentry) return false;

	sentry.init({
		dsn,
		// #1375 どのビルドで落ちたかを追えるようにする。OTA で JS だけ差し替わるので、
		// アプリのバージョンだけでは «どのコードか» が決まらない
		release: Env.APP_VERSION,
		dist: Env.COMMIT_ID,
		environment: Env.NODE_ENV,
		// ⚠️ 性能計測（tracesSampleRate）は **入れない**。ここで欲しいのはクラッシュだけで、
		// トレースを入れると送信量と端末負荷が増える。必要になったら別途オーナーへ諮る
		enableAutoPerformanceTracing: false,
		// 個人が特定されうる既定の収集を切る（この用途では原因の特定に不要）
		sendDefaultPii: false,
	});
	initialized = true;
	return true;
}

/** テスト用。本番では呼ばない */
export function resetCrashSdkForTest(): void {
	initialized = false;
}
