import React, { useState, useCallback, useMemo } from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { Star } from "lucide-react-native";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { SupabaseRestaurants } from "@shared/converters/convert_restaurants";
import { InitialMediaPreview, MediaData } from "./InitialMediaPreview";
import { getCurrencyCodeFromRestaurant, resolveCurrencySymbol } from "@/lib/googlePlaces";
import { useLocale } from "@/hooks/useLocale";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAPICall } from "@/hooks/useAPICall";
import type { CreateDishMediaDto } from "@shared/api/v1/dto";
import { useFileUploader } from "@/hooks/useFileUploader";

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
	// Example dishId - in real app, this would come from dish creation
	const dishId = useMemo(() => `dish-${Date.now()}`, []);

	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { uploadFile: mediaUploadFile } = useFileUploader({
		mimeType: initialMedia.mimeType,
		baseFileName: `${dishId}-media`,
	});
	const { uploadFile: thumbnailUploadFile } = useFileUploader({
		mimeType: "image/jpeg",
		baseFileName: `${dishId}-thumbnail`,
	});

	// Internal state - isolated from parent re-renders
	const [isProcessing, setIsProcessing] = useState(false);
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);

	const locale = useLocale();

	// Get currency symbol from restaurant data
	const currencySymbol = useMemo(() => {
		const currencyCode = getCurrencyCodeFromRestaurant(restaurant);
		return resolveCurrencySymbol(currencyCode, locale);
	}, [restaurant]);

	const handleSubmit = useCallback(async () => {
		if (!reviewText || !price || isProcessing) return;

		mediumImpact();
		setIsProcessing(true);
		try {
			const mediaPath = await mediaUploadFile(initialMedia.uri);
			let thumbnailPath = mediaPath; // Default to mediaPath for images
			if (initialMedia.type === "VIDEO") {
				if (!initialMedia.thumbnailUri) throw new Error("Missing thumbnail for video");
				thumbnailPath = await thumbnailUploadFile(initialMedia.thumbnailUri);
			}

			// Submit media to backend
			const payload: CreateDishMediaDto = {
				dishId,
				mediaPath,
				thumbnailPath,
				mediaType: initialMedia.type,
			};

			logFrontendEvent({
				event_name: "dish_media_submit_started",
				error_level: "log",
				payload,
			});

			/**
			 * Video のアップロードが完了してからでないと、
			 * transcoer API が失敗する可能性があるため、直列で実行する
			 */
			await callBackend("v1/dish-media", {
				method: "POST",
				requestPayload: payload,
			});

			logFrontendEvent({
				event_name: "dish_media_submit_success",
				error_level: "log",
				payload: { dishId, initialMedia },
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
			Alert.alert("Error", error?.message || "Failed to submit review");
		} finally {
			setIsProcessing(false);
		}
	}, [reviewText, price, isProcessing, rating, initialMedia, dishId, callBackend, logFrontendEvent, onCancel]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const isValid = price.trim() && reviewText.trim();

	return (
		<>
			{initialMedia && <InitialMediaPreview media={initialMedia} />}
			<Card style={{ gap: 16 }}>
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
});
