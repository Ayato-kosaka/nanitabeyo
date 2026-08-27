import React, { type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ImageOff, RefreshCw } from "lucide-react-native";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import i18n from "@/lib/i18n";
import { type DishCategoryImageResourceState } from "@/features/dishCategories/hooks/useDishCategoryImageResources";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

type DishCategoryVisualCardProps = {
	title: string;
	tagline: string;
	imageSource: React.ComponentProps<typeof Image>["source"];
	// #958 【修正】以前は features/dishCategories/constants.ts の CARD_WIDTH(モジュール評価時の
	// window幅で固定、リサイズ非追従・中央カラム幅とも不一致)を直接 import していた。
	// cardHeight と同様に呼び出し元から算出済みの値を渡す方式へ統一
	cardWidth: number;
	cardHeight: number;
	imageState?: DishCategoryImageResourceState;
	recyclingKey?: string;
	topRightContent?: ReactNode;
	bottomContent?: ReactNode;
	onImageRetry?: () => void;
	/** web の URL 共有経路で実際の読み込み失敗を共有 state へ返すための通知。 */
	onImageLoadError?: () => void;
};

export function DishCategoryVisualCard({
	title,
	tagline,
	imageSource,
	cardWidth,
	cardHeight,
	imageState,
	recyclingKey,
	topRightContent,
	bottomContent,
	onImageRetry,
	onImageLoadError,
}: DishCategoryVisualCardProps) {
	const styles = useThemedStyles(createStyles);
	const shouldShowSkeleton = imageState ? imageState.status === "idle" || imageState.status === "loading" : false;
	const shouldShowFailureUI = imageState?.status === "error";
	const resolvedImageSource = imageState?.status === "ready" ? imageState.image : imageSource;
	const shouldRenderImage = !imageState || imageState.status === "ready";

	return (
		<View style={[styles.card, { width: cardWidth, height: cardHeight }]}>
			{/* #802/#929 【設計】DishCategories では共有 state の source だけを描画し、Carousel 内の
			    onLoad/onLoadEnd 順序を ready 判定に使わない。native の source は取得済み
			    ImageRef なので、下の cachePolicy は loadAsync の disk cache を制御しない。 */}
			{shouldRenderImage ? (
				<Image
					source={resolvedImageSource}
					// #785 【設計】同一 URL を異なる cachePolicy で読み込むと iOS の画像パイプラインが
					// 分かれてイベントが欠落し得るため、既存の memory 契約を呼び出しごとに変えない。
					cachePolicy="memory"
					transition={100}
					style={styles.cardImage}
					recyclingKey={recyclingKey}
					contentFit="cover"
					// #937 【仕様】料理名を伝える情報画像として alt/accessibilityLabel を付与する
					alt={title}
					accessibilityLabel={title}
					onError={onImageLoadError}
				/>
			) : (
				<View style={styles.cardImage} />
			)}

			{shouldShowSkeleton && (
				<View style={styles.skeletonOverlay}>
					<SkeletonShimmer width="100%" height="100%" borderRadius={24} />
				</View>
			)}

			<View style={styles.cardOverlay}>
				{/* #1008 【パフォーマンス】タイトル・説明文のtextShadowを撤去した分、下部グラデーションの
				    不透明度を上げて可読性を担保する */}
				<LinearGradient
					pointerEvents="none"
					colors={["rgba(0, 0, 0, 0.00)", "rgba(0, 0, 0, 0.32)", "rgba(0, 0, 0, 0.62)"]}
					locations={[0, 0.58, 1]}
					style={styles.bottomGradient}
				/>
				{shouldShowFailureUI && (
					<View style={styles.failureOverlay}>
						<View style={styles.failureContent}>
							{/* 料理写真の面（読み込み失敗時も暗いスクリムの上）に載るアイコンなので固定の白でよい */}
							<ImageOff size={48} color={FixedColors.onMedia} strokeWidth={1.5} />
							<Text style={styles.failureText}>{i18n.t("DishCategories.imageLoadFailed")}</Text>
							{onImageRetry ? (
								<TouchableOpacity style={styles.retryButton} onPress={onImageRetry} activeOpacity={0.8}>
									{/* 半透明の黒で塗ったボタンの上。地が固定なのでアイコンも固定の白 */}
									<RefreshCw size={16} color={FixedColors.onMedia} />
									<Text style={styles.retryText}>{i18n.t("DishCategories.tapToReload")}</Text>
								</TouchableOpacity>
							) : null}
						</View>
					</View>
				)}

				{topRightContent ? <View style={styles.topRightContent}>{topRightContent}</View> : null}

				<View style={styles.cardContent}>
					<Text style={styles.cardTitle}>{title}</Text>
					<Text style={styles.cardDescription}>{tagline}</Text>
					{bottomContent}
				</View>
			</View>
		</View>
	);
}

// #1629 【修正】画像が載る前に覗くカードの地と影がライト固定の直書きで、ダークでも明るい矩形が出ていた。
// 写真の上に載る文字・アイコンは地が常に暗いメディアなので FixedColors（固定の白）のままにする。
const createStyles = (colors: Palette) =>
	StyleSheet.create({
		card: {
			borderRadius: 24,
			overflow: "hidden",
			backgroundColor: colors.dividerMuted,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.3,
			// #1008 【パフォーマンス】parallaxモードのスケール変換と重なるとAndroidでオーバードロー・
			// ラスタライズ負荷が増えるため、shadowRadius/elevationを縮小する。
			shadowRadius: 12,
			elevation: 6,
			position: "relative",
		},
		cardImage: {
			width: "100%",
			height: "100%",
		},
		skeletonOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			zIndex: 1,
		},
		failureOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: "center",
			alignItems: "center",
			zIndex: 2,
		},
		failureContent: {
			alignItems: "center",
			gap: 16,
		},
		failureText: {
			fontSize: 16,
			// 料理写真（読み込み失敗時は暗いスクリム）の上に載る文字なので固定の白
			color: FixedColors.onMedia,
			fontWeight: "600",
			textAlign: "center",
		},
		retryButton: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			backgroundColor: "rgba(0, 0, 0, 0.3)",
			paddingHorizontal: 20,
			paddingVertical: 12,
			borderRadius: 24,
		},
		retryText: {
			fontSize: 14,
			// 半透明の黒で塗ったボタンの上。地が固定なので文字も固定の白
			color: FixedColors.onMedia,
			fontWeight: "600",
		},
		cardOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			padding: 24,
			justifyContent: "space-between",
			zIndex: 3,
		},
		bottomGradient: {
			position: "absolute",
			left: 0,
			right: 0,
			bottom: 0,
			height: "72%",
		},
		topRightContent: {
			alignSelf: "flex-end",
			gap: 12,
			zIndex: 4,
		},
		cardContent: {
			flex: 1,
			justifyContent: "flex-end",
			zIndex: 1,
			paddingBottom: 8,
		},
		// #1008 【パフォーマンス】textShadowはAndroidでラスタライズ負荷になるため撤去し、
		// 可読性は上の bottomGradient の不透明度側で担保する。
		cardTitle: {
			fontSize: 32,
			fontWeight: "700",
			// 料理写真＋下部グラデーションの上に載る見出し。地が常に暗いメディアなので固定の白
			color: FixedColors.onMedia,
			marginBottom: 16,
			lineHeight: 40,
			letterSpacing: -0.5,
		},
		cardDescription: {
			fontSize: 18,
			// 同上（写真の上の説明文）
			color: FixedColors.onMedia,
			lineHeight: 28,
			marginBottom: 18,
			fontWeight: "500",
		},
	});
