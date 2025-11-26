import { usePathname } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { getRemoteConfig } from "../lib/remoteConfig";
import { Env } from "../constants/Env";
import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { Platform } from "react-native";
import { fetchWithAuth } from "./useAPICall";

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
	 * Backend API にフロントエンドイベントログを送信する。
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

			const {
				data: { session },
			} = await supabase.auth.getSession();
			const accessToken = session?.access_token;
			if (!accessToken) {
				throw new Error("User is not authenticated: Supabase access_token is missing.");
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

			await fetchWithAuth(
				"v1/logs/frontend",
				{
					method: "POST",
					requestPayload: logDto,
					isMultipart: false,
				},
				accessToken,
			);

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
