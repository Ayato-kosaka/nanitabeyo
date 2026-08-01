import { useCallback, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import type { CreateUserUploadSignedUrlDto } from "@shared/api/v1/dto";
import type { CreateUserUploadSignedUrlResponse } from "@shared/api/v1/res";
// #1156 Expo SDK 54 で expo-file-system は新 API が既定になった。
// 旧 API(cacheDirectory / EncodingType / FileSystemUploadType 等)は legacy サブパスへ移動している。
import * as FileSystem from "expo-file-system/legacy";

export interface UploadProgress {
	loaded: number;
	total: number;
	percentage: number;
}

export interface FileUploaderOptions {
	mimeType: string;
	baseFileName: string;
}

export function useFileUploader() {
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();

	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const cancelTokenRef = useRef<{ cancel: () => void } | null>(null);

	const getSignedUrl = useCallback(
		async (fileUploaderOptions: FileUploaderOptions) => {
			return callBackend<CreateUserUploadSignedUrlDto, CreateUserUploadSignedUrlResponse>(
				"v1/user-uploads/signed-url",
				{
					method: "POST",
					requestPayload: fileUploaderOptions,
				},
			);
		},
		[callBackend],
	);

	/**
	 * ファイルアップロード（署名付きURL方式）
	 * @param uri file:// や asset:// のローカルパス
	 * @param fileUploaderOptions アップロードオプション
	 */
	const uploadFile = useCallback(
		async (uri: string, fileUploaderOptions: FileUploaderOptions): Promise<string> => {
			setIsUploading(true);
			setUploadProgress({ loaded: 0, total: 0, percentage: 0 });
			setUploadError(null);
			const { mimeType, baseFileName } = fileUploaderOptions;

			try {
				// ---- Step 1: Get signed URL from backend ----
				const signedUrlResponse = await getSignedUrl(fileUploaderOptions);

				// ---- Step 2: Perform upload (streamed, no Blob) ----
				logFrontendEvent({
					event_name: "file_upload_started",
					error_level: "log",
					payload: { mimeType, objectPath: signedUrlResponse.objectPath },
				});

				if (Platform.OS === "web") {
					// Expo Web では expo-file-system の createUploadTask（内部の uploadTaskStartAsync）が未実装
					// そのため、Web 環境では fetch で PUT リクエストを送る

					// ---- Web: fetch PUT（進捗は完了時に100%へ）----
					const controller = new AbortController();
					cancelTokenRef.current = { cancel: () => controller.abort() };

					// uri は blob:, data:, https: などを想定
					const src = await fetch(uri);
					const blob = await src.blob();

					try {
						const resp = await fetch(signedUrlResponse.putUrl, {
							method: "PUT",
							mode: "cors", // 明示
							credentials: "omit", // 署名URLはCookie不要
							referrerPolicy: "no-referrer",
							headers: { "Content-Type": mimeType },
							body: blob,
							signal: controller.signal,
							cache: "no-store",
						});

						if (!resp.ok) {
							// ここに来る＝CORSは通過している。ステータスをログ出し
							const text = await resp.text().catch(() => "");
							throw new Error(`Upload failed: ${resp.status} ${resp.statusText} ${text}`);
						}

						setUploadProgress({ loaded: blob.size, total: blob.size, percentage: 100 });

						logFrontendEvent({
							event_name: "file_upload_success",
							error_level: "log",
							payload: { objectPath: signedUrlResponse.objectPath, status: resp.status },
						});

						return signedUrlResponse.objectPath;
					} catch (e: any) {
						// CORS で弾かれた場合はここに来て "TypeError: Failed to fetch"
						logFrontendEvent({
							event_name: "file_upload_failed",
							error_level: "error",
							payload: {
								error: e?.message || "Failed to fetch",
								name: e?.name,
								baseFileName: baseFileName,
							},
						});
						throw e;
					}
				}

				const localUri = await downloadToLocalIfNeeded(uri);

				const uploadTask = FileSystem.createUploadTask(
					signedUrlResponse.putUrl,
					localUri,
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

// 必要に応じてローカルファイルにダウンロードするユーティリティ
const downloadToLocalIfNeeded = async (uri: string): Promise<string> => {
	if (Platform.OS === "web") return uri; // WebはそのままfetchでOK
	if (uri.startsWith("file://")) return uri;
	// http(s) → 一時ファイルに保存
	const tmp = `${FileSystem.cacheDirectory}avatar-${Date.now()}.tmp`;
	const { uri: localUri, status } = await FileSystem.downloadAsync(uri, tmp);
	if (status < 200 || status >= 300) throw new Error(`Download failed: ${status}`);
	return localUri;
};
