import React, { useState, useCallback, useRef } from "react";
import { Text, TextInput, StyleSheet } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { KeyboardAwareForm } from "@/components/KeyboardAwareForm";
import { AvatarImageCard } from "./AvatarImageCard";
import type { MediaData } from "@/lib/mediaSelection";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useFileUploader } from "@/hooks/useFileUploader";
import { useAPICall } from "@/hooks/useAPICall";
import type { UpdateUserProfileDto } from "@shared/api/v1/dto";
import type { GetUserProfileResponse, UpdateUserProfileResponse } from "@shared/api/v1/res";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useProfileStore } from "../stores/useProfileStore";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

// #481 【仕様】APIと揃えた文字数制限
const DISPLAY_NAME_MAX_LENGTH = 30;
const BIO_MAX_LENGTH = 150;

const FIELD = ["display_name", "avatar", "bio"] as const;

/**
 * #1750 アバター欄に対するユーザーの «意図»。
 *
 * - `unchanged`: 画像欄に触っていない → `avatar_path` を **送らない**（サーバ側は列を触らない）
 * - `picked`: 新しい画像を選んだ → アップロードして、そのパスを送る
 * - `removed`: 既存のアバターを外した → `avatar_path: null` を送る（削除）
 *
 * ⚠️ `removed` を作れる UI は今のところ無い（AvatarImageCard に削除ボタンが無い）。
 * それでも型として置いてあるのは、**「null を送る = 削除」という契約をここ 1 箇所に閉じ込める**ためで、
 * 削除導線が生えたときに保存側を書き換えずに済む。
 */
type AvatarDraft = { kind: "unchanged" } | { kind: "picked"; uri: string; mimeType: string } | { kind: "removed" };
interface ProfileEditFormProps {
	/**
	 * 保存が成功したときに呼ばれる。
	 *
	 * #1369 モーダル時代の `close` / `onCancel` を置き換えたもの。呼び出し元は
	 * `app/[locale]/(tabs)/profile/edit.tsx` の 1 箇所で、「閉じる」ではなく
	 * 「保存できたので画面を離れる」という意味になった。キャンセルの導線は
	 * 画面側の ScreenHeader（戻る）が持つため、このフォームは受け取らない。
	 */
	onSaved: () => void;
}

/**
 * Profile edit form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ProfileEditForm({ onSaved }: ProfileEditFormProps) {
	const { mediumImpact } = useHaptics();
	// #467 【設計】プロフィール更新はストア経由で行う
	const updateProfile = useProfileStore((state) => state.updateProfile);
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile } = useFileUploader();
	const { showSnackbar } = useSnackbar();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);

	const profile = useProfileStore((s) => s.profile);

	/**
	 * #1750 【バグ】アバターの «意図» を状態として持つ。
	 *
	 * 旧実装は `{ uri, mimeType }` だけを持ち、保存時に **`uri === null` を「削除して」と解釈**していた。
	 * だが `uri === null` は「アバターをまだ一度も設定していない人が、画像欄に触らずに保存した」
	 * ときの状態でもある。つまり «削除» と «そもそも無い» が同じ値になっていて、区別できない。
	 *
	 * これが実害になるのは、選んだ画像が**何らかの理由で状態から消えたとき**である。
	 * そのまま保存すると `avatar_path: null`（= 削除）が飛ぶ。実際に dev のログ
	 * （2026-08-31 16:08:58 UTC）で `dto: {display_name:"あやと", avatar_path:null}` が観測されている。
	 *
	 * 意図を 3 値で持てば、«触っていない» は必ず `undefined`（= 変更なし）へ落ちるので、
	 * **状態が壊れても «消える» ことだけは起きない**。
	 */
	const [avatarDraft, setAvatarDraft] = useState<AvatarDraft>({ kind: "unchanged" });

	// 画像カードに出す URL。«触っていない» ときだけストアの現在値を映す
	const avatarPreviewUri =
		avatarDraft.kind === "picked"
			? avatarDraft.uri
			: avatarDraft.kind === "removed"
				? null
				: (profile?.avatarUrls?.md ?? null);
	const [display_name, setDisplayName] = useState(profile?.display_name ?? null);
	const [bio, setBio] = useState(profile?.bio ?? null);
	const [displayNameError, setDisplayNameError] = useState("");
	const [bioError, setBioError] = useState("");

	const [isLoading, setIsLoading] = useState(false);
	/**
	 * #1205 【修正】プロフィール保存の多重実行を防ぐ同期ガード。
	 *
	 * `isLoading`（useState）は保存ボタンを disabled にする表示用途で、判定には使えない。
	 * 通過すると `uploadFile` が 2 回走り、**署名 URL ごとに別の objectPath が払い出される**ため、
	 * 実際に使われない孤児のストレージオブジェクトが残る（`POST v1/users/me` 自体は
	 * 同じペイロードなので最終結果は変わらないが、ゴミだけが増える）。
	 */
	const isSavingRef = useRef(false);

	/**
	 * #1750 画像を選べたことを **その場でログに残す**。
	 *
	 * これが無かったせいで «ユーザーが画像を選んだのか / 選べていなかったのか» がログから
	 * 判定できず、「画像が上がらない」の切り分けに実機のやり直しを何度も要求していた。
	 * 選択の成否はここでしか観測できない（失敗時のログは AvatarImageCard が持つ）。
	 */
	const handleSelectAvatar = useCallback(
		(media: Pick<MediaData, "uri" | "mimeType">) => {
			setAvatarDraft({ kind: "picked", uri: media.uri, mimeType: media.mimeType });
			logFrontendEvent({
				event_name: "profile_avatar_selected",
				error_level: "log",
				payload: {
					// URI 自体は端末内のパスなので残さない。«どの経路で来たか» だけ分かればよい
					uriScheme: media.uri?.split(":")[0] ?? null,
					mimeType: media.mimeType,
				},
			});
		},
		[logFrontendEvent],
	);

	// 入力時にエラーをクリア（FeedbackForm パターン）
	const handleDisplayNameChange = useCallback(
		(text: string) => {
			setDisplayName(text);
			if (displayNameError) {
				setDisplayNameError("");
			}
		},
		[displayNameError],
	);

	const handleBioChange = useCallback(
		(text: string) => {
			setBio(text);
			if (bioError) {
				setBioError("");
			}
		},
		[bioError],
	);

	const handleSave = useCallback(async () => {
		mediumImpact();
		setIsLoading(true);

		// バリデーションエラーをクリア
		setDisplayNameError("");
		setBioError("");

		// 表示名は trim して空白のみも空文字として扱う
		const trimmedDisplayName = (display_name ?? "").trim();
		const normalizedBio = bio === "" ? null : (bio ?? null);

		// #issue 【設計】表示名の必須チェック（1文字以上）- 空文字/空白のみは NG
		if (trimmedDisplayName.length === 0) {
			setDisplayNameError(i18n.t("Profile.errors.displayNameRequired"));
			setIsLoading(false);
			return;
		}

		// #481 【設計】文字数バリデーション（API 呼び出し前にフロントで検証）
		if (trimmedDisplayName.length > DISPLAY_NAME_MAX_LENGTH) {
			setDisplayNameError(i18n.t("Profile.errors.displayNameLength"));
			setIsLoading(false);
			return;
		}
		if (normalizedBio !== null && normalizedBio.length > BIO_MAX_LENGTH) {
			setBioError(i18n.t("Profile.errors.bioLength"));
			setIsLoading(false);
			return;
		}

		// #1205 多重実行の判定は ref で行う（useState の isLoading はレースが残る。宣言箇所のコメント参照）。
		// ⚠️ **バリデーションの early return より後で立てること。** 上の 3 つの return は
		// finally を通らず抜けるので、手前で立てると解除されず二度と保存できなくなる
		if (isSavingRef.current) return;
		isSavingRef.current = true;

		// アバター画像のアップロード
		// null は「既存アバターを削除」, string は「新規アップロード済みパス」, undefined は「変更なし」
		// #1750 どれを送るかは «ユーザーの意図»（avatarDraft）だけで決める。画面の状態から推論しない
		let uploadedAvatarPath: string | null | undefined = undefined;
		if (avatarDraft.kind === "removed") {
			uploadedAvatarPath = null;
		} else if (avatarDraft.kind === "picked") {
			try {
				uploadedAvatarPath = await uploadFile(avatarDraft.uri, {
					// #1750 mimeType が空でも保存ごと中断しない。`selectMedia` が拡張子から埋めてくれる
					// ので通常ここは埋まっているが、万一のときは «送らない» より «既定で送る» 方がよい
					mimeType: avatarDraft.mimeType || "application/octet-stream",
					baseFileName: "user-avatar",
				});
				logFrontendEvent({
					event_name: "profile_avatar_uploaded",
					error_level: "log",
					payload: { objectPath: uploadedAvatarPath },
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "profile_avatar_upload_failed",
					error_level: "error",
					payload: { error: (error as Error).message },
				});
				setIsLoading(false);
				// #1205 ここは finally を通らない early return なので、多重実行ガードを自分で戻す。
				// 戻さないと «一度アップロードに失敗したら二度と保存できない» 画面になる
				isSavingRef.current = false;
				showSnackbar(i18n.t("Profile.errors.uploadFailed"));
				return;
			}
		}

		try {
			await callBackend<UpdateUserProfileDto, UpdateUserProfileResponse>("v1/users/me", {
				method: "POST",
				requestPayload: {
					avatar_path: uploadedAvatarPath,
					display_name: trimmedDisplayName,
					bio: normalizedBio,
				},
			});
			// #467 【設計】プロフィール更新はストア経由で行い、UI に即座に反映
			updateProfile((prev) =>
				prev
					? {
							...prev,
							// #1750 【バグ】列名は `avatar_path`。旧実装は `avatar` という **存在しないキー**へ
							// 書いており、ストア上のアバターは保存後も古いままだった（画面が持ち直せていたのは
							// 下の avatarUrls のおかげで、`avatar` の方は誰にも読まれていない）。
							// «変更なし» のときは既存の値を残す（undefined で塗り潰さない）
							avatar_path: uploadedAvatarPath === undefined ? prev.avatar_path : uploadedAvatarPath,
							display_name: trimmedDisplayName,
							bio: normalizedBio,
							avatarUrls:
								avatarDraft.kind === "unchanged"
									? prev.avatarUrls
									: avatarPreviewUri
										? { sm: avatarPreviewUri, md: avatarPreviewUri }
										: undefined,
						}
					: null,
			);
			onSaved();
			logFrontendEvent({
				event_name: "profile_edit_saved",
				error_level: "log",
				payload: {
					newBioLength: bio?.length,
					// #1750 【バグ】旧実装は `!!avatar` で、`avatar` はオブジェクトなので **常に true** だった。
					// そのせいで «画像を付けて保存した» と «付けずに保存した» がログ上で区別できず、
					// 「画像が上がらない」の調査で `hasAvatar: true` なのに `avatar_path: null` という
					// 読めないログだけが残った（dev 2026-08-31 16:08:58 UTC）。意図をそのまま出す
					avatarAction: avatarDraft.kind,
					hasAvatar: !!avatarPreviewUri,
					hasDisplayName: !!display_name,
				},
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "profile_update_failed",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
			showSnackbar(i18n.t("Common.error"));
		} finally {
			// #1205 保存失敗後も押し直せるよう、成功・失敗のいずれでも必ず解除する
			isSavingRef.current = false;
			setIsLoading(false);
		}
	}, [
		mediumImpact,
		updateProfile,
		avatarDraft,
		avatarPreviewUri,
		uploadFile,
		logFrontendEvent,
		callBackend,
		display_name,
		bio,
		onSaved,
		showSnackbar,
	]);

	return (
		<KeyboardAwareForm
			fields={FIELD}
			bottomNode={
				<PrimaryButton
					style={{ marginHorizontal: 16 }}
					disabled={isLoading}
					onPress={handleSave}
					label={i18n.t("Common.save")}
					// #1750 実機・e2e から «保存ボタンが画面の中に居るか» を名指しで確かめるための印
					testID="profile-edit-save-button"
				/>
			}>
			{({ recordY, onFocusFactory }) => (
				<>
					<AvatarImageCard avatarUrl={avatarPreviewUri} onSelectImage={handleSelectAvatar} />

					<Card onLayout={recordY("display_name")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.displayName")}</Text>
						<TextInput
							style={[styles.input, displayNameError && styles.inputError]}
							value={display_name ?? undefined}
							onChangeText={handleDisplayNameChange}
							onFocus={onFocusFactory("display_name")}
							multiline={false}
							placeholder={i18n.t("Profile.placeholders.enterDisplayName")}
							placeholderTextColor={colors.textMuted}
							textAlignVertical="center"
							returnKeyType="next"
							maxLength={DISPLAY_NAME_MAX_LENGTH}
							editable={!isLoading}
						/>
						<Text style={styles.characterCount}>
							{(display_name ?? "").length}/{DISPLAY_NAME_MAX_LENGTH}
						</Text>
						{displayNameError ? <Text style={styles.errorText}>{displayNameError}</Text> : null}
					</Card>

					<Card onLayout={recordY("bio")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.bio")}</Text>
						<TextInput
							style={[styles.input, styles.bioInput, bioError && styles.inputError]}
							value={bio ?? undefined}
							onChangeText={handleBioChange}
							onFocus={onFocusFactory("bio")}
							multiline
							numberOfLines={4}
							placeholder={i18n.t("Profile.placeholders.enterBio")}
							placeholderTextColor={colors.textMuted}
							textAlignVertical="top"
							returnKeyType="default"
							maxLength={BIO_MAX_LENGTH}
							editable={!isLoading}
						/>
						<Text style={styles.characterCount}>
							{(bio ?? "").length}/{BIO_MAX_LENGTH}
						</Text>
						{bioError ? <Text style={styles.errorText}>{bioError}</Text> : null}
					</Card>
				</>
			)}
		</KeyboardAwareForm>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		label: {
			fontSize: 16,
			fontWeight: "600",
			color: c.textPrimary,
			marginBottom: 8,
		},
		input: {
			backgroundColor: c.surfaceMuted,
			borderRadius: 12,
			paddingHorizontal: 12,
			paddingVertical: 12,
			fontSize: 15,
			color: c.textPrimary,
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 1 },
			shadowOpacity: 0.05,
			shadowRadius: 2,
			elevation: 1,
			minHeight: 48,
		},
		bioInput: { minHeight: 80 },
		// #481 【設計】FeedbackForm パターンに合わせたエラー/カウンター表示スタイル
		inputError: {
			borderWidth: 1,
			borderColor: c.danger,
			backgroundColor: c.dangerTintSoft,
		},
		characterCount: {
			fontSize: 12,
			color: c.textSecondary,
			textAlign: "right",
			marginTop: 4,
		},
		errorText: {
			fontSize: 14,
			color: c.danger,
			fontWeight: "500",
			marginTop: 4,
		},
	});
