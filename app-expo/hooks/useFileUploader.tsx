import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import type { CreateUserUploadSignedUrlDto } from "@shared/api/v1/dto";
import type { CreateUserUploadSignedUrlResponse } from "@shared/api/v1/res";
import i18n from "@/lib/i18n";

export interface UploadProgress {
	loaded: number;
	total: number;
	percentage: number;
}

export interface UseFileUploaderOptions {
	mimeType: string;
	baseFileName: string;
}

export function useFileUploader({ mimeType, baseFileName }: UseFileUploaderOptions) {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const getSignedUrl = useCallback(async () => {
		return callBackend<CreateUserUploadSignedUrlDto, CreateUserUploadSignedUrlResponse>("v1/user-uploads/signed-url", {
			method: "POST",
			requestPayload: {
				mimeType,
				baseFileName,
			},
		});
	}, [callBackend, mimeType, baseFileName]);

	const uploadFile = useCallback(
		async (file: Blob | File): Promise<string> => {
			setIsUploading(true);
			setUploadProgress({ loaded: 0, total: file.size, percentage: 0 });
			setUploadError(null);

			try {
				// Step 1: Get signed URL from backend
				const signedUrlResponse = await getSignedUrl();

				// Step 2: Upload file directly to GCS using signed URL
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
				return signedUrlResponse.objectPath;
			} catch (error: any) {
				const errorMessage = error?.message || "Upload failed";
				setUploadError(errorMessage);

				logFrontendEvent({
					event_name: "file_upload_failed",
					error_level: "error",
					payload: { error: errorMessage, mimeType, baseFileName },
				});

				throw error;
			} finally {
				setIsUploading(false);
			}
		},
		[callBackend, getSignedUrl, mimeType, baseFileName, logFrontendEvent],
	);

	const selectFile = useCallback(() => {
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

	return {
		isUploading,
		uploadProgress,
		uploadError,
		uploadFile,
		selectFile,
		clearError,
		getSignedUrl,
		formatFileSize,
		formatProgress,
	};
}
