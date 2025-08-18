import { usePathname } from "expo-router";
import { useCallback } from "react";
import { supabase } from "../lib/supabase";
import * as Crypto from "expo-crypto";
import { getRemoteConfig } from "../lib/remoteConfig";
import { Env } from "../constants/Env";
import { EnumLiteral } from "@shared/utils/devDB.types";
import { DeepNonNullable } from "@shared/utils/types";
import { SupabaseFrontendEventLogs } from "@shared/converters/convert_frontend_event_logs";

/**
 * ログレベルの優先度マッピング。
 */
const errorLevelPriority: Record<EnumLiteral<"frontend_event_logs_error_level">, number> = {
	verbose: 0,
	debug: 1,
	log: 2,
	warn: 3,
	error: 4,
};

type FrontendEventLogInput = DeepNonNullable<
	Omit<
		SupabaseFrontendEventLogs,
		"id" | "user_id" | "path_name" | "payload" | "created_at" | "created_app_version" | "created_commit_id"
	>
> & {
	payload: Record<string, any>;
};

/**
 * 📄 ログ記録用のカスタムフック。
 *
 * `useLogger()` を呼び出すことで `logFrontendEvent()` を利用可能になる。
 * - user_id は Supabase Auth から自動取得
 * - path_name は `usePathname()` により自動補完
 *
 * @returns `logFrontendEvent()` ログ送信関数
 */
export const useLogger = () => {
	const path_name = usePathname();

	/**
	 * Supabase にフロントエンドイベントログを送信する。
	 *
	 * @param event_name - イベント名称（例: "onCapture", "playAudio" など）
	 * @param error_level - エラーレベル（"verbose", "debug", "log", "warn", "error" のいずれか）
	 * @param payload - 任意の付加情報（オブジェクト形式）
	 */

	const logFrontendEvent = useCallback(
		async ({ event_name, error_level, payload }: FrontendEventLogInput) => {
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
				const user = session?.user;

				const now = new Date().toISOString();

				await supabase.from("frontend_event_logs").insert({
					id: Crypto.randomUUID(),
					user_id: user?.id,
					event_name,
					path_name,
					payload: JSON.stringify(payload),
					error_level,
					created_at: now,
					created_app_version: Env.APP_VERSION,
					created_commit_id: Env.COMMIT_ID,
				});

				if (Env.NODE_ENV === "development") {
					console.log(`📤 [${error_level}] [${path_name}] ${event_name}`, payload);
				}
			} catch (err: any) {
				if (Env.NODE_ENV === "development") {
					console.error(`🚨 Failed to log event [${event_name}] on screen [${path_name}]`, {
						message: err.message,
						full: err,
					});
				}
			}
		},
		[path_name],
	);

	return { logFrontendEvent };
};
