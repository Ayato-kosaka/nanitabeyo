import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useCallback } from "react";
import { useFileUploader } from "@/hooks/useFileUploader";
import type { UpdateUserProfileDto } from "@shared/api/v1/dto";
import { supabase } from "@/lib/supabase";
import { useLocale } from "@/hooks/useLocale";
import { useAuth } from "@/contexts/AuthProvider";
import { generateUsername } from "../generateUsername";

/**
 * #1233 【設計】Postgres の unique_violation（SQLSTATE 23505）。
 * PostgREST は SQLSTATE をそのまま `error.code` に載せてくる。
 * PostgREST 独自コード（PGRST116 = 0 rows）とは名前空間が違うため取り違えない。
 *
 * ⚠️ #1599 このコードだけでは **どの UNIQUE でぶつかったかは分からない**。
 * `users` には `users_pkey`（id）と `uq_users_username`（username）の 2 本があり、
 * どちらも 23505 を返す。見分け方は下の `insertUserProfileRow` を参照。
 */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** PostgREST の「0 行」。`.single()` が行を引けなかったときに返る */
const POSTGREST_NO_ROWS = "PGRST116";

/**
 * #1599 username を採り直して再挑戦する上限。
 *
 * 衝突は「同じミリ秒 × 同じ 6 桁の乱数」でしか起きないので、
 * 1 回採り直せばまず通る。無限に粘らせないための保険として置く。
 */
const MAX_USERNAME_ATTEMPTS = 3;

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
					// #1599 【バグ】以前はここで 23505 を一律「別の呼び出しが一足先に作った」
					// （= #1233 の正常系）と決めつけて INSERT を諦めていた。だが 23505 は
					// `uq_users_username` でも返る。**別ユーザーと username がぶつかっただけ**の
					// ときにも諦めるため、その人は users 行が無いまま先へ進み、
					// useEnsureOwnProfileLoaded の再取得が 404 → 「プロフィールを読み込めません」
					// に落ちる。サインアップ直後の画面なので取り返しが利かない。
					//
					// 2 つは「自分の行ができているか」で見分けられる。
					//  - 行がある … users_pkey 衝突（#1233）。諦めてよい。以降の avatar 反映は続ける
					//  - 行が無い … username 衝突。名前を採り直せば必ず通るので再挑戦する
					let username = generateUsername();
					let didConflict = false;

					for (let attempt = 1; ; attempt++) {
						const { error: insertError } = await supabase.from("users").insert({
							id: user.id,
							username,
							display_name: displayName || "nickname",
							preferred_locale: locale,
						});

						if (!insertError) break;

						// 衝突以外の INSERT エラー（RLS 違反・NOT NULL 違反など）は従来どおり
						// user_profile_creation_error として error レベルで残したいので投げ直す。
						if (insertError.code !== POSTGRES_UNIQUE_VIOLATION) throw insertError;

						const { data: rowAfterConflict, error: recheckError } = await supabase
							.from("users")
							.select("id")
							.eq("id", user.id)
							.single<string>();
						if (recheckError && recheckError.code !== POSTGREST_NO_ROWS) throw recheckError;

						if (rowAfterConflict) {
							// #1233 の正常系。先着が作っているので、下のアバター反映まで続行する
							didConflict = true;
							break;
						}

						// username 衝突。行はまだ無いので、採り直して入れ直す
						if (attempt >= MAX_USERNAME_ATTEMPTS) throw insertError;
						logFrontendEvent({
							event_name: "user_profile_username_conflict",
							error_level: "warn",
							payload: { user_id: user.id, attempt, error: insertError.message },
						});
						username = generateUsername();
					}

					if (didConflict) {
						// 起票対象にはしないが、並走の頻度は追えるようにしておく
						logFrontendEvent({
							event_name: "user_profile_create_conflict",
							error_level: "warn",
							payload: { user_id: user.id },
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
