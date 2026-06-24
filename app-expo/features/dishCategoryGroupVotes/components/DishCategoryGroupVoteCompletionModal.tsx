/**
 * #856 【責務】
 * 投票完了時の名前・コメント入力を扱う BlurModal。
 *
 * このモーダルは閉じられない前提で、入力完了まで投票完了フローを止める。
 * 絵文字候補は匿名性の補助であり、API に保存されるのは displayName/comment のみ。
 */
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import i18n from "@/lib/i18n";
import { buildDishCategoryGroupVoteNameSuggestions } from "../constants/animalNameSuggestions";

type Props = {
	visible: boolean;
	usedDisplayNames: string[];
	isSubmitting: boolean;
	onSubmit: (values: { displayName: string; comment?: string }) => void;
};

export function DishCategoryGroupVoteCompletionModal({
	visible,
	usedDisplayNames,
	isSubmitting,
	onSubmit,
}: Props) {
	const { BlurModal, open, close } = useBlurModal({
		closeOnBackdropPress: false,
		backHandlerEnabled: false,
	});
	const usedDisplayNamesKey = useMemo(() => usedDisplayNames.join("\u0000"), [usedDisplayNames]);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [isManualName, setIsManualName] = useState(false);
	const [displayName, setDisplayName] = useState(suggestions[0] ?? "");
	const [comment, setComment] = useState("");

	useEffect(() => {
		if (visible) {
			open();
		} else {
			close();
		}
	}, [close, open, visible]);

	useEffect(() => {
		if (!visible) return;
		const nextUsedDisplayNames = usedDisplayNamesKey ? usedDisplayNamesKey.split("\u0000") : [];
		const nextSuggestions = buildDishCategoryGroupVoteNameSuggestions(nextUsedDisplayNames);
		setSuggestions(nextSuggestions);
		setIsManualName(false);
		setDisplayName(nextSuggestions[0] ?? "");
		setComment("");
	}, [usedDisplayNamesKey, visible]);

	const handleNameInputFocus = () => {
		if (!isManualName) {
			setIsManualName(true);
			setDisplayName("");
		}
	};

	const canSubmit = displayName.trim().length > 0 && !isSubmitting;

	return (
		<BlurModal showCloseButton={false} contentContainerStyle={styles.backdrop} paddingVertical={0}>
			<View style={styles.modal}>
					<Text style={styles.title}>{i18n.t("DishCategoryGroupVotes.completionTitle")}</Text>
					<Text style={styles.description}>{i18n.t("DishCategoryGroupVotes.completionDescription")}</Text>
					{suggestions.length > 0 && !isManualName ? (
						<View style={styles.suggestions}>
							<Text style={styles.suggestionLabel}>{i18n.t("DishCategoryGroupVotes.nameSuggestionLabel")}</Text>
							<View style={styles.suggestionRow}>
								{suggestions.map((suggestion) => (
									<TouchableOpacity
										key={suggestion}
										style={[styles.suggestionButton, displayName === suggestion && styles.suggestionButtonActive]}
										onPress={() => setDisplayName(suggestion)}
										activeOpacity={0.85}>
										<Text style={styles.suggestionText}>{suggestion}</Text>
									</TouchableOpacity>
								))}
							</View>
						</View>
					) : null}
					<TextInput
						style={styles.input}
						value={displayName}
						onChangeText={(text) => {
							setIsManualName(true);
							setDisplayName(text);
						}}
						onFocus={handleNameInputFocus}
						placeholder={i18n.t("DishCategoryGroupVotes.displayNamePlaceholder")}
						maxLength={8}
					/>
					<TextInput
						style={[styles.input, styles.commentInput]}
						value={comment}
						onChangeText={setComment}
						placeholder={i18n.t("DishCategoryGroupVotes.commentPlaceholder")}
						multiline
					/>
					<View style={styles.actionRow}>
						<TouchableOpacity
							style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
							disabled={!canSubmit}
							onPress={() => onSubmit({ displayName: displayName.trim(), comment: comment.trim() || undefined })}
							activeOpacity={0.85}>
							<Text style={styles.submitButtonText}>
								{isSubmitting ? i18n.t("DishCategoryGroupVotes.submitting") : i18n.t("DishCategoryGroupVotes.submitVote")}
							</Text>
						</TouchableOpacity>
					</View>
			</View>
		</BlurModal>
	);
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(17, 24, 39, 0.42)",
		padding: 20,
	},
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
	description: {
		marginTop: 6,
		fontSize: 14,
		lineHeight: 20,
		color: "#4B5563",
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
		borderRadius: 8,
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
		height: 44,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#111827",
	},
	submitButtonDisabled: {
		backgroundColor: "#9CA3AF",
	},
	submitButtonText: {
		fontSize: 15,
		fontWeight: "800",
		color: "#FFFFFF",
	},
});
