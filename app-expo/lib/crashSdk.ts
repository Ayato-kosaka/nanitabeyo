import { Platform } from "react-native";
import { Env } from "@/constants/Env";

/*
#1375（オーナー指摘「クラッシュはマップ画面だけじゃない」）
**ネイティブのクラッシュを «その瞬間» に、原因つきで捕まえる層。**

## なぜ `lib/crashReporting.ts` と別なのか

`crashReporting.ts` は **OTA で配れる範囲**（JS の例外・未処理の Promise・
«前回が落ちて終わった» の記録）を担当する。あちらは依存を 1 つも増やさない。

こちらは `@react-native-firebase/crashlytics`（＝ネイティブ差分）に触るので、
**このブランチ（ネイティブ変更を集めるブランチ）にだけ存在する。**
OTA ブランチへ混ぜると、ネイティブ差分ゼロという前提が崩れて EAS Build が要るようになる。

## なぜ Sentry ではなく Crashlytics なのか（#1641 でオーナー判断）

最初は `@sentry/react-native` を入れたが、**このリポジトリに Sentry は他に 1 つも無い**。
入れると «新しい業者・新しい秘密情報・新しい料金» が増え、そのうえ

- DSN（`EXPO_PUBLIC_SENTRY_DSN`）が未設定なので、**現状 1 件も届かない**
- config plugin が release ビルドでソースマップを送るため、資格情報の無い CI では
  ビルドごと落ちる（Detox の Android ビルドで実際に落とした。run 32842669247）

という状態だった。一方 Firebase は **既に入っている**
（`@react-native-firebase/app` + `/perf`、`google-services.json` /
`GoogleService-Info.plist` も配置済み）。Crashlytics はその兄弟パッケージなので、
**業者も秘密情報も増えず、DSN のような «設定しないと動かない» 段も無い。**

## 読み込み方（ここが要）

`require` を try/catch で包み、**モジュールが無いビルドでは何もせず縮退**する。
このリポジトリの `ExternalEmbedPlayer`（react-native-webview）と同じ作法である。
これにより、

- この層を含まないビルド（＝現行の配信ビルド）でも `installCrashSdk()` は安全に no-op
- OTA でこのファイルが降ってきても、ネイティブ側に SDK が無ければ落ちない

⚠️ **web では読み込まない。** web は既存の `frontend_event_logs` で足りており、
ここでネイティブ SDK を引くとバンドルに無用な重さが乗る。
*/

/** 初期化済みか。二重初期化は無害だが、属性の再送も無駄なので自前で止める */
let initialized = false;

type CrashlyticsInstance = {
	setCrashlyticsCollectionEnabled?: (enabled: boolean) => Promise<unknown>;
};

type CrashlyticsModule = {
	getCrashlytics: () => CrashlyticsInstance;
	setCrashlyticsCollectionEnabled: (instance: CrashlyticsInstance, enabled: boolean) => Promise<unknown>;
	setAttributes: (instance: CrashlyticsInstance, attributes: Record<string, string>) => Promise<unknown>;
};

/** モジュールが無いビルドでは null を返す（縮退の唯一の入口） */
export function loadCrashlytics(): CrashlyticsModule | null {
	if (Platform.OS === "web") return null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const mod = require("@react-native-firebase/crashlytics") as CrashlyticsModule | undefined;
		return mod && typeof mod.getCrashlytics === "function" ? mod : null;
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
	const mod = loadCrashlytics();
	if (!mod) return false;

	const crashlytics = mod.getCrashlytics();
	/*
	⚠️ **収集を明示的に有効にする。** `firebase.json` の
	`crashlytics_auto_collection_enabled` に頼ると «設定ファイルを消した瞬間に
	黙って何も届かなくなる» ので、コード側でも必ず立てる。
	*/
	void mod.setCrashlyticsCollectionEnabled(crashlytics, true)?.catch?.(() => {});
	/*
	#1375 どのビルドで落ちたかを追えるようにする。OTA で JS だけ差し替わるので、
	**アプリのバージョンだけでは «どのコードか» が決まらない**（Sentry の dist に相当）。
	*/
	void mod
		.setAttributes(crashlytics, {
			app_version: Env.APP_VERSION ?? "",
			commit_id: Env.COMMIT_ID ?? "",
			environment: Env.NODE_ENV ?? "",
		})
		?.catch?.(() => {});

	initialized = true;
	return true;
}

/** テスト用。本番では呼ばない */
export function resetCrashSdkForTest(): void {
	initialized = false;
}
