import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { getRemoteConfig } from "../lib/remoteConfig";
import { Env } from "../constants/Env";
import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { enqueueLog } from "@/lib/logQueue";

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
	const logFrontendEvent = useCallback(async ({ event_name, error_level, payload }: FrontendEventLogInput) => {
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
				created_app_version: Env.APP_VERSION,
				created_commit_id: Env.COMMIT_ID,
			};

			// #1012 【設計】即時送信ではなくキューへ蓄積し、バッチ送信(#1011)にまとめる
			enqueueLog(logDto);

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
