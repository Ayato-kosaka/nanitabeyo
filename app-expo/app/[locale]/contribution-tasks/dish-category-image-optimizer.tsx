// app-expo/app/[locale]/contribution-tasks/dish-category-image-optimizer.tsx
//
// #494 【フロント】dish_categories 用 画像最適化ツールページ
// 運営用ツール - ユーザー向けアプリからの導線は不要

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import {
	View,
	StyleSheet,
	ScrollView,
	Pressable,
	Text,
	FlatList,
	ListRenderItemInfo,
	useWindowDimensions,
	TouchableOpacity,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";

import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { useWithLoading } from "@/hooks/useWithLoading";
import { useLegacyBlurModal } from "@/features/contributionTasks/legacyBlurModal/useLegacyBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

import type {
	PopularDishCategoriesWithMediaResponse,
	PopularDishCategoryWithMedia,
	CandidateDishMedia,
} from "@shared/api/v1/res";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

/** #494 【設計】選択状態を管理するマップ型 */
type SelectedMap = Record<string, string>; // categoryId -> dishMediaId

/* -------------------------------------------------------------------------- */
/*                                  メインページ                               */
/* -------------------------------------------------------------------------- */

export default function DishCategoryImageOptimizerPage() {
	const insets = useSafeAreaInsets();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { width: screenWidth, height: screenHeight } = useWindowDimensions();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { isLoading: isLoadingCategories, withLoading: withLoadingCategories } = useWithLoading();
	const { isLoading: isSubmitting, withLoading: withSubmitting } = useWithLoading();

	// #494 【設計】ローカルstate: カテゴリ一覧
	const [categories, setCategories] = useState<PopularDishCategoriesWithMediaResponse>([]);
	// #494 【設計】ローカルstate: 選択マップ (categoryId -> dishMediaId)
	const [selectedMap, setSelectedMap] = useState<SelectedMap>({});
	// #494 【設計】モーダル用: 現在選択中のカテゴリ
	const [activeCategory, setActiveCategory] = useState<PopularDishCategoryWithMedia | null>(null);
	// #494 【設計】説明文表示フラグ
	const [showDescription, setShowDescription] = useState(false);

	const { LegacyBlurModal, open: openModal, close: closeModal } = useLegacyBlurModal({ intensity: 80 });

	// #494 【設計】カテゴリグリッドの列数とサイズ計算
	const COLUMNS = 3;
	const GAP = 8;
	const PADDING_HORIZONTAL = 16;
	const cardWidth = (screenWidth - PADDING_HORIZONTAL * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
	const cardHeight = (cardWidth / 9) * 16;

	// #494 【設計】候補画像グリッドの列数とサイズ
	const MODAL_COLUMNS = 3;
	const MODAL_GAP = 4;
	const MODAL_PADDING = 16;
	const modalCardWidth = (screenWidth - MODAL_PADDING * 2 - MODAL_GAP * (MODAL_COLUMNS - 1)) / MODAL_COLUMNS;
	const modalCardHeight = (modalCardWidth / 9) * 16;
	const modalScrollViewHeight = screenHeight - 120;

	/* ------------------------------------------------------------------ */
	/*                             API呼び出し                             */
	/* ------------------------------------------------------------------ */

	/** #494 【API①】人気カテゴリと候補メディア一覧を取得 */
	const fetchCategories = useCallback(async () => {
		try {
			const result = await callBackend<{}, PopularDishCategoriesWithMediaResponse>(
				"tools/dish-categories/popular-with-media",
				{ method: "GET", requestPayload: {} },
			);

			setCategories(result);
			logFrontendEvent({
				event_name: "tools_categories_loaded",
				error_level: "log",
				payload: { count: result.length },
			});
		} catch (error) {
			// #1476 【設計】403（forbidden）は **権限機構が正しく拒否した結果**で、壊れていない。
			// この画面は内部作業用（sitemap 対象外・アプリ内リンク無し）なので、権限の無い人が
			// URL を直接開けば必ずこうなる。人間の対応は要らない。
			//
			// 実測（本番 2026-08-20T12:33:08Z / 1 ユーザー）: 匿名のまま ko-KR でこの URL を開き、
			// 403 を受けてそのまま離脱している。壊れた機能を踏んだのではなく、入れない扉を押しただけ。
			//
			// ⚠️ forbidden 以外は error のまま残すこと。tools API 自体が落ちたときの信号を消さない。
			const isForbidden = (error as ApiError | null | undefined)?.code === "forbidden";
			logFrontendEvent({
				event_name: "tools_categories_error",
				error_level: isForbidden ? "warn" : "error",
				payload: { error },
			});
			showSnackbar(i18n.t("Common.error"));
		}
	}, [callBackend, logFrontendEvent, showSnackbar]);

	/** #494 【API②】選択されたメディアでカテゴリ画像を一括更新 */
	const submitUpdates = useCallback(async () => {
		const items = Object.entries(selectedMap).map(([dishCategoryId, dishMediaId]) => ({
			dishCategoryId,
			dishMediaId,
		}));

		if (items.length === 0) {
			showSnackbar(i18n.t("Tools.DishCategoryImageOptimizer.empty"));
			return;
		}

		// #1599 【バグ】ここは送信処理が丸ごとコメントアウトされたまま、ボタンだけが
		// 生きていた。例外が起きようがないので下の catch も発火せず、
		// **ローディングが一瞬出て消えるだけで成功も失敗も一切通知されない**。
		// 操作者からは «更新できた» のか «何も起きなかった» のか区別が付かない。
		//
		// 【調べた結果】コメントアウトは消し忘れではなく、**API 側が存在しない**ため。
		//   - `api/src/tools/dish-categories/tools-dish-categories.controller.ts` は
		//     `GET popular-with-media` の 1 本だけで、`POST update-images` は無い
		//   - `UpdateDishCategoryImagesDto` / `UpdateDishCategoryImagesResponse` も
		//     リポジトリのどこにも存在しない（このコメントの中にしか出てこない）
		//
		// つまり **そのまま復活させても型が解決せず、通っても 404 になる**。
		// 直し方は «API を作る» であってフロントの復活ではないので、ここでは
		// «出来ないことを出来ないと言う» ところまでにしておく。
		// API（#494 の【API②】）が入ったら、この分岐ごと置き換えること。
		logFrontendEvent({
			event_name: "tools_images_update_unavailable",
			error_level: "warn",
			payload: { count: items.length },
		});
		showSnackbar(i18n.t("Tools.DishCategoryImageOptimizer.submitUnavailable"));
	}, [selectedMap, showSnackbar, logFrontendEvent]);

	/* ------------------------------------------------------------------ */
	/*                           イベントハンドラ                          */
	/* ------------------------------------------------------------------ */

	/** #494 【設計】カテゴリカードタップ → モーダルを開く */
	const handleCategoryPress = useCallback(
		(category: PopularDishCategoryWithMedia) => {
			lightImpact();
			setActiveCategory(category);
			openModal();
		},
		[lightImpact, openModal],
	);

	/** #494 【設計】候補画像タップ → 選択状態を更新 */
	const handleMediaSelect = useCallback(
		(categoryId: string, mediaId: string) => {
			lightImpact();
			setSelectedMap((prev) => {
				if (prev[categoryId] === mediaId) {
					// 同じものをタップしたら選択解除
					const { [categoryId]: _, ...rest } = prev;
					return rest;
				}
				return { ...prev, [categoryId]: mediaId };
			});
			closeModal();
		},
		[lightImpact, closeModal],
	);

	/** #494 【設計】リセットボタン */
	const handleReset = useCallback(() => {
		lightImpact();
		setSelectedMap({});
	}, [lightImpact]);

	/* ------------------------------------------------------------------ */
	/*                           初期データ取得                            */
	/* ------------------------------------------------------------------ */

	useEffect(() => {
		withLoadingCategories(fetchCategories)();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/* ------------------------------------------------------------------ */
	/*                             選択件数                                */
	/* ------------------------------------------------------------------ */

	const selectedCount = Object.keys(selectedMap).length;

	/* ------------------------------------------------------------------ */
	/*                             レンダリング                            */
	/* ------------------------------------------------------------------ */

	/** #494 【設計】カテゴリカードのレンダリング */
	const renderCategoryCard = useCallback(
		(info: ListRenderItemInfo<PopularDishCategoryWithMedia>) => {
			const { item } = info;
			const isSelected = !!selectedMap[item.dishCategory.id];
			const selectedMedia = isSelected
				? item.candidateMedia.find((m) => m.id === selectedMap[item.dishCategory.id])
				: null;

			// 選択済みの場合は選択したメディアのサムネイルを表示、未選択の場合は元のカテゴリ画像
			const imageUrl = selectedMedia?.mediaSignedUrl || item.dishCategory.image_url;

			return (
				<Pressable
					style={[styles.categoryCard, { width: cardWidth, height: cardHeight }]}
					onPress={() => handleCategoryPress(item)}
					android_ripple={{ color: "rgba(0,0,0,0.1)" }}>
					<Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={100} />
					{/* オーバーレイ */}
					<View style={styles.categoryOverlay}>
						<Text style={styles.categoryLabel} numberOfLines={2}>
							{item.dishCategory.name}
						</Text>
						<Text style={styles.categoryCount}>
							{i18n.t("Tools.DishCategoryImageOptimizer.dishCount", { count: item.dishCount })}
						</Text>
					</View>
					{/* 選択チェックマーク */}
					{isSelected && (
						<View style={styles.checkBadge}>
							{/* 緑（successFill）で塗り潰したバッジの上の白。地の色が振れないので文字も振らない */}
							<Check size={16} color={FixedColors.onFilled} />
						</View>
					)}
				</Pressable>
			);
		},
		[cardWidth, cardHeight, selectedMap, handleCategoryPress, styles],
	);

	/** #494 【設計】候補画像のレンダリング */
	const renderCandidateMedia = useCallback(
		(media: CandidateDishMedia) => {
			if (!activeCategory) return null;
			const isSelected = selectedMap[activeCategory.dishCategory.id] === media.id;

			return (
				<Pressable
					key={media.id}
					style={[
						styles.candidateCard,
						{ width: modalCardWidth, height: modalCardHeight },
						isSelected && styles.candidateCardSelected,
					]}
					onPress={() => handleMediaSelect(activeCategory.dishCategory.id, media.id)}
					android_ripple={{ color: "rgba(0,0,0,0.1)" }}>
					<Image
						source={{ uri: media.mediaSignedUrl }}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						transition={100}
					/>
					{isSelected && (
						<View style={styles.candidateCheckBadge}>
							{/* 同上。塗り潰したバッジの上の白 */}
							<Check size={20} color={FixedColors.onFilled} />
						</View>
					)}
				</Pressable>
			);
		},
		[activeCategory, selectedMap, modalCardWidth, modalCardHeight, handleMediaSelect, styles],
	);

	const keyExtractor = useCallback((item: PopularDishCategoryWithMedia) => item.dishCategory.id, []);

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>{i18n.t("Tools.DishCategoryImageOptimizer.title")}</Text>
			</View>

			{/* 使い方説明 */}
			<View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
				<TouchableOpacity
					onPress={() => setShowDescription(!showDescription)}
					style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6 }}>
					<Text style={{ fontSize: 14, fontWeight: "600", flex: 1 }}>
						{showDescription ? "この画面の使い方を閉じる" : "この画面の使い方を開く"}
					</Text>
					<Text style={{ fontSize: 16 }}>{showDescription ? "▲" : "▼"}</Text>
				</TouchableOpacity>

				{showDescription && (
					<Text style={{ fontSize: 12, lineHeight: 18, color: colors.textSecondaryAlt, marginTop: 4 }}>
						料理提案画面に表示される画像を、より高品質な写真へ差し替えるための管理ツールです。
						{"\n\n"}
						1. 下のグリッドから、画像を変更したい料理をタップします。
						{"\n"}
						2. 候補画像が表示されるので、美味しそうと思える写真を1枚選びます。
						{"\n"}
						3. 変更したい料理にチェックが付け終えたら、画面下の「画像を更新」を押してください。
						{"\n"}
						4. サーバーへ反映され、画像が更新されます。
						{"\n\n"}※ 美味しそうと思える写真がない場合は、何も選ばずにモーダルを閉じてください。
						{"\n"}※ 選択した候補画像を再度選択すると、選択が解除されます。
						{"\n"}※ 「リセット」ボタンで、選択をすべて解除できます。
					</Text>
				)}
			</View>

			{/* ローディング */}
			{isLoadingCategories && (
				<View style={styles.loadingContainer}>
					<LoadingIndicator size="large" />
					<Text style={styles.loadingText}>{i18n.t("Tools.DishCategoryImageOptimizer.loading")}</Text>
				</View>
			)}

			{/* カテゴリグリッド */}
			{!isLoadingCategories && categories.length > 0 && (
				<FlatList
					data={categories}
					renderItem={renderCategoryCard}
					keyExtractor={keyExtractor}
					numColumns={COLUMNS}
					columnWrapperStyle={{ gap: GAP }}
					contentContainerStyle={[styles.gridContainer, { paddingHorizontal: PADDING_HORIZONTAL }]}
					showsVerticalScrollIndicator={false}
				/>
			)}

			{/* 空状態 */}
			{!isLoadingCategories && categories.length === 0 && (
				<View style={styles.emptyContainer}>
					<Image
						source={{
							uri: "https://ak1520r-filenow-12.filenowsv.com/thumbs/20251202-0651_f6244248ed4f8e33603b8fbb540ce4a5.jpg",
						}}
						style={styles.emptyImage}
						contentFit="contain"
						cachePolicy={"none"}
						transition={100}
					/>
				</View>
			)}

			{/* フッター: 送信ボタン */}
			{selectedCount > 0 && (
				<View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
					<PrimaryButton
						label={
							isSubmitting
								? i18n.t("Tools.DishCategoryImageOptimizer.submitting")
								: `${i18n.t("Tools.DishCategoryImageOptimizer.submit")} (${selectedCount})`
						}
						onPress={withSubmitting(submitUpdates)}
						loading={isSubmitting}
						disabled={isSubmitting}
					/>
					<PrimaryButton
						label={i18n.t("Tools.DishCategoryImageOptimizer.reset")}
						onPress={handleReset}
						colors={colors.buttonNeutralGradient}
						style={{ marginTop: 8 }}
					/>
				</View>
			)}

			{/* 候補画像選択モーダル */}
			<LegacyBlurModal contentContainerStyle={styles.modalContent}>
				{activeCategory && (
					<View style={{ flex: 1 }}>
						<Text style={styles.modalTitle}>{activeCategory.dishCategory.name}</Text>
						<Text style={styles.modalSubtitle}>{i18n.t("Tools.DishCategoryImageOptimizer.candidateImages")}</Text>

						{activeCategory.candidateMedia.length > 0 ? (
							<ScrollView style={{ height: modalScrollViewHeight }} contentContainerStyle={styles.candidateGrid}>
								<View style={styles.candidateGridInner}>{activeCategory.candidateMedia.map(renderCandidateMedia)}</View>
							</ScrollView>
						) : (
							<View style={styles.noCandidatesContainer}>
								<Text style={styles.noCandidatesText}>{i18n.t("Tools.DishCategoryImageOptimizer.noCandidates")}</Text>
							</View>
						)}
					</View>
				)}
			</LegacyBlurModal>
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */

// #1629 パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.background,
		},
		header: {
			paddingHorizontal: 16,
			paddingVertical: 12,
			backgroundColor: c.surface,
			borderBottomWidth: 1,
			borderBottomColor: c.border,
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimary,
		},
		loadingContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
		},
		loadingText: {
			marginTop: 12,
			fontSize: 14,
			color: c.textSecondary,
		},
		gridContainer: {
			paddingTop: 16,
			paddingBottom: 120,
			gap: 8,
		},
		categoryCard: {
			backgroundColor: c.surfacePlaceholderAlt,
			borderRadius: 8,
			overflow: "hidden",
			position: "relative",
		},
		categoryOverlay: {
			position: "absolute",
			bottom: 0,
			left: 0,
			right: 0,
			padding: 8,
			backgroundColor: "rgba(0,0,0,0.5)",
		},
		categoryLabel: {
			fontSize: 12,
			fontWeight: "600",
			color: FixedColors.onMedia,
		},
		categoryCount: {
			fontSize: 10,
			color: "rgba(255,255,255,0.8)",
			marginTop: 2,
		},
		checkBadge: {
			position: "absolute",
			top: 8,
			right: 8,
			width: 24,
			height: 24,
			borderRadius: 12,
			backgroundColor: c.successFill,
			justifyContent: "center",
			alignItems: "center",
		},
		emptyContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingVertical: 24,
		},
		emptyText: {
			fontSize: 14,
			color: c.textSecondary,
		},
		emptyImage: {
			width: "100%",
			height: "100%",
			marginVertical: 8,
		},
		footer: {
			position: "absolute",
			bottom: 0,
			left: 0,
			right: 0,
			padding: 16,
			backgroundColor: c.surface,
			borderTopWidth: 1,
			borderTopColor: c.border,
		},
		modalContent: {
			paddingHorizontal: 16,
			paddingTop: 16,
		},
		modalTitle: {
			fontSize: 18,
			fontWeight: "700",
			color: c.textPrimary,
			marginBottom: 4,
		},
		modalSubtitle: {
			fontSize: 14,
			color: c.textSecondary,
			marginBottom: 16,
		},
		candidateGrid: {
			paddingBottom: 32,
		},
		candidateGridInner: {
			flexDirection: "row",
			flexWrap: "wrap",
			gap: 4,
		},
		candidateCard: {
			backgroundColor: c.surfacePlaceholderAlt,
			borderRadius: 4,
			overflow: "hidden",
			position: "relative",
		},
		candidateCardSelected: {
			borderWidth: 3,
			borderColor: c.successStrong,
		},
		candidateCheckBadge: {
			position: "absolute",
			top: 4,
			right: 4,
			width: 28,
			height: 28,
			borderRadius: 14,
			backgroundColor: c.successFill,
			justifyContent: "center",
			alignItems: "center",
		},
		noCandidatesContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
		},
		noCandidatesText: {
			fontSize: 14,
			color: c.textSecondary,
		},
	});
