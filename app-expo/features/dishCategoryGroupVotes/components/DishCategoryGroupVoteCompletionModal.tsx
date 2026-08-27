/**
 * #856 【責務】
 * 投票完了時の名前・コメント入力 UI をまとめる。
 *
 * 表示するかどうかは親画面（#1358 以降は投票完了状態の state）が管理し、このコンポーネントは
 * 内容表示だけに絞る。これにより、最後の候補への投票直後に確実に完了入力を表示できる。
 */
import { useEffect, useMemo, useState } from "react";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import i18n from "@/lib/i18n";
import { LoadingIndicator } from "@/components/LoadingIndicator";
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
	// #1629 プレースホルダーの色をテーマへ追従させるために読む
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { user, isAuthResolved } = useAuth();
	const { isProfileResolved } = useEnsureOwnProfileLoaded();
	const profile = useProfileStore((state) => state.profile);
	const usedDisplayNamesKey = useMemo(() => usedDisplayNames.join("\u0000"), [usedDisplayNames]);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const [isManualName, setIsManualName] = useState(false);
	const [displayName, setDisplayName] = useState("");
	const [comment, setComment] = useState("");
	// #1092 PR4b 【修正】`user?.is_anonymous === false` から共通判定（lib/authGuest.ts）へ寄せた。
	// 旧式は is_anonymous が undefined のときもゲスト扱いになり、ログイン済みなのに表示名が
	// 初期入力されない（他画面ではログイン済みとして扱われている）という食い違いになる
	const isGuest = isGuestUser(user);

	// #1120 【設計】「ゲスト向けの絵文字候補」と「ログインユーザーの nickname 初期入力」の分岐に必要な
	// 材料がそろったか。そろう前に描くと、ログイン済みユーザーに一瞬だけ絵文字候補が出てから
	// nickname へ差し替わる（Issue #1120）。
	//
	// - `isAuthResolved === false` … ゲストかログイン済みかがまだ決まっていない。
	//   `isGuestUser(null)` は「ゲスト」へ倒れる仕様（lib/authGuest.ts）なので、
	//   ここを待たないと必ずゲスト向け UI を先に描いてしまう。
	// - ログイン済みで `isProfileResolved === false` … display_name の取得が終わっていない。
	//   この UI は投票完了状態になった瞬間に初めてマウントされる = プロフィール取得も
	//   そこから始まるため、`profile === null` の窓を毎回必ず通る。
	//
	// ゲスト確定なら profile を参照しないので、プロフィール取得を待たずに描いてよい。
	const isIdentityResolved = isAuthResolved && (isGuest || isProfileResolved);

	const loggedInDisplayName = !isGuest
		? Array.from(profile?.display_name ?? "")
				.slice(0, 8)
				.join("")
		: "";

	useEffect(() => {
		// #1120 未確定のスナップショットで入力欄を初期化しない（確定してから一度だけ初期化する）
		if (!isIdentityResolved) return;
		const nextUsedDisplayNames = usedDisplayNamesKey ? usedDisplayNamesKey.split("\u0000") : [];
		const nextSuggestions = buildDishCategoryGroupVoteNameSuggestions(nextUsedDisplayNames);
		setSuggestions(nextSuggestions);
		// 匿名参加者には候補を初期入力せず、手入力したい人が候補名のまま送る事故を防ぐ。
		const defaultDisplayName = loggedInDisplayName || "";
		setIsManualName(Boolean(loggedInDisplayName));
		setDisplayName(defaultDisplayName);
		setComment("");
	}, [isIdentityResolved, loggedInDisplayName, usedDisplayNamesKey]);

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

	// #1120 【設計】確定するまではどちらの分岐も描かない。
	// 「ゲスト向けを出しておいて後から差し替える」も「遅延で隠す」もしない ＝ ちらつきの原因を消す。
	if (!isIdentityResolved) {
		return (
			<View style={styles.modal}>
				<Text style={styles.title}>{i18n.t("DishCategoryGroupVotes.completionTitle")}</Text>
				<View testID="dish-category-group-vote-completion-loading" style={styles.identityLoading}>
					<LoadingIndicator size="large" />
				</View>
			</View>
		);
	}

	return (
		<View testID="dish-category-group-vote-completion-form" style={styles.modal}>
			<Text style={styles.title}>{i18n.t("DishCategoryGroupVotes.completionTitle")}</Text>
			<TextInput
				testID="dish-category-group-vote-display-name-input"
				style={styles.input}
				value={displayName}
				onChangeText={(text) => {
					setDisplayName(text);
					setIsManualName(text.trim().length > 0);
				}}
				onFocus={handleNameInputFocus}
				placeholder={i18n.t("DishCategoryGroupVotes.displayNamePlaceholder")}
				// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
				placeholderTextColor={colors.textSecondary}
				maxLength={8}
			/>
			{suggestions.length > 0 && (!isManualName || displayName.trim().length === 0) ? (
				<View testID="dish-category-group-vote-name-suggestions" style={styles.suggestions}>
					<Text style={styles.suggestionLabel}>{i18n.t("DishCategoryGroupVotes.nameSuggestionLabel")}</Text>
					<View style={styles.suggestionRow}>
						{suggestions.map((suggestion) => (
							// 【a11y】押せるのに role が無いと、web では `<div tabindex="0">` として描画され、
							// 支援技術からはボタンだと分からない。`accessibilityState.selected` まで出して
							// 「どれを選んでいるか」も読み上げ側へ伝える（見た目は色でしか示していないため）。
							<TouchableOpacity
								key={suggestion}
								testID="dish-category-group-vote-name-suggestion"
								accessibilityRole="button"
								accessibilityLabel={suggestion}
								accessibilityState={{ selected: displayName === suggestion }}
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
				// #1629 ダークで既定色（濃いグレー）のまま地に埋もれるため、テーマのトークンを明示する
				placeholderTextColor={colors.textSecondary}
				multiline
			/>
			<View style={styles.actionRow}>
				<PrimaryButton
					// #1506 GRP-04 【テスト】投票の送信は「ホストへ通知が飛ぶ」起点なので、
					// E2E から確実に押せるよう観測点を付ける（ラベル文言はロケール依存で引けない）
					testID="dish-category-group-vote-submit"
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

const createStyles = (c: Palette) =>
	StyleSheet.create({
		modal: {
			width: "100%",
			maxWidth: 420,
			borderRadius: 8,
			backgroundColor: c.surface,
			padding: 18,
		},
		title: {
			fontSize: 20,
			fontWeight: "800",
			color: c.textPrimaryAlt,
		},
		suggestions: {
			marginTop: 14,
			gap: 8,
		},
		// #1120 ログイン判定の確定待ち。確定後のフォームとおおよそ同じ高さにして、
		// 差し替わったときにモーダルが大きく伸縮しないようにする
		identityLoading: {
			minHeight: 220,
			alignItems: "center",
			justifyContent: "center",
		},
		suggestionLabel: {
			fontSize: 12,
			fontWeight: "700",
			color: c.textSecondary,
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
			borderColor: c.borderMuted,
			backgroundColor: c.surfaceFaint,
		},
		suggestionButtonActive: {
			borderColor: c.textPrimaryAlt,
			backgroundColor: c.surfaceSelectedTint,
		},
		suggestionText: {
			fontSize: 24,
		},
		input: {
			marginTop: 14,
			minHeight: 44,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: c.borderNeutral,
			paddingHorizontal: 12,
			fontSize: 16,
			color: c.textPrimaryAlt,
			backgroundColor: c.surface,
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
			borderColor: c.borderNeutral,
		},
		cancelButtonText: {
			fontSize: 15,
			fontWeight: "700",
			color: c.textSecondaryStrong,
		},
		submitButton: {
			flex: 1,
		},
	});
