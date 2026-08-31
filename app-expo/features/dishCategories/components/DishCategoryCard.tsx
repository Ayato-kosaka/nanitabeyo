import React, { useCallback, useEffect, useRef } from "react";
import { Text, TouchableOpacity, StyleSheet, View } from "react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { router } from "expo-router";
import { Bookmark, Ban } from "lucide-react-native";
import { DishCategoryRecommendation } from "@/types/search";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { toggleReaction } from "@/lib/reactions";
import { DishCategoriesStore, selectIsDishCategorySaved, useDishCategoriesStore } from "@/stores/useDishCategoriesStore";
import { profileSavedDishCategoriesEntriesKey } from "@/features/profile/tabs/SavedDishCategoriesTab";
import i18n from "@/lib/i18n";
import { toErrorLogMessage } from "@/lib/errorMessage";
import { type DishCategoryImageResourceState } from "@/features/dishCategories/hooks/useDishCategoryImageResources";
import type { DishCategoriesTutorialTargetRefs } from "@/features/tutorial/types/spotlight";
import { DishCategoryVisualCard } from "./DishCategoryVisualCard";
import type { CardRect } from "./DishCategoryCardExpandTransition";

export type DishCategoryDeepDiveOption = {
	key: string;
	label: string;
	featureType: string;
	featureKey: string;
};

export const DISH_CATEGORY_CARD_CTA_OVERHANG = 14;

export const DishCategoryCard = ({
	item,
	onBlock,
	onDeepDive,
	onSelect,
	deepDiveOptions = [],
	cardWidth,
	cardHeight,
	imageState,
	isSelecting = false,
	onImageRetry,
	onImageLoadError,
	tutorialTargetRefs,
}: {
	item: DishCategoryRecommendation;
	onBlock: (dishCategory: DishCategoryRecommendation) => void;
	onDeepDive?: (dishCategory: DishCategoryRecommendation, option: DishCategoryDeepDiveOption) => void;
	/** #1484 【設計】origin は押されたカード画像自身の実測矩形。拡大アニメーションの開始位置に使う。 */
	onSelect: (dishCategory: DishCategoryRecommendation, originRect?: CardRect) => void;
	deepDiveOptions?: DishCategoryDeepDiveOption[];
	// #958 【修正】CARD_WIDTH の直接 import(window幅固定・中央カラム幅と不一致)をやめ、
	// cardHeight と同様に呼び出し元(dishCategories.tsx)から算出済みの値を受け取る
	cardWidth: number;
	cardHeight: number;
	imageState: DishCategoryImageResourceState;
	isSelecting?: boolean;
	onImageRetry?: (dishCategory: DishCategoryRecommendation) => void;
	/** #929 【設計】表示側 <Image> の読み込み失敗通知(DishCategoryVisualCard から中継) */
	onImageLoadError?: (dishCategory: DishCategoryRecommendation) => void;
	/**
	 * アクティブなCarouselカードにだけ渡すチュートリアル用ref。
	 *
	 * 非表示カードにも同じrefを渡すと、Carouselの事前描画・再利用により
	 * 画面外カードの座標で上書きされるため、親画面でactive indexを判定する。
	 */
	tutorialTargetRefs?: Pick<DishCategoriesTutorialTargetRefs, "swipeArea" | "selectCta" | "deepDive" | "dishCategoryActions">;
}) => {
	const styles = useThemedStyles(createStyles);
	// #1007 【設計】isSaved をローカル useState ではなく useDishCategoriesStore の savedByTopicId から
	// 購読する（ActionButtons.tsx と同じ per-entity selector パターン）。Carousel の key 撤去で
	// カードが再利用されても、dishCategory.categoryId 単位の状態としてstore側に保持されるため引き継がれる。
	// store未登録時はサーバの保存状態(item.isSaved)を fallback とする。
	const selectIsSaved = useCallback(
		(state: DishCategoriesStore) => selectIsDishCategorySaved(item.categoryId, item.isSaved ?? false)(state),
		[item.categoryId, item.isSaved],
	);
	const isSaved = useDishCategoriesStore(selectIsSaved);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const { showSnackbar } = useSnackbar();

	// #973【設計】3件表示時は折り返さず1行に収める。1〜2件は内容幅で主CTAより確実に小さく見せる
	const isThreeDeepDiveChips = deepDiveOptions.length >= 3;

	/**
	 * #1205 【修正】トピック保存/解除の多重実行を防ぐ同期ガード。
	 *
	 * 保存ボタンには `disabled` が無く、あっても `isSaved`（store 購読の state）は
	 * **ブックマークの見た目を切り替える表示用途**であって多重実行の判定には使えない。
	 * React が再レンダリングをコミットする前に 2 発目の押下が処理されると、両方が同じ
	 * `isSaved` を読んで通過するためで、通過すると `insertReaction`（`lib/reactions.ts` の素の
	 * insert）が 2 回走り、2 発目は `reactions` の一意制約で失敗する。すると catch の
	 * `setDishCategorySaved(item.categoryId, !willSave)` が発火して、**保存できているのに
	 * 表示が保存解除へ巻き戻る**（解除側も同様に「解除できているのに保存済み表示へ戻る」）。
	 *
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続呼び出しでもレースしない。
	 * `features/map/components/ReviewForm.tsx:173-185` の `isSubmittingRef` と同じ方式。
	 * 解除は `handleSave` の finally だけで行うため、失敗しても次の押下は通る。
	 */
	const isSavingRef = useRef(false);

	const handleSave = async () => {
		// #1205 判定は同期的に確定する ref で行う（宣言のコメント参照）。
		// 楽観更新（setDishCategorySaved）とハプティクスより **前** に弾くこと。後ろに置くと、
		// 弾いた 2 発目でも表示だけが書き換わる／振動だけが 2 回鳴る。
		if (isSavingRef.current) return;
		isSavingRef.current = true;

		const willSave = !isSaved;
		lightImpact();

		const { setDishCategorySaved, updateDishCategoryIdsByKey, upsertDishCategories } = useDishCategoriesStore.getState();
		setDishCategorySaved(item.categoryId, willSave);

		try {
			await toggleReaction({
				target_type: "dish_categories",
				target_id: item.categoryId,
				action_type: "save",
				willReact: willSave,
			});

			// #472【設計】保存 ON → saved タブの先頭に移動、保存 OFF → saved タブから除外
			if (willSave) {
				upsertDishCategories([
					{
						id: item.categoryId,
						image_url: item.imageUrl,
						labels: {},
						label_en: item.title,
					},
				]);
				updateDishCategoryIdsByKey(profileSavedDishCategoriesEntriesKey, (prev) => {
					const without = prev.filter((id) => id !== item.categoryId);
					return [item.categoryId, ...without];
				});
				// #954 【仕様】保存操作のみ完了フィードバックを出す(解除は状態変化が見た目で分かるため省略)
				// #1402 【設計】遷移先は «保存した料理カテゴリの単独ルート»。
				// 旧実装はマイページへ `?tab=saved-dish-categories&tabRequest=<現在時刻>` を積んでいたが、
				// これは «同じタブへの 2 回目以降の遷移でも切り替えを発火させる» ためのもので、
				// 4 グリッドタブごと廃止されて不要になった（push すれば必ずその画面が積まれる）。
				showSnackbar(i18n.t("DishCategories.savedMessage"), {
					action: {
						label: i18n.t("Common.view"),
						onPress: () =>
							router.push({
								pathname: "/[locale]/(tabs)/profile/saved-dish-categories",
								params: { locale },
							}),
					},
				});
			} else {
				updateDishCategoryIdsByKey(profileSavedDishCategoriesEntriesKey, (prev) => prev.filter((id) => id !== item.categoryId));
			}
		} catch (error) {
			// #954 【仕様】保存APIが失敗した場合、見た目だけ切り替わったままにせず表示を元に戻す
			setDishCategorySaved(item.categoryId, !willSave);
			logFrontendEvent({
				event_name: "topic_save_reaction_failed",
				error_level: "error",
				payload: {
					// #1092 PR4b 保存 API は認証必須。認証未確定のまま押されると PR4a の
					// ApiError(plain object) が来て "[object Object]" になるため共通関数へ寄せる。
					// 置換前は (B) `instanceof Error ? message : String()` なので message 側
					error: toErrorLogMessage(error),
					target_id: item.categoryId,
					action_type: "save",
					willReact: willSave,
				},
			});
			showSnackbar(i18n.t("Common.error"));
		} finally {
			// #1205 成功・失敗のどちらでも必ず通る、唯一の解除箇所（失敗しても再試行できる）
			isSavingRef.current = false;
		}
	};

	const handleBlock = () => {
		onBlock(item);
	};

	/**
	 * #1484 【設計】カード画像自身の実測矩形を取り、拡大アニメーションの開始位置として onSelect へ渡す。
	 * 画像タップ・CTAボタンのどちらから呼ばれても、広がる対象は常にこのカード画像にする。
	 *
	 * measureInWindow はネイティブブリッジを跨ぐため、呼び出しから結果が返るまで必ず一呼吸ある。
	 * その間は dishCategories.tsx 側の isSelectingDishCategoryRef がまだ立っておらず、素早い連打だと 2 回目の
	 * タップがこの一呼吸の間に素通りしうる。呼び出し元コンポーネントを跨がず、この場で
	 * 同期的に確定するガードを併用して、同一カードからの連打を測定中に弾く。
	 */
	const isMeasuringRef = useRef(false);
	// isSelecting が false に戻った（=結果画面から戻ってきた等で再選択可能になった）タイミングで解除する。
	// 測定中の一瞬は isSelecting がまだ false のままなので、ここでは解除されない（意図通り）。
	useEffect(() => {
		if (!isSelecting) {
			isMeasuringRef.current = false;
		}
	}, [isSelecting]);
	const cardMeasureRef = useRef<View>(null);
	const handleSelectPress = useCallback(() => {
		if (isMeasuringRef.current) return;
		isMeasuringRef.current = true;

		const node = cardMeasureRef.current;
		if (node && typeof node.measureInWindow === "function") {
			node.measureInWindow((x, y, width, height) => {
				// 稀にレイアウト未確定で 0 サイズが返ることがあり、その場合は広がる元が無いのと同じなので諦める
				if (width > 0 && height > 0) {
					onSelect(item, { x, y, width, height });
				} else {
					onSelect(item);
				}
			});
		} else {
			onSelect(item);
		}
	}, [item, onSelect]);

	return (
		<View style={[styles.cardPressArea, { width: cardWidth, height: cardHeight + DISH_CATEGORY_CARD_CTA_OVERHANG }]}>
			{/* measureInWindowの基準を安定させるため、Touchableではなく明示的なViewを計測する。 */}
			<View ref={cardMeasureRef} collapsable={false}>
				<View
					ref={tutorialTargetRefs?.swipeArea}
					collapsable={false}
					testID={tutorialTargetRefs ? "dish-categories-tutorial-target-swipe" : undefined}>
					<TouchableOpacity onPress={handleSelectPress} activeOpacity={0.95}>
						<DishCategoryVisualCard
							title={item.title}
							tagline={item.reason}
							imageSource={{ uri: item.imageUrl }}
							cardWidth={cardWidth}
							cardHeight={cardHeight}
							imageState={imageState}
							recyclingKey={item.categoryId}
							onImageRetry={onImageRetry ? () => onImageRetry(item) : undefined}
							onImageLoadError={onImageLoadError ? () => onImageLoadError(item) : undefined}
							bottomContent={
								<View style={styles.bottomContent}>
									{deepDiveOptions.length > 0 ? (
										<View
											ref={tutorialTargetRefs?.deepDive}
											collapsable={false}
											style={styles.deepDiveContainer}
											testID={tutorialTargetRefs ? "dish-categories-tutorial-target-deep-dive" : undefined}>
											<View style={styles.deepDiveTitleRow}>
												<View style={styles.deepDiveTitleLine} />
												<Text style={styles.deepDiveTitle}>{i18n.t("DishCategories.deepDive.title")}</Text>
												<View style={styles.deepDiveTitleLine} />
											</View>
											<View style={[styles.deepDiveChips, isThreeDeepDiveChips && styles.deepDiveChipsRow]}>
												{deepDiveOptions.map((option) => (
													<TouchableOpacity
														key={option.key}
														style={[styles.deepDiveChip, isThreeDeepDiveChips && styles.deepDiveChipThird]}
														hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
														onPress={(event) => {
															event.stopPropagation();
															onDeepDive?.(item, option);
														}}
														activeOpacity={0.8}>
														<Text style={styles.deepDiveChipText}>{option.label}</Text>
													</TouchableOpacity>
												))}
											</View>
										</View>
									) : null}
									<View style={styles.ctaSpacer} />
								</View>
							}
							topRightContent={
								<View
									ref={tutorialTargetRefs?.dishCategoryActions}
									collapsable={false}
									style={styles.dishCategoryActions}
									testID={tutorialTargetRefs ? "dish-categories-tutorial-target-actions" : undefined}>
									<TouchableOpacity
										style={styles.topButton}
										onPress={(event) => {
											event.stopPropagation();
											void handleSave();
										}}
										accessibilityRole="button"
										accessibilityState={{ selected: isSaved }}
										accessibilityLabel={i18n.t(
											isSaved ? "DishCategories.accessibility.unsaveDishCategory" : "DishCategories.accessibility.saveDishCategory",
											{ title: item.title },
										)}>
										<Bookmark
											size={20}
											// 料理写真の上に載るアイコンなのでテーマで振らない
											color={isSaved ? "transparent" : FixedColors.onMedia}
											fill={isSaved ? "orange" : "transparent"}
										/>
									</TouchableOpacity>
									<TouchableOpacity
										style={styles.topButton}
										onPress={(event) => {
											event.stopPropagation();
											void handleBlock();
										}}
										accessibilityRole="button"
										accessibilityLabel={i18n.t("DishCategories.accessibility.blockDishCategory", { title: item.title })}>
										<Ban size={18} color={FixedColors.onMedia} />
									</TouchableOpacity>
								</View>
							}
						/>
					</TouchableOpacity>
				</View>
			</View>
			<View
				ref={tutorialTargetRefs?.selectCta}
				collapsable={false}
				style={styles.selectButtonTarget}
				testID={tutorialTargetRefs ? "dish-categories-tutorial-target-select" : undefined}>
				{/* #1031 【設計】カルーセルで複数カードが同時マウントされるため atIndex(0) で先頭を指定できるよう testID を追加 */}
				<TouchableOpacity
					testID="dish-categories-choose-button"
					style={[styles.selectButton, isSelecting && styles.selectButtonDisabled]}
					onPress={handleSelectPress}
					disabled={isSelecting}
					activeOpacity={0.85}
					accessibilityRole="button"
					accessibilityState={{ disabled: isSelecting }}
					accessibilityLabel={i18n.t("DishCategories.chooseThis")}>
					<Text style={styles.selectButtonText}>{i18n.t("DishCategories.chooseThis")}</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
};

// #1509 【設計】テーマ依存のスタイルはファクトリで組む（contexts/ThemeProvider.tsx の useThemedStyles）。
// 料理写真の上に載る文字・アイコンはテーマで振らず FixedColors を使う（constants/Palette.ts）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		cardPressArea: {
			position: "relative",
		},
		bottomContent: {
			gap: 10,
		},
		ctaSpacer: {
			height: 16,
		},
		selectButtonTarget: {
			position: "absolute",
			left: "10%",
			right: "10%",
			bottom: 0,
			zIndex: 10,
		},
		selectButton: {
			minHeight: 52,
			borderRadius: 24,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: c.brand,
		},
		selectButtonDisabled: {
			opacity: 0.55,
		},
		selectButtonText: {
			// ブランド色で塗った CTA の上の文字。地（c.brand）がライト / ダークで変わらないため文字も振らない
			color: FixedColors.onFilled,
			fontSize: 17,
			fontWeight: "800",
			letterSpacing: 0.2,
		},
		topButton: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			minWidth: 44,
			minHeight: 44,
			backgroundColor: "rgba(0, 0, 0, 0.3)",
			paddingHorizontal: 16,
			paddingVertical: 10,
			borderRadius: 20,
			gap: 6,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 2 },
			shadowOpacity: 0.3,
			shadowRadius: 4,
			elevation: 4,
		},
		dishCategoryActions: {
			gap: 12,
		},
		deepDiveContainer: {
			marginTop: 10,
			gap: 8,
			paddingBottom: 6,
		},
		deepDiveTitleRow: {
			flexDirection: "row",
			alignItems: "center",
			gap: 12,
		},
		deepDiveTitleLine: {
			flex: 1,
			height: 1,
			backgroundColor: "rgba(255, 255, 255, 0.75)",
		},
		deepDiveTitle: {
			// 料理写真の上に載る文字なのでテーマで振らない
			color: FixedColors.onMedia,
			fontSize: 13,
			fontWeight: "800",
			textAlign: "center",
			textShadowColor: "rgba(0, 0, 0, 0.9)",
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 3,
		},
		deepDiveChips: {
			flexDirection: "row",
			flexWrap: "wrap",
			justifyContent: "center",
			alignSelf: "center",
			// #973【設計】主CTA(左右10%インセット=横幅80%)より確実に狭くし、深堀チップ行が主CTAより目立たないようにする(1〜2件時)
			maxWidth: "76%",
			gap: 8,
		},
		// #973【設計】3件時は折り返さず1行に収める。flex:1による均等割りはWebでチップが
		// 不当に縮み文字が視認できなくなる問題があったため、固定%幅＋定幅の行コンテナに戻した
		deepDiveChipsRow: {
			flexWrap: "nowrap",
			alignSelf: "center",
			justifyContent: "space-between",
			width: "94%",
			maxWidth: undefined,
		},
		deepDiveChip: {
			borderWidth: 1,
			borderColor: "rgba(255, 255, 255, 0.92)",
			backgroundColor: "rgba(255, 255, 255, 0.32)",
			paddingHorizontal: 12,
			paddingVertical: 7,
			borderRadius: 14,
			minHeight: 32,
			justifyContent: "center",
			alignItems: "center",
		},
		deepDiveChipThird: {
			width: "31%",
			paddingHorizontal: 6,
		},
		deepDiveChipText: {
			// 料理写真の上に載る文字なのでテーマで振らない
			color: FixedColors.onMedia,
			fontSize: 13,
			fontWeight: "800",
			textAlign: "center",
			textShadowColor: "rgba(0, 0, 0, 0.7)",
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 2,
		},
	});
