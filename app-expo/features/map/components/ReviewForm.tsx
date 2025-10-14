import React, { useState, useCallback, useMemo } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { Star } from "lucide-react-native";
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

	const isValid = price.trim() && reviewText.trim() && dishCategoryName.trim();

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
		},
		[logFrontendEvent],
	);

	// DishCategoryAutocomplete クリア時のハンドラ
	const handleDishCategoryClear = useCallback(() => {
		setDishCategoryId(null);
		setDishCategoryError(null);
	}, []);

	const handleSubmit = useCallback(async () => {
		if (!isValid || isProcessing) return;

		mediumImpact();
		setIsProcessing(true);
		setDishCategoryError(null);

		// 料理カテゴリが未選択の場合、POSTで作成
		let finalDishCategoryId = dishCategoryId;
		if (!finalDishCategoryId) {
			try {
				const createdCategory = await createDishCategoryVariant(dishCategoryName.trim());
				finalDishCategoryId = createdCategory.id;
				setDishCategoryId(finalDishCategoryId);
			} catch (error: any) {
				// POSTエラー時はインラインエラー表示
				const errorMessage = i18n.t("Map.errors.dishCategoryNotFound");
				setDishCategoryError(errorMessage);
				setIsProcessing(false);
				return;
			}
		}

		try {
			const dishId = await callBackend<CreateDishDto, CreateDishResponse>("v1/dishes", {
				method: "POST",
				requestPayload: {
					restaurantId: restaurant.id,
					dishCategoryId: finalDishCategoryId!,
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
			await callBackend<CreateDishMediaDto, CreateDishMediaResponse>("v1/dish-media", {
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
					createdDishMediaId: dishId, // Using dishId as a placeholder for media ID
				},
			});

			logFrontendEvent({
				event_name: "dish_media_submit_success",
				error_level: "log",
				payload: { dishId, initialMedia, dishCategoryId: finalDishCategoryId },
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
			{initialMedia && <InitialMediaPreview media={initialMedia} />}
			<Card style={{ gap: 16 }}>
				{/* 料理カテゴリのオートコンプリート */}
				<View>
					<DishCategoryAutocomplete
						value={dishCategoryName}
						onChangeText={setDishCategoryName}
						onSelectSuggestion={handleDishCategorySelect}
						onClear={handleDishCategoryClear}
						placeholder={i18n.t("Map.placeholders.enterDishCategory")}
					/>
					{dishCategoryError && (
						<Text style={styles.errorText} accessibilityLiveRegion="polite">
							{dishCategoryError}
						</Text>
					)}
				</View>

				<TextInput
					style={[styles.textInput, styles.textArea]}
					placeholder={i18n.t("Map.placeholders.enterReview")}
					value={reviewText}
					onChangeText={setReviewText}
					multiline
					numberOfLines={4}
					textAlignVertical="top"
				/>
				<View>
					{/* <Text style={styles.inputLabel}>{i18n.t("Map.inputs.rating")}</Text> */}
					<View style={styles.ratingInput}>
						{[1, 2, 3, 4, 5].map((star) => (
							<TouchableOpacity key={star} onPress={() => setRating(star)}>
								<Star size={32} color="#FFD700" fill={star <= rating ? "#FFD700" : "transparent"} />
							</TouchableOpacity>
						))}
					</View>
				</View>
				{currencySymbol ? (
					<View style={styles.priceInputContainer}>
						<Text style={styles.currencySymbol}>{currencySymbol}</Text>
						<TextInput
							style={[styles.textInput, styles.priceInput]}
							placeholder={i18n.t("Map.placeholders.enterPrice")}
							value={price}
							onChangeText={setPrice}
							keyboardType="numeric"
						/>
					</View>
				) : (
					<TextInput
						style={styles.textInput}
						placeholder={i18n.t("Map.placeholders.enterPrice")}
						value={price}
						onChangeText={setPrice}
						keyboardType="numeric"
					/>
				)}
			</Card>

			<PrimaryButton
				label={i18n.t("Common.post")}
				onPress={handleSubmit}
				disabled={isProcessing || !isValid}
				style={{ marginHorizontal: 16 }}
			/>
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
	ratingInput: {
		flexDirection: "row",
		gap: 8,
	},
	priceInputContainer: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: 8,
	},
	currencySymbol: {
		fontSize: 16,
		fontWeight: "600",
		color: "#666",
		minWidth: 32,
		paddingLeft: 12,
	},
	priceInput: {
		flex: 1,
		paddingLeft: 0,
		paddingRight: 12,
	},
	errorText: {
		color: "#DC2626",
		fontSize: 14,
		marginTop: 8,
		paddingHorizontal: 4,
	},
});
