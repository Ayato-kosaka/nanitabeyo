import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { UNKNOWN_BUILD_META_CLIENT } from "@shared/api/v1/constants/build-meta";
import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { Env } from "@/constants/Env";
import { enqueueLog } from "@/lib/logQueue";

/*
#1375（実機: 「クラッシュはマップ画面だけじゃない」）

## なぜこれが要るのか

オーナーから «マップがクラッシュする» と言われたとき、**マップだけを調べた**。
根拠は「他の画面ではクラッシュの報告が無い」だったが、確認したところ

- クラッシュレポート SDK（Sentry / Crashlytics 等）は入っていない
- JS のグローバルエラーハンドラ（`ErrorUtils.setGlobalHandler`）も無い
- 未処理の Promise 拒否を拾う口も無い
- `ErrorBoundary` はあるが、**React のレンダー中の例外しか捕まえない**

という状態だった。つまり **«報告が無い» のではなく «観測できていない»** だけで、
オーナーが実機で踏んで言ってくるまで、誰も何も知れない構造だった。
3 往復続けて «なおってない» と言わせたのは、根本的にはこれが原因である。

## 何を捕まえるか（と、捕まえられないもの）

| 種類 | 例 | ここで捕まるか |
| --- | --- | --- |
| レンダー中の例外 | `entry is undefined` | 既存の `ErrorBoundary`（本ファイルの担当外） |
| レンダー外の JS 例外 | タップのハンドラ・タイマー・非同期の中で throw | ✅ `ErrorUtils` / `window.onerror` |
| 未処理の Promise 拒否 | `await` を付け忘れた失敗 | ✅（web は確実。ネイティブは下の注意） |
| **ネイティブのクラッシュ** | 地図のマーカーでヒープを食い潰す・OOM | ⚠️ 直接は捕まらない。**«前回が落ちて終わった» として次回起動で記録する** |

⚠️ ネイティブのクラッシュを «その瞬間» に捕まえるには、ネイティブの
クラッシュレポート SDK が要る（= 依存追加 = EAS Build が要る）。
それはオーナーの承認が要る別ブランチの作業なので、ここでは
**OTA で今すぐ配れる範囲**で «起きたこと» だけを次回起動時に記録する。
どの画面で落ちたかが分かるので、«マップだけなのか» の問いには答えられるようになる。

## 誤検知を出さない作り

正常終了（ホームに戻す・タスクから消す）では、`AppState` が background へ移った時点で
印を消す。したがって印が残っているのは **前面に居るまま突然終わった**ときだけである。
アプリの更新・端末の再起動でも残ることはあるが、そのときも «直前の画面» は記録に値する。
*/

/** 「このセッションはまだ生きている」印。次の起動時にこれが残っていたら前回は落ちている */
const LIVE_SESSION_KEY = "crash:liveSession:v1";

/** 前回の異常終了を表すイベント名。BigQuery の error-triage がこの名前で拾う */
export const PREVIOUS_SESSION_CRASHED_EVENT = "previous_session_terminated";
/** レンダー外の JS 例外 */
export const JS_UNCAUGHT_ERROR_EVENT = "js_uncaught_error";
/** 未処理の Promise 拒否 */
export const JS_UNHANDLED_REJECTION_EVENT = "js_unhandled_rejection";

type LiveSession = {
	/** 起動時刻（ISO） */
	startedAt: string;
	/** 最後に居た画面。ここが «どこで落ちたか» になる */
	pathName: string | null;
	appVersion: string;
	commitId: string;
	platform: string;
};

/**
 * フックの外からログを積む。
 *
 * `useLogger` はパス名の補完のために React のフックを使うので、ここでは使えない。
 * ⚠️ リモート設定によるログレベルの間引きは **通さない**。ここが積むのは
 * `error` だけで、既定のしきい値（debug）より必ず上なので結果が変わらないうえ、
 * 「クラッシュしたのにリモート設定次第で記録が消える」のは事故のもとである。
 */
const logCrashEvent = (event_name: string, path_name: string | null, payload: Record<string, unknown>): void => {
	try {
		const dto: CreateFrontendLogDto = {
			event_name,
			path_name: path_name ?? "unknown",
			payload,
			error_level: "error",
			created_at: new Date().toISOString(),
			created_app_version: Env.APP_VERSION || UNKNOWN_BUILD_META_CLIENT,
			created_commit_id: Env.COMMIT_ID,
		};
		enqueueLog(dto);
	} catch {
		// ここで投げると «クラッシュを記録しようとしてクラッシュする» になる。握り潰す
	}
};

/** 例外を、送っても安全で読める形にする。スタックは長すぎると payload が膨らむので先頭だけ */
const describeError = (value: unknown): Record<string, unknown> => {
	if (value instanceof Error) {
		return {
			message: value.message,
			name: value.name,
			// #1196 の fingerprint は payload.message を正規化して作る。スタックは診断用に先頭数行だけ
			stack: value.stack?.split("\n").slice(0, 8).join("\n"),
		};
	}
	return { message: typeof value === "string" ? value : JSON.stringify(value ?? null) };
};

let installed = false;
/** いま居る画面。ルート側から `setCrashReportingPathName` で更新してもらう */
let currentPathName: string | null = null;

/** 直前の画面を覚えておく。落ちたときに «どこで» を言えるようにするためだけに使う */
export function setCrashReportingPathName(pathName: string | null): void {
	currentPathName = pathName;
	if (!installed) return;
	// 画面が変わるたびに書き直す。AsyncStorage は非同期なので待たない（落ちる直前でも
	// «1 つ前の画面» までは残る）
	void writeLiveSession();
}

const writeLiveSession = async (): Promise<void> => {
	const session: LiveSession = {
		startedAt: new Date().toISOString(),
		pathName: currentPathName,
		appVersion: Env.APP_VERSION || UNKNOWN_BUILD_META_CLIENT,
		commitId: Env.COMMIT_ID,
		platform: Platform.OS,
	};
	try {
		await AsyncStorage.setItem(LIVE_SESSION_KEY, JSON.stringify(session));
	} catch {
		// 保存できなくても本体の動作には影響させない
	}
};

const clearLiveSession = async (): Promise<void> => {
	try {
		await AsyncStorage.removeItem(LIVE_SESSION_KEY);
	} catch {
		// 同上
	}
};

/**
 * 前回のセッションが «前面に居るまま突然終わった» なら、それを記録する。
 * 記録できたら true を返す（テストと、起動直後の 1 回だけ走らせるための戻り値）。
 */
export async function reportPreviousSessionCrash(): Promise<boolean> {
	let raw: string | null = null;
	try {
		raw = await AsyncStorage.getItem(LIVE_SESSION_KEY);
	} catch {
		return false;
	}
	if (!raw) return false;
	let previous: Partial<LiveSession> = {};
	try {
		previous = JSON.parse(raw) as Partial<LiveSession>;
	} catch {
		// 壊れていても «落ちた» という事実は残す
	}
	logCrashEvent(PREVIOUS_SESSION_CRASHED_EVENT, previous.pathName ?? null, {
		// ⚠️ message は fingerprint の素材。画面ごとに分かれてほしいので画面名を入れる
		message: `previous session terminated at ${previous.pathName ?? "unknown"}`,
		previousStartedAt: previous.startedAt,
		previousAppVersion: previous.appVersion,
		previousCommitId: previous.commitId,
		previousPlatform: previous.platform,
	});
	await clearLiveSession();
	return true;
}

/**
 * クラッシュの観測を仕掛ける。**アプリの起動時に 1 回だけ呼ぶ。**
 *
 * @returns 後片付け（テスト用）。本番では呼ばない
 */
export function installCrashReporting(): () => void {
	if (installed) return () => {};
	installed = true;

	// 1) 前回が落ちていたら、まずそれを記録する
	void reportPreviousSessionCrash().then(() => writeLiveSession());

	// 2) レンダー外の JS 例外
	//    `ErrorUtils` は React Native のグローバル。web には無いので `window.onerror` を使う
	const globalWithErrorUtils = globalThis as typeof globalThis & {
		ErrorUtils?: {
			getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
			setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
		};
	};
	let restoreGlobalHandler: (() => void) | undefined;
	const errorUtils = globalWithErrorUtils.ErrorUtils;
	if (errorUtils?.setGlobalHandler && errorUtils.getGlobalHandler) {
		const previousHandler = errorUtils.getGlobalHandler();
		errorUtils.setGlobalHandler((error, isFatal) => {
			logCrashEvent(JS_UNCAUGHT_ERROR_EVENT, currentPathName, {
				...describeError(error),
				isFatal: !!isFatal,
			});
			// ⚠️ 既定のハンドラを必ず呼ぶ。呼ばないと開発時の赤い画面が出なくなり、
			// **落ちるはずのものが黙って動き続ける**（より悪い）
			previousHandler?.(error, isFatal);
		});
		restoreGlobalHandler = () => errorUtils.setGlobalHandler(previousHandler);
	}

	// 3) web の例外と未処理の Promise 拒否
	//    ネイティブ（Hermes）は `addEventListener` を持たないので、ここは web だけが通る。
	//    ネイティブの未処理拒否は将来クラッシュレポート SDK を入れるときに拾う
	const webTarget = globalThis as typeof globalThis & {
		addEventListener?: (type: string, listener: (event: any) => void) => void;
		removeEventListener?: (type: string, listener: (event: any) => void) => void;
	};
	const onWindowError = (event: { error?: unknown; message?: string }) =>
		logCrashEvent(JS_UNCAUGHT_ERROR_EVENT, currentPathName, {
			...describeError(event?.error ?? event?.message),
			isFatal: true,
		});
	const onRejection = (event: { reason?: unknown }) =>
		logCrashEvent(JS_UNHANDLED_REJECTION_EVENT, currentPathName, describeError(event?.reason));
	if (typeof webTarget.addEventListener === "function") {
		webTarget.addEventListener("error", onWindowError);
		webTarget.addEventListener("unhandledrejection", onRejection);
	}

	// 4) 正常終了は «落ちた» と数えない。前面を離れたら印を消し、戻ってきたら付け直す
	const onAppStateChange = (state: AppStateStatus) => {
		if (state === "active") {
			void writeLiveSession();
		} else {
			void clearLiveSession();
		}
	};
	const subscription = AppState.addEventListener("change", onAppStateChange);

	return () => {
		installed = false;
		restoreGlobalHandler?.();
		if (typeof webTarget.removeEventListener === "function") {
			webTarget.removeEventListener("error", onWindowError);
			webTarget.removeEventListener("unhandledrejection", onRejection);
		}
		subscription.remove();
	};
}
