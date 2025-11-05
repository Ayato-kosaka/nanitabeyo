import React, { useState, useCallback, useRef } from "react";
import {
	Text,
	TextInput,
	StyleSheet,
	ScrollView,
	KeyboardAvoidingView,
	Platform,
	NativeSyntheticEvent,
	TextInputFocusEventData,
} from "react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";

interface ProfileEditFormData {
	avatar: string;
	display_name: string;
	bio: string;
}

interface ProfileEditFormProps {
	/** Initial values for the form */
	initialValues: ProfileEditFormData;
	/** Called when user saves the form with the final values */
	onSubmit: (values: ProfileEditFormData) => void;
	/** Called when user cancels (usually to close modal) */
	onCancel: () => void;
}

type FieldKey = "displayName" | "avatar" | "bio";

/**
 * Profile edit form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ProfileEditForm({ initialValues, onSubmit, onCancel }: ProfileEditFormProps) {
	// Internal state - isolated from parent re-renders
	const [avatar, setAvatar] = useState(initialValues.avatar);
	const [displayName, setDisplayName] = useState(initialValues.display_name);
	const [bio, setBio] = useState(initialValues.bio);

	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const insets = useSafeAreaInsets();

	// Scroll & positions
	const scrollRef = useRef<ScrollView>(null);
	const fieldYRef = useRef<Record<FieldKey, number>>({ displayName: 0, avatar: 0, bio: 0 });

	const handleSave = useCallback(() => {
		onSubmit({ avatar, display_name: displayName, bio });
	}, [avatar, displayName, bio, onSubmit]);

	// 各カードの onLayout で Y 座標を保存
	const recordY = (key: FieldKey) => (e: any) => {
		const y = e?.nativeEvent?.layout?.y ?? 0;
		fieldYRef.current[key] = y;
	};

	// 指定フィールドへスクロール（キーボード表示を待ってから）
	const scrollToField = (key: FieldKey) => {
		const y = fieldYRef.current[key] ?? 0;
		console.log("fieldYRef.current: ", fieldYRef.current);
		// 行のラベル + 余白 + 入力欄の高さぶん手前で止める
		const padding = 16;
		setTimeout(() => {
			scrollRef.current?.scrollTo({ y: Math.max(y - padding, 0), animated: true });
		}, 50); // 50–150ms 程度で安定（端末により調整可）
	};

	const onFocusFactory = (key: FieldKey) => (_e: NativeSyntheticEvent<TextInputFocusEventData>) => {
		scrollToField(key);
	};

	return (
		// キーボードが表示された場合に高さを自動調整
		<KeyboardAvoidingView
			style={{ height: frame.height - 100 }}
			behavior={Platform.select({ ios: "padding", android: "height" })}>
			<ScrollView
				ref={scrollRef}
				style={styles.scrollView}
				contentContainerStyle={[
					styles.contentContainer,
					// キーボードで隠れないように最小限の下パディングを確保
					{ paddingBottom: 24 + insets.bottom },
				]}
				keyboardShouldPersistTaps="handled"
				// iOS の自動インセット調整は避ける（SafeAreaは自前で付与）
				automaticallyAdjustContentInsets={false}>
				<Card onLayout={recordY("displayName")}>
					<Text style={styles.label}>{i18n.t("Profile.labels.displayName")}</Text>
					<TextInput
						style={styles.input}
						value={displayName}
						onChangeText={setDisplayName}
						onFocus={onFocusFactory("displayName")}
						multiline={false}
						placeholder={i18n.t("Profile.placeholders.enterDisplayName")}
						placeholderTextColor="#666"
						textAlignVertical="center"
						returnKeyType="next"
					/>
				</Card>

				<Card style={styles.cardSpacing} onLayout={recordY("avatar")}>
					<Text style={styles.label}>{i18n.t("Profile.labels.avatar")}</Text>
					<TextInput
						style={styles.input}
						value={avatar}
						onChangeText={setAvatar}
						onFocus={onFocusFactory("avatar")}
						multiline={false}
						placeholder={i18n.t("Profile.placeholders.enterAvatar")}
						placeholderTextColor="#666"
						textAlignVertical="center"
						returnKeyType="next"
						autoCapitalize="none"
						autoCorrect={false}
					/>
				</Card>

				<Card style={styles.cardSpacing} onLayout={recordY("bio")}>
					<Text style={styles.label}>{i18n.t("Profile.labels.bio")}</Text>
					<TextInput
						style={[styles.input, styles.bioInput]}
						value={bio}
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
			</ScrollView>

			<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSave} label={i18n.t("Common.save")} />
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	scrollView: { flex: 1 },
	contentContainer: { paddingTop: 0 },
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
	cardSpacing: { marginTop: 16 },
});
