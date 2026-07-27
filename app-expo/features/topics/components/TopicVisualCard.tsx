import React, { type ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ImageOff, RefreshCw } from "lucide-react-native";
import { SkeletonShimmer } from "@/components/SkeletonShimmer";
import i18n from "@/lib/i18n";
import { type TopicImageResourceState } from "@/features/topics/hooks/useTopicImageResources";

type TopicVisualCardProps = {
	title: string;
	tagline: string;
	imageSource: React.ComponentProps<typeof Image>["source"];
	// #958 【修正】以前は features/topics/constants.ts の CARD_WIDTH(モジュール評価時の
	// window幅で固定、リサイズ非追従・中央カラム幅とも不一致)を直接 import していた。
	// cardHeight と同様に呼び出し元から算出済みの値を渡す方式へ統一
	cardWidth: number;
	cardHeight: number;
	imageState?: TopicImageResourceState;
	recyclingKey?: string;
	topRightContent?: ReactNode;
	bottomContent?: ReactNode;
	onImageRetry?: () => void;
	/** #929 【設計】表示側 <Image> の読み込み失敗通知。web は取得を介さず URL を直接渡すため、
	 * ここで初めて失敗が分かる(PR #980 レビュー指摘)。呼び出し元が error 状態へ遷移させる */
	onImageLoadError?: () => void;
};

export function TopicVisualCard({
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
}: TopicVisualCardProps) {
	const shouldShowSkeleton = imageState ? imageState.status === "idle" || imageState.status === "loading" : false;
	const shouldShowFailureUI = imageState?.status === "error";
	const resolvedImageSource = imageState?.status === "ready" ? imageState.image : imageSource;
	const shouldRenderImage = !imageState || imageState.status === "ready";

	return (
		<View style={[styles.card, { width: cardWidth, height: cardHeight }]}>
			{/* #802 【設計】Topics ではプリロード済み ImageRef(web は直接指定の uri)を優先し、Carousel 内 Image の load 順序に依存しない。 */}
			{shouldRenderImage ? (
				<Image
					source={resolvedImageSource}
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
				<LinearGradient
					pointerEvents="none"
					colors={["rgba(0, 0, 0, 0.00)", "rgba(0, 0, 0, 0.18)", "rgba(0, 0, 0, 0.40)"]}
					locations={[0, 0.58, 1]}
					style={styles.bottomGradient}
				/>
				{shouldShowFailureUI && (
					<View style={styles.failureOverlay}>
						<View style={styles.failureContent}>
							<ImageOff size={48} color="#FFF" strokeWidth={1.5} />
							<Text style={styles.failureText}>{i18n.t("Topics.imageLoadFailed")}</Text>
							{onImageRetry ? (
								<TouchableOpacity style={styles.retryButton} onPress={onImageRetry} activeOpacity={0.8}>
									<RefreshCw size={16} color="#FFF" />
									<Text style={styles.retryText}>{i18n.t("Topics.tapToReload")}</Text>
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

const styles = StyleSheet.create({
	card: {
		borderRadius: 24,
		overflow: "hidden",
		backgroundColor: "#EEE",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.3,
		shadowRadius: 32,
		elevation: 12,
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
		color: "#FFF",
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
		color: "#FFF",
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
	cardTitle: {
		fontSize: 32,
		fontWeight: "700",
		color: "#FFFFFF",
		marginBottom: 16,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 2 },
		textShadowRadius: 4,
		lineHeight: 40,
		letterSpacing: -0.5,
	},
	cardDescription: {
		fontSize: 18,
		color: "#FFFFFF",
		lineHeight: 28,
		marginBottom: 18,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 3,
		fontWeight: "500",
	},
});
