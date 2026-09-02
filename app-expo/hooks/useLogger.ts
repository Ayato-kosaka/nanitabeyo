import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { getRemoteConfig } from "../lib/remoteConfig";
import { Env } from "../constants/Env";
import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { UNKNOWN_BUILD_META_CLIENT } from "@shared/api/v1/constants/build-meta";
import { enqueueLog, flushLogQueue } from "@/lib/logQueue";

/**
 * ログレベルの優先度マッピング。
 */
const errorLevelPriority: Record<CreateFrontendLogDto["error_level"], number> = {
	verbose: 0,
	debug: 1,
	log: 2,
	warn: 3,
	error: 4,
};

type FrontendEventLogInput = {
	event_name: string;
	error_level: CreateFrontendLogDto["error_level"];
	payload: Record<string, any>;
	/**
	 * #1641 溜めずに **その場で送り切る**。既定は false（バッチに任せる）。
	 *
	 * バッチは «アプリが生き続ける» 前提の最適化である。直後にアプリが止まる種類の記録
	 * — 落ちる寸前の不具合や、e2e が数秒後に落とす種類の事象 — は、待たせると
	 * **いちばん欲しい 1 行が毎回そこで消える**（run 33408324285 / 33411032551 で 2 回とも消えた）。
	 *
	 * ⚠️ 常用しないこと。1 行ごとに HTTP が 1 本増える。«消えたら困る» ものだけに付ける。
	 */
	flushNow?: boolean;
};

/**
 * 📄 ログ記録用のカスタムフック。
 * #489 【設計】フロントログ送信経路変更（Supabase → Backend API 経由）
 *
 * `useLogger()` を呼び出すことで `logFrontendEvent()` を利用可能になる。
 * - user_id は Supabase Auth から自動取得（オプション）
 * - path_name は `usePathname()` により自動補完
 *
 * @returns `logFrontendEvent()` ログ送信関数
 */
export const useLogger = () => {
	const pathname = usePathname();

	const pathRef = useRef(pathname);
	useEffect(() => {
		pathRef.current = pathname;
	}, [pathname]);

	/**
	 * フロントエンドイベントログをローカルキューへ蓄積する。
	 * 実際の Backend API への送信は lib/logQueue.ts が一定間隔/件数でバッチ処理する。
	 *
	 * @param event_name - イベント名称（例: "onCapture", "playAudio" など）
	 * @param error_level - エラーレベル（"verbose", "debug", "log", "warn", "error" のいずれか）
	 * @param payload - 任意の付加情報（オブジェクト形式）
	 */
	const logFrontendEvent = useCallback(async ({ event_name, error_level, payload, flushNow }: FrontendEventLogInput) => {
		const path_name = pathRef.current;
		try {
			const remoteConfig = getRemoteConfig();
			const currentLevel = remoteConfig?.v1_min_frontend_log_level ?? "debug";

			// ログレベルが現在の閾値よりも低ければ記録しない
			if (errorLevelPriority[error_level] < errorLevelPriority[currentLevel]) {
				return;
			}

			const now = new Date().toISOString();

			const logDto: CreateFrontendLogDto = {
				event_name,
				path_name,
				payload,
				error_level,
				created_at: now,
				// #1078 Env.APP_VERSION は x-app-version ヘッダ(lib/fetchWithAuth.ts)にも使われ、
				// そこへ非バージョン文字列が乗ると maintenance.guard の NaN 比較で全 API が 426 になる。
				// そのため Env.ts 側に既定値は置かず、ログ組み立て時のここだけに閉じる。
				created_app_version: Env.APP_VERSION || UNKNOWN_BUILD_META_CLIENT,
				// COMMIT_ID の既定値は参照元が本行のみのため Env.ts 側で解決済み
				created_commit_id: Env.COMMIT_ID,
			};

			// #1012 【設計】即時送信ではなくキューへ蓄積し、バッチ送信(#1011)にまとめる
			enqueueLog(logDto);
			// #1641 直後にアプリが止まる種類の記録は、バッチを待たずに送り切る（上の flushNow を参照）
			if (flushNow) flushLogQueue();

			if (Env.NODE_ENV === "development") {
				console.log(`📤 [${error_level}] [${path_name}] ${event_name}`, payload);
			}
		} catch (err: any) {
			// 【設計】送信失敗は黙殺（ログ出力のみ）
			if (Env.NODE_ENV === "development") {
				console.error(`🚨 Failed to log event [${event_name}] on screen [${path_name}]`, {
					message: err.message,
					full: err,
				});
			}
		}
	}, []);

	return { logFrontendEvent };
};
