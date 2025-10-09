import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { Camera, Upload, X } from "lucide-react-native";
import type { CreateUserUploadSignedUrlDto } from "@shared/api/v1/dto";
import type { CreateUserUploadSignedUrlResponse } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

interface FileUploaderProps {
	mimeType: string;
	baseFileName: string;
	onUploadComplete?: (objectPath: string) => void;
	onUploadError?: (error: string) => void;
	children?: React.ReactNode;
}

interface UploadProgress {
	loaded: number;
	total: number;
	percentage: number;
}

/**
 * FileUploader handles the complete file upload workflow with signed URLs
 * Following the sequence diagram workflow from the user requirements
 */
export function FileUploader({ mimeType, baseFileName, onUploadComplete, onUploadError, children }: FileUploaderProps) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const uploadFile = useCallback(
		async (file: Blob | File): Promise<string> => {
			setIsUploading(true);
			setUploadProgress({ loaded: 0, total: file.size, percentage: 0 });
			setUploadError(null);

			try {
				// Step 1: Get signed URL from backend
				logFrontendEvent({
					event_name: "file_upload_signed_url_request",
					error_level: "debug",
					payload: { mimeType, baseFileName, fileSize: file.size },
				});

				const signedUrlResponse = await callBackend<CreateUserUploadSignedUrlDto, CreateUserUploadSignedUrlResponse>(
					"v1/user-uploads/signed-url",
					{
						method: "POST",
						requestPayload: {
							mimeType,
							baseFileName,
						},
					},
				);

				logFrontendEvent({
					event_name: "file_upload_signed_url_received",
					error_level: "log",
					payload: { objectPath: signedUrlResponse.objectPath, expiresAt: signedUrlResponse.expiresAt },
				});

				// Step 2: Upload file directly to GCS using signed URL
				logFrontendEvent({
					event_name: "file_upload_to_storage_started",
					error_level: "debug",
					payload: { objectPath: signedUrlResponse.objectPath },
				});

				await new Promise<void>((resolve, reject) => {
					const xhr = new XMLHttpRequest();

					// Track upload progress
					xhr.upload.addEventListener("progress", (event) => {
						if (event.lengthComputable) {
							const percentage = (event.loaded / event.total) * 100;
							setUploadProgress({
								loaded: event.loaded,
								total: event.total,
								percentage,
							});

							logFrontendEvent({
								event_name: "file_upload_progress",
								error_level: "debug",
								payload: {
									percentage: percentage.toFixed(1),
									loaded: event.loaded,
									total: event.total,
								},
							});
						}
					});

					// Handle upload completion
					xhr.addEventListener("load", () => {
						if (xhr.status >= 200 && xhr.status < 300) {
							setUploadProgress({ loaded: file.size, total: file.size, percentage: 100 });

							logFrontendEvent({
								event_name: "file_upload_to_storage_success",
								error_level: "log",
								payload: {
									objectPath: signedUrlResponse.objectPath,
									status: xhr.status,
								},
							});

							resolve();
						} else {
							const errorMessage = `Upload failed with status: ${xhr.status}`;

							logFrontendEvent({
								event_name: "file_upload_to_storage_error",
								error_level: "error",
								payload: {
									error: errorMessage,
									status: xhr.status,
									responseText: xhr.responseText,
								},
							});

							reject(new Error(errorMessage));
						}
					});

					// Handle network errors
					xhr.addEventListener("error", () => {
						const errorMessage = "Network error during upload";

						logFrontendEvent({
							event_name: "file_upload_network_error",
							error_level: "error",
							payload: { error: errorMessage },
						});

						reject(new Error(errorMessage));
					});

					// Handle upload timeout
					xhr.addEventListener("timeout", () => {
						const errorMessage = "Upload timed out";

						logFrontendEvent({
							event_name: "file_upload_timeout",
							error_level: "error",
							payload: { error: errorMessage },
						});

						reject(new Error(errorMessage));
					});

					// Start the upload
					xhr.open("PUT", signedUrlResponse.putUrl);
					xhr.setRequestHeader("Content-Type", mimeType);
					xhr.timeout = 5 * 60 * 1000; // 5 minute timeout
					xhr.send(file);
				});

				// Return the object path for further use
				logFrontendEvent({
					event_name: "file_upload_complete",
					error_level: "log",
					payload: { objectPath: signedUrlResponse.objectPath },
				});

				onUploadComplete?.(signedUrlResponse.objectPath);
				return signedUrlResponse.objectPath;
			} catch (error: any) {
				const errorMessage = error?.message || "Upload failed";
				setUploadError(errorMessage);

				logFrontendEvent({
					event_name: "file_upload_failed",
					error_level: "error",
					payload: { error: errorMessage, mimeType, baseFileName },
				});

				onUploadError?.(errorMessage);
				throw error;
			} finally {
				setIsUploading(false);
			}
		},
		[callBackend, mimeType, baseFileName, logFrontendEvent, onUploadComplete, onUploadError],
	);

	const handleFileSelect = useCallback(() => {
		if (Platform.OS === "web") {
			// Web file selection
			const input = document.createElement("input");
			input.type = "file";
			input.accept = mimeType.startsWith("image/") ? "image/*" : mimeType;

			input.onchange = async (event: any) => {
				const file = event.target.files?.[0];
				if (file) {
					try {
						await uploadFile(file);
					} catch (error) {
						console.error("Upload failed:", error);
					}
				}
			};

			input.click();
		} else {
			// Native file selection would go here
			// For now, show a message that this would trigger camera/gallery
			Alert.alert(i18n.t("FileUpload.title"), i18n.t("FileUpload.nativeNotImplemented"), [
				{ text: i18n.t("Common.ok") },
			]);
		}
	}, [uploadFile, mimeType]);

	const clearError = useCallback(() => {
		setUploadError(null);
	}, []);

	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return "0 B";
		const k = 1024;
		const sizes = ["B", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
	};

	const formatProgress = (progress: UploadProgress): string => {
		return `${formatFileSize(progress.loaded)} / ${formatFileSize(progress.total)} (${progress.percentage.toFixed(1)}%)`;
	};

	if (children) {
		return (
			<TouchableOpacity onPress={handleFileSelect} disabled={isUploading}>
				{children}
				{isUploading && (
					<View style={styles.overlay}>
						<ActivityIndicator size="small" color="#FFF" />
					</View>
				)}
			</TouchableOpacity>
		);
	}

	return (
		<View style={styles.container}>
			{uploadError && (
				<View style={styles.errorContainer}>
					<Text style={styles.errorText}>{uploadError}</Text>
					<TouchableOpacity style={styles.clearErrorButton} onPress={clearError}>
						<X size={16} color="#FF3B30" />
					</TouchableOpacity>
				</View>
			)}

			{isUploading && uploadProgress && (
				<View style={styles.progressContainer}>
					<View style={styles.progressHeader}>
						<Text style={styles.progressTitle}>{i18n.t("FileUpload.uploading")}</Text>
						<Text style={styles.progressText}>{formatProgress(uploadProgress)}</Text>
					</View>
					<View style={styles.progressBar}>
						<View style={[styles.progressFill, { width: `${uploadProgress.percentage}%` }]} />
					</View>
				</View>
			)}

			<TouchableOpacity
				style={[styles.uploadButton, isUploading && styles.uploadButtonDisabled]}
				onPress={handleFileSelect}
				disabled={isUploading}>
				{isUploading ? (
					<>
						<ActivityIndicator size="small" color="#FFF" />
						<Text style={styles.uploadButtonText}>{i18n.t("FileUpload.uploading")}</Text>
					</>
				) : (
					<>
						{mimeType.startsWith("image/") ? <Camera size={20} color="#FFF" /> : <Upload size={20} color="#FFF" />}
						<Text style={styles.uploadButtonText}>
							{mimeType.startsWith("image/") ? i18n.t("FileUpload.selectImage") : i18n.t("FileUpload.selectFile")}
						</Text>
					</>
				)}
			</TouchableOpacity>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		width: "100%",
	},
	overlay: {
		...StyleSheet.absoluteFillObject,
		backgroundColor: "rgba(0, 0, 0, 0.5)",
		justifyContent: "center",
		alignItems: "center",
		borderRadius: 8,
	},
	errorContainer: {
		flexDirection: "row",
		alignItems: "center",
		backgroundColor: "#FFEBEE",
		borderWidth: 1,
		borderColor: "#FFCDD2",
		borderRadius: 8,
		padding: 12,
		marginBottom: 12,
	},
	errorText: {
		flex: 1,
		fontSize: 14,
		color: "#C62828",
	},
	clearErrorButton: {
		padding: 4,
	},
	progressContainer: {
		backgroundColor: "#F5F5F5",
		borderRadius: 8,
		padding: 12,
		marginBottom: 12,
	},
	progressHeader: {
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
		marginBottom: 8,
	},
	progressTitle: {
		fontSize: 14,
		fontWeight: "600",
		color: "#333",
	},
	progressText: {
		fontSize: 12,
		color: "#666",
	},
	progressBar: {
		height: 4,
		backgroundColor: "#E0E0E0",
		borderRadius: 2,
		overflow: "hidden",
	},
	progressFill: {
		height: "100%",
		backgroundColor: "#007AFF",
		borderRadius: 2,
	},
	uploadButton: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#007AFF",
		paddingVertical: 12,
		paddingHorizontal: 16,
		borderRadius: 8,
		gap: 8,
	},
	uploadButtonDisabled: {
		backgroundColor: "#A0A0A0",
	},
	uploadButtonText: {
		fontSize: 16,
		fontWeight: "600",
		color: "#FFF",
	},
});
