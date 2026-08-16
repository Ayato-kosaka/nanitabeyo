import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useCallback } from "react";
import { useFileUploader } from "@/hooks/useFileUploader";
import type { UpdateUserProfileDto } from "@shared/api/v1/dto";
import { supabase } from "@/lib/supabase";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * #1233 【設計】Postgres の unique_violation（SQLSTATE 23505）。
 * PostgREST は SQLSTATE をそのまま `error.code` に載せてくるので、
 * `users_pkey` 衝突（= 同じ user.id で別の呼び出しが先に INSERT した）はこの値で判別できる。
 * PostgREST 独自コード（PGRST116 = 0 rows）とは名前空間が違うため取り違えない。
 */
const POSTGRES_UNIQUE_VIOLATION = "23505";

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
	 *
	 * #1233 【設計】この関数はサインイン直後に **複数箇所から並走して呼ばれる**:
	 * - `app/[locale]/auth/callback.tsx`（OAuth 復帰。displayName / avatar を持つ）
	 * - `features/profile/hooks/useEnsureOwnProfileLoaded.ts`（404 を見て作成。引数なし）
	 *
	 * #1359 かつては SMS ログイン（displayName のみ）も呼び出し元だったが、電話番号ログインの
	 * 削除に伴い無くなった。復活させる場合は 3 つ目の並走元として戻ることになる。
	 *
	 * 【バグ】そのため「SELECT で無いことを確認 → INSERT」の間に別の呼び出しが INSERT を
	 * 通してしまい、後発が `duplicate key value violates unique constraint "users_pkey"` で
	 * 落ちていた（TOCTOU）。プロフィール自体は先着が作っているので実害はレコードではなく、
	 * **後発が持っていたアバター画像の反映が catch に落ちて丸ごとスキップされる**こと。
	 * 引数を持たない `useEnsureOwnProfileLoaded` が先着すると、OAuth 由来のアバターが消える。
	 *
	 * 【修正】衝突は異常ではなく「他の呼び出しが一足先に作った」という正常系として扱い、
	 * 後続のアバター反映まで処理を続行する。SELECT は競合していない大多数のケースで
	 * 無駄な INSERT を避けるための先読みとして残してあり、正しさの担保ではない。
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

					// #1233 【修正】主キー衝突だけは throw せずに続行する。ここで throw すると
					// 下のアバターアップロードと v1/users/me への反映がスキップされる（これが Issue の実害）。
					// 衝突以外の INSERT エラー（RLS 違反・NOT NULL 違反など）は従来どおり
					// user_profile_creation_error として error レベルで残したいので投げ直す。
					const didConflict = !!insertError && insertError.code === POSTGRES_UNIQUE_VIOLATION;
					if (insertError && !didConflict) throw insertError;

					if (didConflict) {
						// 起票対象にはしないが、並走の頻度は追えるようにしておく
						logFrontendEvent({
							event_name: "user_profile_create_conflict",
							error_level: "warn",
							payload: { user_id: user.id, error: insertError?.message },
						});
					}

					if (avatar) {
						// #1233 【設計】衝突した側もここへ来る。衝突時点の行は「たった今別の呼び出しが
						// INSERT したばかり」で avatar_path を持たない（INSERT 文に avatar_path が無い）ため、
						// アバターを入れてもユーザーが選んだ画像を潰すことはない。
						//
						// 一方で display_name はここへ載せない。INSERT は
						// `displayName || "nickname"` を必ず書き込むので、引数を持たない
						// `useEnsureOwnProfileLoaded` が先着した行に対して後発が上書きすると
						// **既に入っている名前を "nickname" に落とす**経路ができてしまう。
						// 名前の変更はプロフィール編集画面（v1/users/me）の責務に寄せる。
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

					if (!didConflict) {
						// 衝突した側は「作った」わけではないので created は出さない（1 人 1 行に対して 2 件出る）
						logFrontendEvent({
							event_name: "user_profile_created",
							error_level: "log",
							payload: { user_id: user.id, username },
						});
					}
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
