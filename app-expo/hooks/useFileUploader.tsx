// app-expo/hooks/useFileUploader.tsx
import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { Directory, File, Paths } from "expo-file-system";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import type { CreateUserUploadSignedUrlDto } from "@shared/api/v1/dto";
import type { CreateUserUploadSignedUrlResponse } from "@shared/api/v1/res";

export interface UploadProgress {
	/** 送信済みバイト数（概念的・ステージベース） */
	loaded: number;
	/** 総バイト数（分かる場合のみ設定。分からなければ 0） */
	total: number;
	/** 0–100 (%)。ステージベースで 0 / 100 を通知 */
	percentage: number;
	/** "idle" | "preparing" | "uploading" | "done" | "error" */
	stage: "idle" | "preparing" | "uploading" | "done" | "error";
}

export interface UploadFileOptions {
	mimeType: string;
	baseFileName: string;
}

export interface UseFileUploaderResult {
	/**
	 * 既存コードと互換:
	 *  - 第1引数: URI
	 *  - 第2引数: { mimeType, baseFileName }
	 *  - 戻り値: サーバー側で扱う「パス文字列」
	 */
	uploadFile: (uri: string, options: UploadFileOptions) => Promise<string>;
	isUploading: boolean;
	progress: UploadProgress;
	cancel: () => void;
}

/**
 * #SDK54 モダン FileSystem API + expo/fetch ベースのアップローダ
 *
 * - legacy API（createUploadTask / downloadAsync / cacheDirectory）非使用
 * - File / Directory / Paths + expo/fetch で実装
 * - 既存の呼び出しシグネチャ (uri, { mimeType, baseFileName }) を維持
 * - 戻り値は string (mediaPath / thumbnailPath / avatar_path 用)
 */
export function useFileUploader(): UseFileUploaderResult {
	const { logFrontendEvent } = useLogger();

	const [isUploading, setIsUploading] = useState(false);
	const [progress, setProgress] = useState<UploadProgress>({
		loaded: 0,
		total: 0,
		percentage: 0,
		stage: "idle",
	});

	// 現在進行中のアップロードを中断するための AbortController
	const abortControllerRef = useRef<AbortController | null>(null);

	const updateProgress = useCallback((partial: Partial<UploadProgress>) => {
		setProgress((prev) => {
			const next: UploadProgress = {
				...prev,
				...partial,
			};

			// ステージに応じてだいたいの percentage を補正
			if (partial.stage === "preparing" && next.percentage < 5) {
				next.percentage = 5;
			} else if (partial.stage === "uploading" && next.percentage < 10) {
				next.percentage = 10;
			} else if (partial.stage === "done") {
				next.percentage = 100;
				next.loaded = next.total || next.loaded;
			}

			return next;
		});
	}, []);

	/**
	 * URI からアップロード用の body を解決
	 * - Web: Blob / File
	 * - ネイティブ: expo-file-system の File インスタンス
	 *
	 * TS 的には any を返し、expo/fetch 側で受ける（実装的には OK）
	 */
	const resolveUploadBodyFromUri = useCallback(
		async (uri: string, mimeType: string, fileName?: string): Promise<{ body: any; totalBytes: number }> => {
			// Web → ブラウザの fetch / Blob を使う
			if (Platform.OS === "web") {
				const res = await fetch(uri);
				if (!res.ok) {
					throw new Error(`Failed to load source file on web. status=${res.status}`);
				}
				const blob = await res.blob();
				const totalBytes = blob.size ?? 0;

				// fileName があればブラウザの File に包んであげるとサーバー側で扱いやすい
				const webFile = fileName != null ? new window.File([blob], fileName, { type: mimeType }) : blob;

				return {
					body: webFile,
					totalBytes,
				};
			}

			// ネイティブ: HTTP(S) → cache にダウンロードしてから File として扱う
			if (uri.startsWith("http://") || uri.startsWith("https://")) {
				const uploadsDir = new Directory(Paths.cache, "uploads");
				uploadsDir.create({ intermediates: true });

				const downloadedFile = await File.downloadFileAsync(uri, uploadsDir);
				const totalBytes = downloadedFile.size ?? 0;

				return {
					body: downloadedFile, // expo/fetch は File をそのまま body に取れる
					totalBytes,
				};
			}

			// それ以外（file://, content://, asset 等）はその URI を指す File として扱う
			const file = new File(uri);
			const totalBytes = file.size ?? 0;

			return {
				body: file,
				totalBytes,
			};
		},
		[],
	);

	const cancel = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
			updateProgress({ stage: "error" });
		}
	}, [updateProgress]);

	const { callBackend } = useAPICall();
	const createSignedUrl = useCallback(
		async (requestPayload: CreateUserUploadSignedUrlDto) => {
			return callBackend<CreateUserUploadSignedUrlDto, CreateUserUploadSignedUrlResponse>(
				"v1/user-uploads/signed-url",
				{
					method: "POST",
					requestPayload,
				},
			);
		},
		[callBackend],
	);

	const uploadFile = useCallback(
		async (uri: string, options: UploadFileOptions): Promise<string> => {
			const { mimeType, baseFileName } = options;

			if (isUploading) {
				logFrontendEvent({
					event_name: "file_upload_in_progress_error",
					error_level: "warn",
					payload: {},
				});
				throw new Error("Another upload is already in progress.");
			}

			setIsUploading(true);
			updateProgress({
				stage: "preparing",
				loaded: 0,
				total: 0,
				percentage: 0,
			});

			const abortController = new AbortController();
			abortControllerRef.current = abortController;

			try {
				// 1. 署名付き URL を取得
				const signedUrlPayload = {
					mimeType,
					baseFileName,
				} as CreateUserUploadSignedUrlDto;

				logFrontendEvent({
					event_name: "file_upload_signed_url_request",
					error_level: "log",
					payload: {
						mimeType,
						baseFileName,
					},
				});

				// 1. 署名付き URL をバックエンドから取得
				const signedUrlResponse = await createSignedUrl(signedUrlPayload);

				if (!signedUrlResponse?.putUrl) {
					throw new Error("Signed URL response does not contain putUrl.");
				}

				// 2. URI → File / Blob を解決
				const { body, totalBytes } = await resolveUploadBodyFromUri(uri, mimeType, baseFileName);

				updateProgress({
					stage: "uploading",
					total: totalBytes,
					// まだ送信前なので loaded=0, percentage=10 程度にして「準備完了」を演出
					loaded: 0,
					percentage: 10,
				});

				logFrontendEvent({
					event_name: "file_upload_start_via_expo_fetch",
					error_level: "log",
					payload: {
						totalBytes,
						mimeType,
					},
				});

				// 3. expo/fetch で PUT アップロード
				const response = await expoFetch(signedUrlResponse.putUrl, {
					method: "PUT",
					headers: {
						"Content-Type": mimeType,
					},
					body, // 型は any だが、expo/fetch は File / Blob をそのまま受け取れる
					signal: abortController.signal,
				});

				if (!response.ok) {
					const text = await response.text().catch(() => "");
					logFrontendEvent({
						event_name: "file_upload_failed",
						error_level: "error",
						payload: {
							status: response.status,
							body: text.slice(0, 200),
						},
					});
					throw new Error(`Upload failed: status=${response.status} body=${text.slice(0, 200)}`);
				}

				// 4. レスポンスから「パス文字列」を取り出す
				const anyRes = signedUrlResponse as any;
				const uploadedPath: string | undefined =
					anyRes.path ?? anyRes.filePath ?? anyRes.key ?? anyRes.url ?? anyRes.getUrl;

				if (!uploadedPath || typeof uploadedPath !== "string") {
					logFrontendEvent({
						event_name: "file_upload_no_path_error",
						error_level: "error",
						payload: {},
					});
					throw new Error(
						"Upload signed URL response does not contain a path string (expected path/filePath/key/url/getUrl).",
					);
				}

				updateProgress({
					stage: "done",
					loaded: totalBytes,
					total: totalBytes,
					percentage: 100,
				});

				logFrontendEvent({
					event_name: "file_upload_succeeded",
					error_level: "log",
					payload: {
						totalBytes,
					},
				});

				// 既存コードが期待している string を返す
				return uploadedPath;
			} catch (error: any) {
				if (error?.name === "AbortError") {
					logFrontendEvent({
						event_name: "file_upload_aborted",
						error_level: "warn",
						payload: {},
					});
					updateProgress({
						stage: "error",
					});
					throw new Error("Upload aborted");
				}

				logFrontendEvent({
					event_name: "file_upload_error",
					error_level: "error",
					payload: {
						message: error?.message,
					},
				});
				updateProgress({
					stage: "error",
				});
				throw error;
			} finally {
				setIsUploading(false);
				abortControllerRef.current = null;
			}
		},
		[createSignedUrl, isUploading, logFrontendEvent, resolveUploadBodyFromUri, updateProgress],
	);

	return {
		uploadFile,
		isUploading,
		progress,
		cancel,
	};
}
