import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
	View,
	Text,
	TextInput,
	StyleSheet,
	TouchableOpacity,
	Platform,
	Keyboard,
	Pressable,
	Animated,
} from "react-native";
import { Star, ChevronRight } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { DishCategoryAutocomplete } from "@/components/DishCategoryAutocomplete";
import i18n from "@/lib/i18n";
import { SupabaseRestaurants } from "@shared/converters/convert_restaurants";
import { InitialMediaPreview, MediaData } from "./InitialMediaPreview";
import { getCurrencyCodeFromRestaurant, getMinorUnitFromCurrency, resolveCurrencySymbol } from "@/lib/googlePlaces";
import { useLocale } from "@/hooks/useLocale";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import { useDishCategorySearch } from "@/hooks/useDishCategorySearch";
import { CreateDishDto, type CreateDishMediaDto, type CreateDishReviewDto } from "@shared/api/v1/dto";
import { useFileUploader } from "@/hooks/useFileUploader";
import type { CreateDishMediaResponse, CreateDishResponse, CreateDishReviewResponse } from "@shared/api/v1/res";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useBlurModal } from "@/hooks/useBlurModal";
import { Dimensions } from "react-native";

interface ReviewFormProps {
	restaurant: SupabaseRestaurants;
	/** Initial price value */
	initialPrice?: string;
	/** Initial review text */
	initialReviewText?: string;
	/** Initial rating value */
	initialRating?: number;
	/** Initial media to display at the top */
	initialMedia: MediaData;
	/** Called when user cancels */
	onCancel: () => void;
}

const { height } = Dimensions.get("window");

/**
 * Review form component that manages its own internal state to prevent
 * Japanese IME composition issues. Only communicates final values back to parent.
 */
export function ReviewForm({
	restaurant,
	initialPrice = "",
	initialReviewText = "",
	initialRating = 0,
	initialMedia,
	onCancel,
}: ReviewFormProps) {
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile: mediaUploadFile } = useFileUploader();
	const { uploadFile: thumbnailUploadFile } = useFileUploader();
	const { createDishCategoryVariant } = useDishCategorySearch();
	const { showSnackbar } = useSnackbar();

	// 料理カテゴリの状態管理
	const [dishCategoryName, setDishCategoryName] = useState("");
	const [dishCategoryId, setDishCategoryId] = useState<string | null>(null);
	const [dishCategoryError, setDishCategoryError] = useState<string | null>(null);

	// Internal state - isolated from parent re-renders
	const [isProcessing, setIsProcessing] = useState(false);
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);

	const locale = useLocale();

	const currencyCode = useMemo(() => getCurrencyCodeFromRestaurant(restaurant), [restaurant]);
	const currencySymbol = useMemo(() => resolveCurrencySymbol(currencyCode, locale), [currencyCode, locale]);

	const isValid = price.trim() && reviewText.trim() && dishCategoryName.trim() && !!dishCategoryId;

	// Animated height for InitialMediaPreview
	// 画面全体の高さ - フォーム部分の高さ - ボタン部分の高さ - バッファ
	const mediaHeight = useMemo(() => height - 370 - 60 - 120, []);
	const mediaHeightAnim = useRef(new Animated.Value(mediaHeight)).current;
	const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

	// Keyboard event handlers for animation
	useEffect(() => {
		const keyboardShowListener = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
			() => {
				setIsKeyboardVisible(true);
				Animated.timing(mediaHeightAnim, {
					toValue: 100, // Reduced height
					duration: 250,
					useNativeDriver: false,
				}).start();
			},
		);

		const keyboardHideListener = Keyboard.addListener(
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
			() => {
				setIsKeyboardVisible(false);
				Animated.timing(mediaHeightAnim, {
					toValue: mediaHeight,
					duration: 250,
					useNativeDriver: false,
				}).start();
			},
		);

		return () => {
			keyboardShowListener.remove();
			keyboardHideListener.remove();
		};
	}, [mediaHeightAnim]);

	// DishCategoryAutocomplete モーダルクローズ時のハンドラ: dishCategoryName から dishCategoryId を取得・設定
	const onDishCategoryModalClose = useCallback(async () => {
		if (!dishCategoryName.trim()) return;
		try {
			const createdCategory = await createDishCategoryVariant(dishCategoryName.trim());
			setDishCategoryId(createdCategory.id);
		} catch (error: any) {
			// POSTエラー時はインラインエラー表示
			const errorMessage = i18n.t("Map.errors.dishCategoryNotFound");
			setDishCategoryError(errorMessage);
			setDishCategoryId(null);
			setIsProcessing(false);
			return;
		}
	}, [dishCategoryName, createDishCategoryVariant]);

	// DishCategoryAutocomplete クリア時のハンドラ
	const handleDishCategoryClear = useCallback(() => {
		setDishCategoryId(null);
		setDishCategoryError(null);
	}, []);

	// useBlurModal for dish category selection
	const {
		BlurModal: DishCategoryModal,
		open: openDishCategoryModal,
		close: closeDishCategoryModal,
	} = useBlurModal({
		onClose: onDishCategoryModalClose,
		keyboardVerticalOffset: Platform.OS === "ios" ? 0 : 0,
		dismissKeyboardFirst: true,
	});

	// DishCategoryAutocomplete 候補選択時のハンドラ: dishCategoryIdを設定
	const handleDishCategorySelect = useCallback(
		(suggestion: { dishCategoryId: string; label: string }) => {
			setDishCategoryId(suggestion.dishCategoryId);
			setDishCategoryName(suggestion.label);
			setDishCategoryError(null);
			logFrontendEvent({
				event_name: "dish_category_selected",
				error_level: "log",
				payload: { dishCategoryId: suggestion.dishCategoryId, label: suggestion.label },
			});
			closeDishCategoryModal();
		},
		[logFrontendEvent, closeDishCategoryModal],
	);

	const handleSubmit = useCallback(async () => {
		if (!isValid || isProcessing) return;

		mediumImpact();
		setIsProcessing(true);
		setDishCategoryError(null);

		try {
			const dishId = await callBackend<CreateDishDto, CreateDishResponse>("v1/dishes", {
				method: "POST",
				requestPayload: {
					restaurantId: restaurant.id,
					dishCategoryId: dishCategoryId,
				},
			}).then((res) => res.id);

			const mediaPath = await mediaUploadFile(initialMedia.uri, {
				mimeType: initialMedia.mimeType,
				baseFileName: `${dishId}-media`,
			});
			let thumbnailPath = mediaPath; // Default to mediaPath for images
			if (initialMedia.type === "video") {
				if (!initialMedia.thumbnailUri) throw new Error("Missing thumbnail for video");
				thumbnailPath = await thumbnailUploadFile(initialMedia.thumbnailUri, {
					mimeType: "image/jpeg",
					baseFileName: `${dishId}-thumbnail`,
				});
			}

			/**
			 * Video のアップロードが完了してからでないと、
			 * transcoer API が失敗する可能性があるため、直列で実行する
			 */
			const dishMedia = await callBackend<CreateDishMediaDto, CreateDishMediaResponse>("v1/dish-media", {
				method: "POST",
				requestPayload: {
					dishId,
					mediaPath,
					thumbnailPath,
					mediaType: initialMedia.type,
				},
			});

			await callBackend<CreateDishReviewDto, CreateDishReviewResponse>("/v1/dish-reviews", {
				method: "POST",
				requestPayload: {
					dishId,
					comment: reviewText,
					languageCode: locale,
					priceCents: getMinorUnitFromCurrency(currencyCode),
					currencyCode: currencyCode ?? undefined,
					rating,
					createdDishMediaId: dishMedia.id,
				},
			});

			logFrontendEvent({
				event_name: "dish_media_submit_success",
				error_level: "log",
				payload: { dishId, initialMedia, dishCategoryId },
			});

			// Simulate review submission
			await new Promise((resolve) => setTimeout(resolve, 1000));

			logFrontendEvent({
				event_name: "restaurant_review_submitted",
				error_level: "log",
				payload: { restaurantId: restaurant?.id, rating: rating },
			});

			onCancel();
		} catch (error: any) {
			logFrontendEvent({
				event_name: "restaurant_review_submission_failed",
				error_level: "error",
				payload: { restaurantId: restaurant?.id, error: error?.message },
			});
			showSnackbar(i18n.t("Map.errors.reviewSubmitFailed"));
		} finally {
			setIsProcessing(false);
		}
	}, [
		reviewText,
		isValid,
		isProcessing,
		rating,
		initialMedia,
		dishCategoryId,
		dishCategoryName,
		createDishCategoryVariant,
		callBackend,
		logFrontendEvent,
		onCancel,
		restaurant,
		locale,
		currencyCode,
		mediaUploadFile,
		thumbnailUploadFile,
		mediumImpact,
	]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	return (
		<>
			<Animated.View style={{ height: mediaHeightAnim }}>
				{initialMedia && <InitialMediaPreview media={initialMedia} />}
			</Animated.View>
			<Card style={{ gap: 16 }}>
				{/* レビュー入力 */}
				<TextInput
					style={[styles.textInput, styles.textArea]}
					placeholder={i18n.t("Map.placeholders.enterReview")}
					value={reviewText}
					onChangeText={setReviewText}
					multiline
					numberOfLines={4}
					textAlignVertical="top"
				/>

				{/* 価格入力 行 */}
				<View style={styles.inputRow}>
					<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterPrice")}</Text>
					{currencySymbol ? (
						<View style={styles.priceInputContainer}>
							<Text style={styles.currencySymbol}>{currencySymbol}</Text>
							<TextInput
								style={[styles.textInput, styles.priceInput]}
								placeholder={"0"}
								value={price}
								onChangeText={setPrice}
								keyboardType="numeric"
							/>
						</View>
					) : (
						<TextInput
							style={[styles.textInput, styles.priceInputSmall]}
							placeholder={"0"}
							value={price}
							onChangeText={setPrice}
							keyboardType="numeric"
						/>
					)}
				</View>

				{/* 料理カテゴリ選択 Pressable 行 */}
				<Pressable
					style={styles.selectRow}
					onPress={openDishCategoryModal}
					accessibilityRole="button"
					accessibilityLabel={i18n.t("Map.actions.selectDishCategory")}>
					<Text style={[styles.selectRowText, dishCategoryName ? { color: "#000", fontWeight: "600" } : {}]}>
						{dishCategoryName || i18n.t("Map.actions.selectDishCategory")}
					</Text>
					<ChevronRight size={20} color="#666" />
				</Pressable>
				{dishCategoryError && (
					<Text style={styles.errorText} accessibilityLiveRegion="polite">
						{dishCategoryError}
					</Text>
				)}

				{/* 評価入力 行 */}
				<View style={styles.inputRow}>
					<Text style={styles.inputRowLabel}>{i18n.t("Map.placeholders.enterReview")}</Text>
					<View style={styles.ratingInput}>
						{[1, 2, 3, 4, 5].map((star) => (
							<TouchableOpacity key={star} onPress={() => setRating(star)}>
								<Star size={24} color="#FFD700" fill={star <= rating ? "#FFD700" : "transparent"} />
							</TouchableOpacity>
						))}
					</View>
				</View>
			</Card>

			<PrimaryButton
				label={i18n.t("Common.post")}
				onPress={handleSubmit}
				disabled={isProcessing || !isValid}
				style={{ marginHorizontal: 16 }}
			/>

			{/* DishCategoryAutocomplete Modal */}
			<DishCategoryModal>
				<View style={styles.autocompleteContainer}>
					<DishCategoryAutocomplete
						value={dishCategoryName}
						onChangeText={setDishCategoryName}
						onSelectSuggestion={handleDishCategorySelect}
						onClear={handleDishCategoryClear}
						placeholder={i18n.t("Map.placeholders.enterDishCategory")}
						autofocus={true}
					/>
				</View>
			</DishCategoryModal>
		</>
	);
}

const styles = StyleSheet.create({
	inputLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#000",
		marginBottom: 8,
	},
	textInput: {
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16,
		color: "#000",
	},
	textArea: {
		height: 100,
		textAlignVertical: "top",
	},
	selectRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		height: 48,
	},
	selectRowText: {
		fontSize: 14,
		color: "#666",
		flex: 1,
	},
	inputRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		height: 48,
	},
	inputRowLabel: {
		fontSize: 14,
		color: "#666",
		flex: 1,
	},
	ratingInput: {
		flexDirection: "row",
		gap: 4,
		alignItems: "center",
	},
	priceInputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 8,
		minWidth: 120,
	},
	currencySymbol: {
		fontSize: 16,
		fontWeight: "600",
		color: "#666",
		minWidth: 24,
		paddingLeft: 8,
	},
	priceInput: {
		flex: 1,
		paddingLeft: 4,
		paddingRight: 12,
		minWidth: 80,
		textAlign: "right",
	},
	priceInputSmall: {
		minWidth: 120,
		paddingHorizontal: 12,
		paddingVertical: 8,
		textAlign: "right",
	},
	errorText: {
		color: "#DC2626",
		fontSize: 12,
		paddingHorizontal: 4,
	},
	autocompleteContainer: {
		marginHorizontal: 16,
		minHeight: 200,
	},
});
