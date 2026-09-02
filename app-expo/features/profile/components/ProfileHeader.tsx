import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Pencil as Edit3 } from "lucide-react-native";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "@/components/Card";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { GetUserProfileResponse } from "@shared/api/v1/res";
import { getCacheKeyForImage } from "@/lib/image";

/**
 * マイページ上部のプロフィール要約。
 *
 * #1402 【設計】以下を落とした。
 * - **設定への歯車ボタン**: 独立した設定画面が無くなり、この直下が設定項目そのものになったため。
 * - **isOwnProfile / isFollowing / onFollow / onMessage / onBack / onShare**:
 *   このアプリに他ユーザーのプロフィールを開く導線が存在せず（#1402 で調査済み）、
 *   `isOwnProfile` は呼び出し側で `useMemo(() => true)` と書かれた定数だった。
 *   フォロー・メッセージのボタンは到達不能なコードだったので消してある。
 * - **onLayout**: collapsible-tabs へヘッダー高さを渡すためのものだった（タブごと廃止）。
 */
interface ProfileHeaderProps {
	profile: GetUserProfileResponse;
	isGuest?: boolean;
	onEditProfile?: () => void;
	onLogin?: () => void;
}

const formatNumber = (num: number): string => {
	if (num >= 1000000) {
		return `${(num / 1000000).toFixed(1)}M`;
	}
	if (num >= 1000) {
		return `${(num / 1000).toFixed(1)}K`;
	}
	return num.toString();
};

export function ProfileHeader({ profile, isGuest = false, onEditProfile, onLogin }: ProfileHeaderProps) {
	// #1509 テーマ切替はこの画面（マイページ）から行うので、見出しが読めなくならないよう色だけ追従させる
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const avatarUrl = useMemo(() => profile.avatarUrls?.md, [profile]);

	return (
		<View pointerEvents="box-none" style={{ zIndex: 1 }}>
			{/* Header Navigation */}
			<View style={styles.header} pointerEvents="box-none">
				{/* Display Name */}
				{/* #948 【仕様】ゲストは locale 非依存のダミー値(profileData.ts)ではなく現在言語の「ゲスト」表示にする */}
				<Text style={[styles.displayName, { color: colors.textPrimary }]} pointerEvents="none">
					{isGuest ? i18n.t("Profile.guestDisplayName") : profile.display_name}
				</Text>
			</View>

			{/* Profile Info Card */}
			<View style={styles.cardContainer} pointerEvents="box-none">
				<Card style={styles.card} pointerEvents="box-none">
					{/* Avatar and Stats */}
					<View style={[styles.profileHeader]} pointerEvents="none">
						{isGuest ? (
							// ゲストは従来通りアプリアイコンを表示
							<Image
								key={"guest-icon"}
								source={require("@/assets/images/icon.webp")}
								style={styles.avatar}
								contentFit="cover"
								transition={0}
								cachePolicy={"disk"}
							/>
						) : avatarUrl ? (
							// avatarUrl がある場合はその画像を表示
							<Image
								key={avatarUrl}
								source={{ uri: avatarUrl, cacheKey: getCacheKeyForImage(avatarUrl) }}
								style={styles.avatar}
								contentFit="cover"
								transition={0}
								cachePolicy={"disk"}
							/>
						) : (
							// avatarUrl がない場合のフォールバック
							<View style={styles.avatarPlaceholder}>
								<Ionicons name="person-circle-outline" size={48} color={colors.iconPlaceholder} />
							</View>
						)}

						{/* {!isGuest && (
							<View style={styles.statsContainer}>
								<View style={styles.statColumn}>
									<Text style={styles.statNumber}>{formatNumber(profile.followingCount)}</Text>
									<Text style={styles.statLabel}>{i18n.t("Profile.stats.following")}</Text>
								</View>
								<View style={styles.statColumn}>
									<Text style={styles.statNumber}>{formatNumber(profile.followersCount)}</Text>
									<Text style={styles.statLabel}>{i18n.t("Profile.stats.followers")}</Text>
								</View>
								<View style={styles.statColumn}>
									<Text style={styles.statNumber}>{formatNumber(profile.totalLikes)}</Text>
									<Text style={styles.statLabel}>{i18n.t("Profile.stats.likes")}</Text>
								</View>
							</View>
						)} */}
					</View>

					{/* Bio */}
					<Text style={[styles.bio]} pointerEvents="none">
						{isGuest ? i18n.t("Profile.guestBio") : profile.bio}
					</Text>

					{/* Action Buttons */}
					<View style={styles.actionButtons}>
						{isGuest ? (
							<PrimaryButton
								testID="profile-login-button"
								style={{ flex: 1 }}
								onPress={onLogin || (() => {})}
								label={i18n.t("auth.btn_login")}
							/>
						) : (
							<PrimaryButton
								// #1369 編集はモーダルではなくルート（/[locale]/profile/edit）になった。
								// 「押した先」を E2E から検証できるよう、ログインボタンと同じく testID を持たせる
								testID="profile-edit-button"
								style={{ flex: 1 }}
								onPress={onEditProfile || (() => {})}
								label={i18n.t("Profile.buttons.editProfile")}
								shadowColor="transparent"
								// PrimaryButton の地は常に濃い（components/PrimaryButton.tsx は未テーマ化）ため文字側も固定
								icon={<Edit3 size={16} color={FixedColors.onFilled} />}
							/>
						)}
					</View>
				</Card>
			</View>
		</View>
	);
}

// #1469 【設計】テーマ依存のスタイルはファクトリで組む（contexts/ThemeProvider.tsx の useThemedStyles）
const createStyles = (c: Palette) =>
	StyleSheet.create({
		header: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingHorizontal: 16,
			paddingVertical: 12,
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimary,
			letterSpacing: -0.5,
		},
		cardContainer: {},
		card: {
			alignItems: "center",
		},
		profileHeader: {
			flexDirection: "row",
			alignItems: "center",
			marginBottom: 16,
		},
		avatar: {
			width: 80,
			height: 80,
			borderRadius: 20,
			borderWidth: 3,
			borderColor: c.surface,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.15,
			shadowRadius: 8,
			elevation: 6,
		},
		avatarPlaceholder: {
			width: 80,
			height: 80,
			borderRadius: 20,
			borderWidth: 3,
			borderColor: c.surface,
			backgroundColor: c.surfaceSubtle,
			justifyContent: "center",
			alignItems: "center",
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.15,
			shadowRadius: 8,
			elevation: 6,
		},
		statsContainer: {
			flex: 1,
			flexDirection: "row",
			justifyContent: "space-around",
		},
		statColumn: {
			alignItems: "center",
		},
		statNumber: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 2,
			letterSpacing: -0.3,
		},
		statLabel: {
			fontSize: 13,
			color: c.textSecondary,
			fontWeight: "500",
		},
		displayName: {
			flexShrink: 1,
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimary,
			textAlign: "left",
			marginBottom: 8,
			letterSpacing: -0.3,
		},
		bio: {
			fontSize: 15,
			color: c.textSecondary,
			textAlign: "center",
			lineHeight: 20,
			marginBottom: 16,
			fontWeight: "400",
		},
		actionButtons: {
			width: "100%",
			flexDirection: "row",
			gap: 8,
		},
	});
