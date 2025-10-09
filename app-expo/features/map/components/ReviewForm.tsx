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
import { FileUploader } from "@/features/uploads/components/FileUploader";
import { useAPICall } from "@/hooks/useAPICall";
import type { CreateDishMediaDto, MediaType } from "@shared/api/v1/dto";

interface ReviewFormProps {
	restaurant: SupabaseRestaurants;
	/** Initial price value */
	initialPrice?: string;
	/** Initial review text */
	initialReviewText?: string;
	/** Initial rating value */
	initialRating?: number;
	/** Initial media to display at the top */
	initialMedia?: MediaData;
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
	
	// Internal state - isolated from parent re-renders
	const [isProcessing, setIsProcessing] = useState(false);
	const [price, setPrice] = useState(initialPrice);
	const [reviewText, setReviewText] = useState(initialReviewText);
	const [rating, setRating] = useState(initialRating);
	
	// Media upload state
	const [mediaPath, setMediaPath] = useState<string | null>(null);
	const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);
	const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO" | null>(null);
	const [isUploadingMedia, setIsUploadingMedia] = useState(false);

	const locale = useLocale();

	// Get currency symbol from restaurant data
	const currencySymbol = useMemo(() => {
		const currencyCode = getCurrencyCodeFromRestaurant(restaurant);
		return resolveCurrencySymbol(currencyCode, locale);
	}, [restaurant]);

	// Example dishId - in real app, this would come from dish creation
	const dishId = useMemo(() => `dish-${Date.now()}`, []);

	// Handle image upload
	const handleImageUpload = useCallback(async (objectPath: string) => {
		logFrontendEvent({
			event_name: "image_upload_completed",
			error_level: "log",
			payload: { objectPath },
		});
		// For images, use the same path for both media and thumbnail
		setMediaPath(objectPath);
		setThumbnailPath(objectPath);
		setMediaType("IMAGE");
	}, [logFrontendEvent]);

	// Handle video upload
	const handleVideoUpload = useCallback(async (objectPath: string) => {
		logFrontendEvent({
			event_name: "video_upload_completed",
			error_level: "log",
			payload: { objectPath },
		});
		setMediaPath(objectPath);
		setMediaType("VIDEO");
	}, [logFrontendEvent]);

	// Handle thumbnail upload for videos
	const handleThumbnailUpload = useCallback(async (objectPath: string) => {
		logFrontendEvent({
			event_name: "thumbnail_upload_completed",
			error_level: "log",
			payload: { objectPath },
		});
		setThumbnailPath(objectPath);
	}, [logFrontendEvent]);

	const handleSubmit = useCallback(async () => {
		if (!reviewText || !price) return;
		
		// If media is uploaded but not yet submitted to backend
		if (mediaPath && thumbnailPath && !isProcessing) {
			mediumImpact();
			setIsProcessing(true);
			try {
				// Submit media to backend
				const payload: CreateDishMediaDto = {
					dishId,
					mediaPath,
					thumbnailPath,
					mediaType: mediaType as MediaType,
				};

				logFrontendEvent({
					event_name: "dish_media_submit_started",
					error_level: "log",
					payload,
				});

				await callBackend("v1/dish-media", {
					method: "POST",
					requestPayload: payload,
				});

				logFrontendEvent({
					event_name: "dish_media_submit_success",
					error_level: "log",
					payload: { dishId, mediaType },
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
		}
	}, [reviewText, price, rating, restaurant, onCancel, mediaPath, thumbnailPath, mediaType, dishId, isProcessing, mediumImpact, logFrontendEvent, callBackend]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const isValid = price.trim() && reviewText.trim() && mediaPath && thumbnailPath;

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

				{/* Media Upload Section */}
				<View style={styles.mediaUploadSection}>
					<Text style={styles.sectionTitle}>Upload Media</Text>
					
					{/* Image Upload */}
					{!mediaPath && (
						<View style={styles.uploadOption}>
							<Text style={styles.uploadLabel}>Upload Image</Text>
							<FileUploader
								mimeType="image/jpeg"
								baseFileName={`${dishId}-media`}
								onUploadComplete={handleImageUpload}
								onUploadError={(error) => Alert.alert("Upload Error", error)}
							/>
						</View>
					)}

					{/* Video Upload */}
					{!mediaPath && (
						<View style={styles.uploadOption}>
							<Text style={styles.uploadLabel}>Upload Video</Text>
							<FileUploader
								mimeType="video/mp4"
								baseFileName={`${dishId}-media`}
								onUploadComplete={handleVideoUpload}
								onUploadError={(error) => Alert.alert("Upload Error", error)}
							/>
						</View>
					)}

					{/* Thumbnail Upload for Video */}
					{mediaType === "VIDEO" && mediaPath && !thumbnailPath && (
						<View style={styles.uploadOption}>
							<Text style={styles.uploadLabel}>Upload Thumbnail (Required)</Text>
							<FileUploader
								mimeType="image/jpeg"
								baseFileName={`${dishId}-thumbnail`}
								onUploadComplete={handleThumbnailUpload}
								onUploadError={(error) => Alert.alert("Upload Error", error)}
							/>
						</View>
					)}

					{/* Upload Status */}
					{mediaPath && (
						<View style={styles.uploadStatus}>
							<Text style={styles.statusText}>✓ {mediaType} uploaded</Text>
							{mediaType === "VIDEO" && thumbnailPath && (
								<Text style={styles.statusText}>✓ Thumbnail uploaded</Text>
							)}
						</View>
					)}
				</View>
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
	mediaUploadSection: {
		gap: 12,
		marginTop: 8,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
	},
	uploadOption: {
		gap: 8,
	},
	uploadLabel: {
		fontSize: 14,
		fontWeight: "500",
		color: "#333",
	},
	uploadStatus: {
		backgroundColor: "#E8F5E9",
		paddingVertical: 8,
		paddingHorizontal: 12,
		borderRadius: 8,
		gap: 4,
	},
	statusText: {
		color: "#2E7D32",
		fontSize: 14,
		fontWeight: "500",
	},
});
