import React, { useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareForm } from "@/features/blurModal/components/form";
import { AvatarImageCard } from "./AvatarImageCard";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useFileUploader } from "@/hooks/useFileUploader";
import { useAPICall } from "@/hooks/useAPICall";
import { UpdateUserProfileDto } from "@shared/api/v1/dto";
import type { GetUserProfileResponse, UpdateUserProfileResponse } from "@shared/api/v1/res";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useProfileStore } from "../stores/useProfileStore";

// #481 【仕様】APIと揃えた文字数制限
const DISPLAY_NAME_MAX_LENGTH = 30;
const BIO_MAX_LENGTH = 150;

const FIELD = ["display_name", "avatar", "bio"] as const;
interface ProfileEditFormProps {
	/** Called when user cancels (usually to close modal) */
	onCancel: () => void;
	/** Called to close the modal */
	close: () => void;
}

/**
 * Profile edit form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ProfileEditForm({ close }: ProfileEditFormProps) {
	const { mediumImpact } = useHaptics();
	// #467 【設計】プロフィール更新はストア経由で行う
	const updateProfile = useProfileStore((state) => state.updateProfile);
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile } = useFileUploader();
	const { showSnackbar } = useSnackbar();
	const insets = useSafeAreaInsets();

	const profile = useProfileStore((s) => s.profile);

	const [avatar, setAvatar] = useState<{ uri: string | null; mimeType: string | null }>({
		uri: profile?.avatarUrls?.md || null,
		mimeType: null,
	});
	const [display_name, setDisplayName] = useState(profile?.display_name ?? null);
	const [bio, setBio] = useState(profile?.bio ?? null);
	// #481 【設計】バリデーションエラー状態（FeedbackForm パターン）
	const [displayNameError, setDisplayNameError] = useState("");
	const [bioError, setBioError] = useState("");

	const [isLoading, setIsLoading] = useState(false);

	// #481 【設計】入力時にエラーをクリア（FeedbackForm パターン）
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

		// #481 【設計】バリデーションエラーをクリア
		setDisplayNameError("");
		setBioError("");

		// #481 【設計】空文字は null に正規化（既存ポリシー）
		const normalizedDisplayName = display_name === "" ? null : (display_name ?? null);
		const normalizedBio = bio === "" ? null : (bio ?? null);

		// #481 【設計】文字数バリデーション（API 呼び出し前にフロントで検証）
		if (normalizedDisplayName !== null && normalizedDisplayName.length > DISPLAY_NAME_MAX_LENGTH) {
			setDisplayNameError(i18n.t("Profile.errors.displayNameLength"));
			setIsLoading(false);
			return;
		}
		if (normalizedBio !== null && normalizedBio.length > BIO_MAX_LENGTH) {
			setBioError(i18n.t("Profile.errors.bioLength"));
			setIsLoading(false);
			return;
		}

		// アバター画像のアップロード
		// null は「既存アバターを削除」, string は「新規アップロード済みパス」, undefined は「変更なし」
		let uploadedAvatarPath: string | null | undefined = undefined;
		if (avatar.uri === null) {
			uploadedAvatarPath = null;
		} else if (avatar.uri !== (profile?.avatarUrls?.md || null)) {
			try {
				if (!avatar.mimeType) throw new Error("Avatar mimeType is missing");
				uploadedAvatarPath = await uploadFile(avatar.uri, {
					mimeType: avatar.mimeType,
					baseFileName: "user-avatar",
				});
			} catch (error) {
				logFrontendEvent({
					event_name: "profile_avatar_upload_failed",
					error_level: "error",
					payload: { error: (error as Error).message },
				});
				setIsLoading(false);
				showSnackbar(i18n.t("Profile.errors.uploadFailed"));
				return;
			}
		}

		try {
			await callBackend<UpdateUserProfileDto, UpdateUserProfileResponse>("v1/users/me", {
				method: "POST",
				requestPayload: {
					avatar_path: uploadedAvatarPath,
					display_name: normalizedDisplayName,
					bio: normalizedBio,
				},
			});
			// #467 【設計】プロフィール更新はストア経由で行い、UI に即座に反映
			updateProfile((prev) =>
				prev ? { ...prev, avatar: uploadedAvatarPath, display_name: normalizedDisplayName, bio: normalizedBio } : null,
			);
			close();
			logFrontendEvent({
				event_name: "profile_edit_saved",
				error_level: "log",
				payload: {
					newBioLength: bio?.length,
					hasAvatar: !!avatar,
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
			setIsLoading(false);
		}
	}, [
		mediumImpact,
		updateProfile,
		avatar,
		uploadFile,
		logFrontendEvent,
		callBackend,
		display_name,
		bio,
		close,
		showSnackbar,
		profile,
	]);

	return (
		<KeyboardAwareForm
			fields={FIELD}
			keyboardVerticalOffset={insets.top}
			bottomNode={
				<PrimaryButton
					style={{ marginHorizontal: 16 }}
					disabled={isLoading}
					onPress={handleSave}
					label={i18n.t("Common.save")}
				/>
			}>
			{({ recordY, onFocusFactory }) => (
				<>
					<AvatarImageCard avatarUrl={avatar.uri} onSelectImage={(media) => setAvatar(media)} />

					<Card onLayout={recordY("display_name")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.displayName")}</Text>
						<TextInput
							style={[styles.input, displayNameError && styles.inputError]}
							value={display_name ?? undefined}
							onChangeText={handleDisplayNameChange}
							onFocus={onFocusFactory("display_name")}
							multiline={false}
							placeholder={i18n.t("Profile.placeholders.enterDisplayName")}
							placeholderTextColor="#666"
							textAlignVertical="center"
							returnKeyType="next"
							maxLength={DISPLAY_NAME_MAX_LENGTH}
							editable={!isLoading}
						/>
						<View style={styles.fieldFooter}>
							<Text style={styles.characterCount}>
								{(display_name ?? "").length}/{DISPLAY_NAME_MAX_LENGTH}
							</Text>
						</View>
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
							placeholderTextColor="#666"
							textAlignVertical="top"
							returnKeyType="default"
							maxLength={BIO_MAX_LENGTH}
							editable={!isLoading}
						/>
						<View style={styles.fieldFooter}>
							<Text style={styles.characterCount}>
								{(bio ?? "").length}/{BIO_MAX_LENGTH}
							</Text>
						</View>
						{bioError ? <Text style={styles.errorText}>{bioError}</Text> : null}
					</Card>
				</>
			)}
		</KeyboardAwareForm>
	);
}

const styles = StyleSheet.create({
	label: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	input: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#1A1A1A",
		shadowColor: "#000",
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
		borderColor: "#DC2626",
		backgroundColor: "#FEF2F2",
	},
	fieldFooter: {
		flexDirection: "row",
		justifyContent: "flex-end",
		marginTop: 4,
	},
	characterCount: {
		fontSize: 12,
		color: "#6B7280",
	},
	errorText: {
		fontSize: 14,
		color: "#DC2626",
		fontWeight: "500",
		marginTop: 4,
	},
});
