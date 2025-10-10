import { useCallback, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import type { CreateUserUploadSignedUrlDto } from "@shared/api/v1/dto";
import type { CreateUserUploadSignedUrlResponse } from "@shared/api/v1/res";
import * as FileSystem from "expo-file-system";

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

	const cancelTokenRef = useRef<{ cancel: () => void } | null>(null);

	const getSignedUrl = useCallback(async () => {
		return callBackend<CreateUserUploadSignedUrlDto, CreateUserUploadSignedUrlResponse>("v1/user-uploads/signed-url", {
			method: "POST",
			requestPayload: {
				mimeType,
				baseFileName,
			},
		});
	}, [callBackend, mimeType, baseFileName]);

	/**
	 * ファイルアップロード（署名付きURL方式）
	 * @param uri file:// や asset:// のローカルパス
	 * @param baseFileName 任意：ログ識別用ファイル名
	 */
	const uploadFile = useCallback(
		async (uri: string, baseFileName?: string): Promise<string> => {
			setIsUploading(true);
			setUploadProgress({ loaded: 0, total: 0, percentage: 0 });
			setUploadError(null);

			try {
				// ---- Step 1: Get signed URL from backend ----
				const signedUrlResponse = await getSignedUrl();

				// ---- Step 2: Perform upload (streamed, no Blob) ----
				logFrontendEvent({
					event_name: "file_upload_started",
					error_level: "log",
					payload: { uri, mimeType, objectPath: signedUrlResponse.objectPath },
				});

				const uploadTask = FileSystem.createUploadTask(
					signedUrlResponse.putUrl,
					uri,
					{
						httpMethod: "PUT",
						headers: { "Content-Type": mimeType },
						uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
					},
					(progress) => {
						const percentage = (progress.totalBytesSent / progress.totalBytesExpectedToSend) * 100;
						setUploadProgress({
							loaded: progress.totalBytesSent,
							total: progress.totalBytesExpectedToSend,
							percentage,
						});

						logFrontendEvent({
							event_name: "file_upload_progress",
							error_level: "debug",
							payload: {
								percentage: percentage.toFixed(1),
								loaded: progress.totalBytesSent,
								total: progress.totalBytesExpectedToSend,
							},
						});
					},
				);

				cancelTokenRef.current = { cancel: () => uploadTask.cancelAsync() };

				const result = await uploadTask.uploadAsync();

				if (!result) throw new Error("Upload failed: No response");

				if (result.status >= 200 && result.status < 300) {
					setUploadProgress((p) => (p ? { ...p, percentage: 100, loaded: p.total, total: p.total } : null));

					logFrontendEvent({
						event_name: "file_upload_success",
						error_level: "log",
						payload: {
							objectPath: signedUrlResponse.objectPath,
							status: result.status,
						},
					});

					return signedUrlResponse.objectPath;
				}

				throw new Error(`Upload failed with status ${result.status}`);
			} catch (err: any) {
				const errorMessage = err?.message || "Upload failed";
				setUploadError(errorMessage);

				logFrontendEvent({
					event_name: "file_upload_failed",
					error_level: "error",
					payload: { error: errorMessage, baseFileName: baseFileName },
				});

				throw err;
			} finally {
				setIsUploading(false);
				cancelTokenRef.current = null;
			}
		},
		[getSignedUrl, logFrontendEvent],
	);

	const cancelUpload = useCallback(() => {
		cancelTokenRef.current?.cancel();
	}, []);

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
		cancelUpload,
		clearError,
		getSignedUrl,
		formatFileSize,
		formatProgress,
	};
}
