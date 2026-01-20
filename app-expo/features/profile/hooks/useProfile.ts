import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useCallback } from "react";
import { useFileUploader } from "@/hooks/useFileUploader";
import { UpdateUserProfileDto } from "@shared/api/v1/dto";
import { supabase } from "@/lib/supabase";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/contexts/AuthProvider";

export function useProfile() {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { uploadFile } = useFileUploader();
	const { getSession } = useAuth();
	const { locale } = useLocale();

	/**
	 * ユーザープロフィールを作成する（存在しなければ）
	 * @param displayName - 表示名（オプション）
	 * @param avatar - プロバイダーから取得したアバター画像のURI（オプション）
	 */
	const createUserProfile = useCallback(
		async ({ displayName, avatar }: { displayName?: string; avatar?: string }) => {
			const user = getSession()?.user;
			if (!user) return;

			try {
				// 既存のユーザープロフィールをチェック
				const { data: existingProfileId, error: fetchError } = await supabase
					.from("users")
					.select("id")
					.eq("id", user.id)
					.single<string>();

				if (fetchError && fetchError.code !== "PGRST116") {
					// PGRST116 = not found, それ以外のエラーは投げる
					throw fetchError;
				}

				if (!existingProfileId) {
					// ユーザープロフィールが存在しない場合のみ作成
					const timestamp = Date.now();
					const randomSuffix = Math.floor(Math.random() * 1000)
						.toString()
						.padStart(3, "0");
					const username = `user${(timestamp + parseInt(randomSuffix)).toString().slice(0, 13)}`;

					// users テーブルに新規レコードを挿入
					const { error: insertError } = await supabase.from("users").insert({
						id: user.id,
						username,
						display_name: displayName || "nickname",
						preferred_locale: locale,
					});
					if (insertError) throw insertError;

					if (avatar) {
						// プロフィール画像をアップロードしてパスを保存
						const res = await fetch(avatar, { cache: "no-store" });
						if (!res.ok) throw new Error(`Failed to fetch avatar image: ${res.status}`);
						const blob = await res.blob();
						let mimeType = blob.type;
						mimeType = mimeType ?? res.headers.get("content-type") ?? "image/jpeg"; // MIMEタイプが不明な場合のフォールバック
						const uploadedAvatarPath = await uploadFile(avatar, {
							mimeType,
							baseFileName: "user-avatar",
						});
						await callBackend<UpdateUserProfileDto, void>("v1/users/me", {
							method: "POST",
							requestPayload: {
								avatar_path: uploadedAvatarPath,
							},
						});
					}

					logFrontendEvent({
						event_name: "user_profile_created",
						error_level: "log",
						payload: { user_id: user.id, username },
					});
				}
			} catch (error) {
				logFrontendEvent({
					event_name: "user_profile_creation_error",
					error_level: "error",
					payload: { user_id: user.id, error: (error as Error).message },
				});
				// プロフィール作成エラーは致命的ではないので、ログのみ
			}
		},
		[locale, logFrontendEvent, uploadFile, callBackend],
	);
	return { createUserProfile };
}
