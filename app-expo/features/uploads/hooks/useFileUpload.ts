import { useState, useCallback } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import type {
	CreateUserUploadSignedUrlDto,
} from "@shared/api/v1/dto";
import type {
	CreateUserUploadSignedUrlResponse,
} from "@shared/api/v1/res";

/**
 * ファイルアップロード関連の API 呼び出しフック
 * 
 * - GCS 署名付き URL の発行
 * - ファイルアップロードの実行
 */
export const useFileUpload = () => {
	const [isLoading, setIsLoading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<number>(0);
	const [error, setError] = useState<string | null>(null);
	const { callBackend } = useAPICall();

	/**
	 * GCS 署名付き URL を発行
	 */
	const getSignedUploadUrl = useCallback(
		async (data: CreateUserUploadSignedUrlDto): Promise<CreateUserUploadSignedUrlResponse> => {
			setIsLoading(true);
			setError(null);
			try {
				const response = await callBackend<CreateUserUploadSignedUrlDto, CreateUserUploadSignedUrlResponse>(
					"/v1/user-uploads/signed-url",
					{
						method: "POST",
						requestPayload: data,
					}
				);
				return response;
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Unknown error";
				setError(errorMessage);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend]
	);

	/**
	 * 署名付き URL を使ってファイルをアップロード
	 */
	const uploadFile = useCallback(
		async (putUrl: string, file: Blob | File, contentType: string): Promise<void> => {
			setIsLoading(true);
			setUploadProgress(0);
			setError(null);

			try {
				// Create XMLHttpRequest for progress tracking
				const xhr = new XMLHttpRequest();

				return new Promise((resolve, reject) => {
					xhr.upload.addEventListener("progress", (event) => {
						if (event.lengthComputable) {
							const progress = (event.loaded / event.total) * 100;
							setUploadProgress(progress);
						}
					});

					xhr.addEventListener("load", () => {
						if (xhr.status >= 200 && xhr.status < 300) {
							setUploadProgress(100);
							resolve();
						} else {
							reject(new Error(`Upload failed with status: ${xhr.status}`));
						}
					});

					xhr.addEventListener("error", () => {
						reject(new Error("Network error during upload"));
					});

					xhr.open("PUT", putUrl);
					xhr.setRequestHeader("Content-Type", contentType);
					xhr.send(file);
				});
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Upload failed";
				setError(errorMessage);
				throw err;
			} finally {
				setIsLoading(false);
			}
		},
		[]
	);

	/**
	 * 署名付き URL 発行とファイルアップロードを一度に実行
	 */
	const uploadFileWithSignedUrl = useCallback(
		async (
			file: Blob | File,
			contentType: string,
			identifier: string
		): Promise<{ objectPath: string; putUrl: string }> => {
			try {
				// 1. 署名付き URL を取得
				const signedUrlResponse = await getSignedUploadUrl({
					contentType,
					identifier,
				});

				// 2. ファイルをアップロード
				await uploadFile(signedUrlResponse.putUrl, file, contentType);

				return {
					objectPath: signedUrlResponse.objectPath,
					putUrl: signedUrlResponse.putUrl,
				};
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : "Upload failed";
				setError(errorMessage);
				throw err;
			}
		},
		[getSignedUploadUrl, uploadFile]
	);

	return {
		getSignedUploadUrl,
		uploadFile,
		uploadFileWithSignedUrl,
		isLoading,
		uploadProgress,
		error,
	};
};