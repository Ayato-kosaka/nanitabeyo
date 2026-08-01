/**
 * #856 【責務】
 * 投票完了時の名前・コメント入力 UI をまとめる。
 *
 * BlurModal の開閉は親画面で管理し、このコンポーネントは内容表示だけに絞る。
 * これにより、最後の候補への投票直後に確実にモーダルを表示できる。
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import i18n from "@/lib/i18n";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useEnsureOwnProfileLoaded } from "@/features/profile/hooks/useEnsureOwnProfileLoaded";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { buildDishCategoryGroupVoteNameSuggestions } from "../constants/animalNameSuggestions";

type Props = {
	usedDisplayNames: string[];
	isSubmitting: boolean;
	onSubmit: (values: { displayName: string; comment?: string }) => void;
};

export function DishCategoryGroupVoteCompletionModal({ usedDisplayNames, isSubmitting, onSubmit }: Props) {
	const { user } = useAuth();
	useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);
	const usedDisplayNamesKey = useMemo(() => usedDisplayNames.join("\u0000"), [usedDisplayNames]);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [isManualName, setIsManualName] = useState(false);
	const [displayName, setDisplayName] = useState("");
	const [comment, setComment] = useState("");
	// #1092 PR4b 【修正】`user?.is_anonymous === false` から共通判定（lib/authGuest.ts）へ寄せた。
	// 旧式は is_anonymous が undefined のときもゲスト扱いになり、ログイン済みなのに表示名が
	// 初期入力されない（他画面ではログイン済みとして扱われている）という食い違いになる
	const loggedInDisplayName = !isGuestUser(user)
		? Array.from(profile?.display_name ?? "")
				.slice(0, 8)
				.join("")
		: "";

	useEffect(() => {
		const nextUsedDisplayNames = usedDisplayNamesKey ? usedDisplayNamesKey.split("\u0000") : [];
		const nextSuggestions = buildDishCategoryGroupVoteNameSuggestions(nextUsedDisplayNames);
		setSuggestions(nextSuggestions);
		// 匿名参加者には候補を初期入力せず、手入力したい人が候補名のまま送る事故を防ぐ。
		const defaultDisplayName = loggedInDisplayName || "";
		setIsManualName(Boolean(loggedInDisplayName));
		setDisplayName(defaultDisplayName);
		setComment("");
	}, [loggedInDisplayName, usedDisplayNamesKey]);

	useEffect(() => {
		if (displayName.trim().length === 0) {
			setIsManualName(false);
		}
	}, [displayName]);

	const handleNameInputFocus = () => {
		if (!isManualName) {
			setIsManualName(true);
			setDisplayName("");
		}
	};

	const canSubmit = displayName.trim().length > 0 && !isSubmitting;

	return (
		<View style={styles.modal}>
			<Text style={styles.title}>{i18n.t("DishCategoryGroupVotes.completionTitle")}</Text>
			<TextInput
				style={styles.input}
				value={displayName}
				onChangeText={(text) => {
					setDisplayName(text);
					setIsManualName(text.trim().length > 0);
				}}
				onFocus={handleNameInputFocus}
				placeholder={i18n.t("DishCategoryGroupVotes.displayNamePlaceholder")}
				maxLength={8}
			/>
			{suggestions.length > 0 && (!isManualName || displayName.trim().length === 0) ? (
				<View style={styles.suggestions}>
					<Text style={styles.suggestionLabel}>{i18n.t("DishCategoryGroupVotes.nameSuggestionLabel")}</Text>
					<View style={styles.suggestionRow}>
						{suggestions.map((suggestion) => (
							<TouchableOpacity
								key={suggestion}
								style={[styles.suggestionButton, displayName === suggestion && styles.suggestionButtonActive]}
								onPress={() => {
									setIsManualName(false);
									setDisplayName(suggestion);
								}}
								activeOpacity={0.85}>
								<Text style={styles.suggestionText}>{suggestion}</Text>
							</TouchableOpacity>
						))}
					</View>
				</View>
			) : null}
			<TextInput
				style={[styles.input, styles.commentInput]}
				value={comment}
				onChangeText={setComment}
				placeholder={i18n.t("DishCategoryGroupVotes.commentPlaceholder")}
				multiline
			/>
			<View style={styles.actionRow}>
				<PrimaryButton
					label={i18n.t("DishCategoryGroupVotes.submitVote")}
					loading={isSubmitting}
					disabled={!canSubmit}
					onPress={() => onSubmit({ displayName: displayName.trim(), comment: comment.trim() || undefined })}
					style={styles.submitButton}
				/>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	modal: {
		width: "100%",
		maxWidth: 420,
		borderRadius: 8,
		backgroundColor: "#FFFFFF",
		padding: 18,
	},
	title: {
		fontSize: 20,
		fontWeight: "800",
		color: "#111827",
	},
	suggestions: {
		marginTop: 14,
		gap: 8,
	},
	suggestionLabel: {
		fontSize: 12,
		fontWeight: "700",
		color: "#6B7280",
	},
	suggestionRow: {
		flexDirection: "row",
		gap: 8,
	},
	suggestionButton: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderColor: "#E5E7EB",
		backgroundColor: "#F9FAFB",
	},
	suggestionButtonActive: {
		borderColor: "#111827",
		backgroundColor: "#EEF2FF",
	},
	suggestionText: {
		fontSize: 24,
	},
	input: {
		marginTop: 14,
		minHeight: 44,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: "#D1D5DB",
		paddingHorizontal: 12,
		fontSize: 16,
		color: "#111827",
		backgroundColor: "#FFFFFF",
	},
	commentInput: {
		minHeight: 86,
		paddingTop: 10,
		textAlignVertical: "top",
	},
	actionRow: {
		marginTop: 16,
		flexDirection: "row",
		gap: 10,
	},
	cancelButton: {
		flex: 1,
		height: 44,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1,
		borderColor: "#D1D5DB",
	},
	cancelButtonText: {
		fontSize: 15,
		fontWeight: "700",
		color: "#374151",
	},
	submitButton: {
		flex: 1,
	},
});
