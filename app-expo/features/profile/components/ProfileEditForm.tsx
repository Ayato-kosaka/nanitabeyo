import React, { useState, useCallback, useMemo } from "react";
import { Text, TextInput, StyleSheet } from "react-native";
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

	const initialValues: GetUserProfileResponse = useMemo(() => useProfileStore.getState().profile!, []);
	// Internal state - isolated from parent re-renders
	const [avatar, setAvatar] = useState<{ uri: string | null; mimeType: string | null }>({
		uri: initialValues.avatarUrls?.md || null,
		mimeType: null,
	});
	const [display_name, setDisplayName] = useState(initialValues.display_name);
	const [bio, setBio] = useState(initialValues.bio);

	const [isLoading, setIsLoading] = useState(false);

	const handleSave = useCallback(async () => {
		mediumImpact();
		setIsLoading(true);

		// アバター画像のアップロード
		// null は「既存アバターを削除」, string は「新規アップロード済みパス」, undefined は「変更なし」
		let uploadedAvatarPath: string | null | undefined = undefined;
		if (avatar.uri === null) {
			uploadedAvatarPath = null;
		} else if (avatar.uri !== (initialValues.avatarUrls?.md || null)) {
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
			// display_name / bio を null 許容で明確に整形
			// 例：空文字は null に正規化するポリシー
			const normalizedDisplayName = display_name === "" ? null : (display_name ?? null);
			const normalizedBio = bio === "" ? null : (bio ?? null);
			await callBackend<UpdateUserProfileDto, UpdateUserProfileResponse>("v1/users/me", {
				method: "POST",
				requestPayload: {
					avatar_path: uploadedAvatarPath,
					display_name: normalizedDisplayName,
					bio: normalizedBio,
				},
			});
			// #467 【設計】プロフィール更新はストア経由で行い、UI に即座に反映
			updateProfile((prev) => (prev ? { ...prev, avatar: avatar.uri, display_name, bio } : null));
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
		initialValues,
		uploadFile,
		logFrontendEvent,
		callBackend,
		display_name,
		bio,
		close,
		showSnackbar,
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
							style={styles.input}
							value={display_name ?? undefined}
							onChangeText={setDisplayName}
							onFocus={onFocusFactory("display_name")}
							multiline={false}
							placeholder={i18n.t("Profile.placeholders.enterDisplayName")}
							placeholderTextColor="#666"
							textAlignVertical="center"
							returnKeyType="next"
						/>
					</Card>

					<Card onLayout={recordY("bio")}>
						<Text style={styles.label}>{i18n.t("Profile.labels.bio")}</Text>
						<TextInput
							style={[styles.input, styles.bioInput]}
							value={bio ?? undefined}
							onChangeText={setBio}
							onFocus={onFocusFactory("bio")}
							multiline
							numberOfLines={4}
							placeholder={i18n.t("Profile.placeholders.enterBio")}
							placeholderTextColor="#666"
							textAlignVertical="top"
							returnKeyType="default"
						/>
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
		marginBottom: 12,
	},
	input: {
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 12,
		paddingHorizontal: 16,
		paddingVertical: 12,
		fontSize: 16,
		color: "#1A1A1A",
		backgroundColor: "#FFFFFF",
		minHeight: 48,
	},
	bioInput: { minHeight: 80 },
});
