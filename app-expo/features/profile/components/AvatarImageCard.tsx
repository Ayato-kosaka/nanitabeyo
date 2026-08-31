import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import i18n from "@/lib/i18n";
import { Card } from "@/components/Card";
import { MediaData, recoverPendingMedia, selectMedia } from "@/lib/mediaSelection";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { getCacheKeyForImage } from "@/lib/image";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

/**
 * #1750 保留結果の持ち主の名前。`selectMedia({ pendingOwner })` と
 * `recoverPendingMedia({ owner })` で同じ値を使うことで、
 * «料理写真として選んだものがアバターに入る» 取り違えを防ぐ（lib/mediaSelection.ts 参照）。
 */
const AVATAR_PICKER_OWNER = "profile-avatar";

interface AvatarImageCardProps {
	/** 現在のアバター画像URL（なければプレースホルダ） */
	avatarUrl: string | null | undefined;
	/** 画像選択ボタン押下時のコールバック */
	onSelectImage: (media: Pick<MediaData, "uri" | "mimeType">) => void;
	/** レイアウト計測用コールバック */
	onLayout?: (event: any) => void;
}

/**
 * プロフィール画像カード
 * - 現在の画像を表示
 * - タップで新しい画像を選択
 */
export function AvatarImageCard({ avatarUrl, onSelectImage, onLayout }: AvatarImageCardProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);

	const [isLoading, setIsLoading] = useState(false);

	const handleSelectImage = useCallback(async () => {
		setIsLoading(true);
		lightImpact();
		try {
			const result = await selectMedia(["images"], {
				allowsEditing: true, // 編集モードを有効化（正方形トリミング）
				aspect: [1, 1], // 正方形のアスペクト比
				// #1750 Android で殺されたときに、この画面«だけ»が拾えるようにする印
				pendingOwner: AVATAR_PICKER_OWNER,
			});
			if (result.success && result.media) onSelectImage({ uri: result.media.uri, mimeType: result.media.mimeType });
			else if (result.error === "permission_denied") showSnackbar(i18n.t("Profile.errors.permissionDenied"));
			// #1425 HEIC / HEIF は «選ばせない» のが正しい失敗なので、例外にせず案内だけ出す
			else if (result.error === "unsupported_image_format") showSnackbar(i18n.t("Map.media.unsupportedImageFormat"));
			else if (result.error === "cancelled") {
			} // ユーザーキャンセルは無視
			else {
				showSnackbar(i18n.t("Map.media.mediaSelectionFailed"));
				throw new Error("Media selection failed: " + result.errorMessage);
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "avatar_image_selection_failed",
				error_level: "error",
				payload: { error: (error as Error).message },
			});
		} finally {
			setIsLoading(false);
		}
	}, [lightImpact, logFrontendEvent, onSelectImage, showSnackbar]);

	/**
	 * #1750 【バグ】**Android がピッカー中に MainActivity を殺すと、選んだ画像が黙って消える。**
	 *
	 * このとき `selectMedia` の Promise は解決も棄却もしないので、`handleSelectImage` の
	 * `catch` も `finally` も走らない。ユーザーには「画像を選んだのに、保存しても反映されない」
	 * としか見えず、フロントのログにも何も残らなかった（この不具合の調査で、dev / 本番とも
	 * オーナーの実機セッションに `CreateSignedUrl(user-avatar)` が 1 件も無いことを確認している）。
	 *
	 * expo-image-picker はこのために `getPendingResultAsync()` を用意している。
	 * **アプリが作り直されたあと 1 度だけ**取りに行けば、失われた選択を復元できる。
	 *
	 * ⚠️ この画面がマウントされたときにだけ呼ぶこと。保留結果そのものは «どの画面のものか» を
	 * 持たないので、`AVATAR_PICKER_OWNER` の印が一致したときだけ拾う。
	 * `hasRecoveredRef` で 1 マウント 1 回に固定してあるのは、再レンダーのたびに取りに行くと
	 * «ユーザーが選び直した画像を、古い保留結果で上書きする» ことになるためである。
	 */
	const hasRecoveredRef = useRef(false);
	useEffect(() => {
		if (hasRecoveredRef.current) return;
		hasRecoveredRef.current = true;

		let cancelled = false;
		void (async () => {
			const recovered = await recoverPendingMedia({ owner: AVATAR_PICKER_OWNER });
			if (!recovered || cancelled) return;

			if (recovered.success && recovered.media) {
				logFrontendEvent({
					event_name: "avatar_image_selection_recovered",
					error_level: "warn",
					payload: { mimeType: recovered.media.mimeType },
				});
				onSelectImage({ uri: recovered.media.uri, mimeType: recovered.media.mimeType });
				return;
			}

			// 復帰できなかったこと自体を残す。«何も起きていない» と区別が付かなくなるのが一番困る
			logFrontendEvent({
				event_name: "avatar_image_selection_recovery_failed",
				error_level: "warn",
				payload: { error: recovered.error, errorMessage: recovered.errorMessage },
			});
		})();

		return () => {
			cancelled = true;
		};
		// マウント時 1 回だけ。onSelectImage は毎レンダー新しくなりうるので依存に入れない
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<Card onLayout={onLayout}>
			<Text style={styles.label}>{i18n.t("Profile.labels.profileImage")}</Text>

			<View style={styles.avatarWrapper}>
				<TouchableOpacity
					style={styles.avatarContainer}
					onPress={handleSelectImage}
					disabled={isLoading}
					activeOpacity={0.8}>
					{isLoading ? (
						<View style={styles.avatarPlaceholder}>
							<LoadingIndicator size="large" />
						</View>
					) : avatarUrl ? (
						<Image
							source={{ uri: avatarUrl, cacheKey: getCacheKeyForImage(avatarUrl) }}
							style={styles.avatar}
							contentFit="cover"
						/>
					) : (
						<View style={styles.avatarPlaceholder}>
							<Ionicons name="person-circle-outline" size={64} color={colors.iconPlaceholder} />
						</View>
					)}

					{/* カメラアイコンオーバーレイ */}
					<View style={styles.cameraIconContainer}>
						{/* ブランド色で塗り潰した丸バッジの上のアイコン。地（brand）がライト / ダークで
					    変わらないので、アイコンもテーマで振らない */}
						<Ionicons name="camera" size={20} color={FixedColors.onFilled} />
					</View>
				</TouchableOpacity>
			</View>

			<Text style={styles.hint}>{i18n.t("Profile.hints.tapToSelectImage")}</Text>
		</Card>
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
			marginBottom: 16,
			alignSelf: "flex-start",
		},
		avatarWrapper: {
			alignItems: "center",
		},
		avatarContainer: {
			width: 120,
			height: 120,
			marginBottom: 8,
			position: "relative",
		},
		avatar: {
			width: "100%",
			height: "100%",
			overflow: "hidden",
			borderRadius: 20,
			borderWidth: 3,
			borderColor: c.surface,
			// 影はテーマに依らず黒。暗面では実質見えないだけで、値としては黒のままでよい
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.15,
			shadowRadius: 8,
			elevation: 6,
		},
		avatarPlaceholder: {
			width: "100%",
			height: "100%",
			backgroundColor: c.surfaceSubtle,
			justifyContent: "center",
			alignItems: "center",
		},
		cameraIconContainer: {
			position: "absolute",
			bottom: 0,
			right: 0,
			width: 36,
			height: 36,
			borderRadius: 18,
			backgroundColor: c.brand,
			justifyContent: "center",
			alignItems: "center",
			borderWidth: 2,
			borderColor: c.surface,
		},
		hint: {
			fontSize: 12,
			color: c.textSecondary,
			textAlign: "center",
		},
	});
