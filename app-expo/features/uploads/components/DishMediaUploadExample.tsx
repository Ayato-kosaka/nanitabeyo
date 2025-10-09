import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from "react-native";
import { FileUploader } from "@/features/uploads/components/FileUploader";
import { useAPICall } from "@/hooks/useAPICall";
import type { CreateDishMediaDto, MediaType } from "@shared/api/v1/dto";
import { useLogger } from "@/hooks/useLogger";

/**
 * Example component showing how to upload dish media (images or videos)
 * 
 * For IMAGE uploads:
 * 1. Upload the image file
 * 2. Call POST /v1/dish-media with mediaType: "IMAGE" and thumbnailPath = mediaPath
 * 
 * For VIDEO uploads:
 * 1. Upload the video file
 * 2. Upload a separate thumbnail image
 * 3. Call POST /v1/dish-media with mediaType: "VIDEO", mediaPath, and thumbnailPath
 */
export default function DishMediaUploadExample() {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const [mediaPath, setMediaPath] = useState<string | null>(null);
	const [thumbnailPath, setThumbnailPath] = useState<string | null>(null);
	const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO" | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Example dishId - in real app, this would come from props or navigation params
	const dishId = "example-dish-id";

	const handleImageUpload = async (objectPath: string) => {
		logFrontendEvent({
			event_name: "image_upload_completed",
			error_level: "log",
			payload: { objectPath },
		});

		// For images, use the same path for both media and thumbnail
		setMediaPath(objectPath);
		setThumbnailPath(objectPath);
		setMediaType("IMAGE");
	};

	const handleVideoUpload = async (objectPath: string) => {
		logFrontendEvent({
			event_name: "video_upload_completed",
			error_level: "log",
			payload: { objectPath },
		});

		setMediaPath(objectPath);
		setMediaType("VIDEO");
	};

	const handleThumbnailUpload = async (objectPath: string) => {
		logFrontendEvent({
			event_name: "thumbnail_upload_completed",
			error_level: "log",
			payload: { objectPath },
		});

		setThumbnailPath(objectPath);
	};

	const handleSubmit = async () => {
		if (!mediaPath || !thumbnailPath || !mediaType) {
			Alert.alert("Error", "Please upload all required media files");
			return;
		}

		setIsSubmitting(true);

		try {
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

			Alert.alert("Success", `${mediaType} uploaded successfully!`);

			// Reset state
			setMediaPath(null);
			setThumbnailPath(null);
			setMediaType(null);
		} catch (error: any) {
			logFrontendEvent({
				event_name: "dish_media_submit_error",
				error_level: "error",
				payload: { error: error?.message },
			});

			Alert.alert("Error", error?.message || "Failed to upload media");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleReset = () => {
		setMediaPath(null);
		setThumbnailPath(null);
		setMediaType(null);
	};

	return (
		<ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
			<Text style={styles.title}>Upload Dish Media</Text>
			<Text style={styles.description}>Upload images or videos of your dish</Text>

			{/* Image Upload Section */}
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>Upload Image</Text>
				<Text style={styles.sectionDescription}>
					For images, the same file is used as both media and thumbnail
				</Text>
				<FileUploader
					mimeType="image/jpeg"
					baseFileName={`${dishId}-media`}
					onUploadComplete={handleImageUpload}
					onUploadError={(error) => Alert.alert("Upload Error", error)}
				/>
				{mediaType === "IMAGE" && mediaPath && (
					<View style={styles.successBadge}>
						<Text style={styles.successText}>✓ Image uploaded</Text>
					</View>
				)}
			</View>

			<View style={styles.divider} />

			{/* Video Upload Section */}
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>Upload Video</Text>
				<Text style={styles.sectionDescription}>
					For videos, upload both the video file and a separate thumbnail image
				</Text>

				{/* Video file upload */}
				<View style={styles.uploadGroup}>
					<Text style={styles.label}>1. Video File</Text>
					<FileUploader
						mimeType="video/mp4"
						baseFileName={`${dishId}-media`}
						onUploadComplete={handleVideoUpload}
						onUploadError={(error) => Alert.alert("Upload Error", error)}
					/>
					{mediaType === "VIDEO" && mediaPath && (
						<View style={styles.successBadge}>
							<Text style={styles.successText}>✓ Video uploaded</Text>
						</View>
					)}
				</View>

				{/* Thumbnail upload (only show if video is uploaded) */}
				{mediaType === "VIDEO" && mediaPath && (
					<View style={styles.uploadGroup}>
						<Text style={styles.label}>2. Thumbnail Image</Text>
						<FileUploader
							mimeType="image/jpeg"
							baseFileName={`${dishId}-thumbnail`}
							onUploadComplete={handleThumbnailUpload}
							onUploadError={(error) => Alert.alert("Upload Error", error)}
						/>
						{thumbnailPath && (
							<View style={styles.successBadge}>
								<Text style={styles.successText}>✓ Thumbnail uploaded</Text>
							</View>
						)}
					</View>
				)}
			</View>

			{/* Submit/Reset buttons */}
			{(mediaPath || thumbnailPath) && (
				<View style={styles.actionButtons}>
					<TouchableOpacity
						style={[styles.button, styles.submitButton, (!mediaPath || !thumbnailPath || isSubmitting) && styles.buttonDisabled]}
						onPress={handleSubmit}
						disabled={!mediaPath || !thumbnailPath || isSubmitting}>
						<Text style={styles.buttonText}>{isSubmitting ? "Submitting..." : "Submit"}</Text>
					</TouchableOpacity>

					<TouchableOpacity style={[styles.button, styles.resetButton]} onPress={handleReset} disabled={isSubmitting}>
						<Text style={[styles.buttonText, styles.resetButtonText]}>Reset</Text>
					</TouchableOpacity>
				</View>
			)}

			{/* Status display */}
			{mediaPath && (
				<View style={styles.statusContainer}>
					<Text style={styles.statusTitle}>Upload Status:</Text>
					<Text style={styles.statusText}>Media Type: {mediaType}</Text>
					<Text style={styles.statusText}>Media Path: {mediaPath.substring(0, 50)}...</Text>
					<Text style={styles.statusText}>Thumbnail Path: {thumbnailPath?.substring(0, 50)}...</Text>
				</View>
			)}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#F8F9FA",
	},
	contentContainer: {
		padding: 20,
	},
	title: {
		fontSize: 24,
		fontWeight: "bold",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	description: {
		fontSize: 16,
		color: "#666",
		marginBottom: 24,
	},
	section: {
		marginBottom: 24,
	},
	sectionTitle: {
		fontSize: 18,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	sectionDescription: {
		fontSize: 14,
		color: "#666",
		marginBottom: 16,
		lineHeight: 20,
	},
	uploadGroup: {
		marginBottom: 16,
	},
	label: {
		fontSize: 14,
		fontWeight: "500",
		color: "#333",
		marginBottom: 8,
	},
	successBadge: {
		backgroundColor: "#E8F5E9",
		paddingVertical: 8,
		paddingHorizontal: 12,
		borderRadius: 8,
		marginTop: 8,
	},
	successText: {
		color: "#2E7D32",
		fontSize: 14,
		fontWeight: "500",
	},
	divider: {
		height: 1,
		backgroundColor: "#E0E0E0",
		marginVertical: 24,
	},
	actionButtons: {
		flexDirection: "row",
		gap: 12,
		marginTop: 24,
	},
	button: {
		flex: 1,
		paddingVertical: 14,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
	},
	submitButton: {
		backgroundColor: "#007AFF",
	},
	resetButton: {
		backgroundColor: "#FFF",
		borderWidth: 1,
		borderColor: "#007AFF",
	},
	buttonDisabled: {
		backgroundColor: "#CCC",
		opacity: 0.6,
	},
	buttonText: {
		color: "#FFF",
		fontSize: 16,
		fontWeight: "600",
	},
	resetButtonText: {
		color: "#007AFF",
	},
	statusContainer: {
		backgroundColor: "#FFF",
		padding: 16,
		borderRadius: 8,
		marginTop: 24,
		borderWidth: 1,
		borderColor: "#E0E0E0",
	},
	statusTitle: {
		fontSize: 16,
		fontWeight: "600",
		marginBottom: 12,
		color: "#1A1A1A",
	},
	statusText: {
		fontSize: 14,
		color: "#666",
		marginBottom: 4,
	},
});
