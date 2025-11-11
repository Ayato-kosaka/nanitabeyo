import { Platform } from "react-native";

/**
 * アバター画像アップロード結果
 */
export interface AvatarUploadResult {
	success: boolean;
	avatarPath?: string;
	error?: "upload_failed" | "api_failed" | "invalid_session" | "unknown";
	errorMessage?: string;
}

/**
 * 画像ファイルをBlobに変換（Web用）
 */
async function uriToBlob(uri: string): Promise<Blob> {
	const response = await fetch(uri);
	return await response.blob();
}

/**
 * アバター画像を GCS にアップロードして、API に登録する
 *
 * @param imageUri 選択した画像のURI
 * @param mimeType 画像のMIMEタイプ
 * @param fileName ファイル名
 * @param userId ユーザーID
 * @param accessToken アクセストークン
 * @returns アップロード結果
 */
export async function uploadAvatarImage(
	imageUri: string,
	mimeType: string,
	fileName: string,
	userId: string,
	accessToken: string,
): Promise<AvatarUploadResult> {
	try {
		// 1. GCS署名付きURL取得
		const signedUrlResponse = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/user-uploads/signed-url`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				mimeType,
				baseFileName: fileName,
			}),
		});

		if (!signedUrlResponse.ok) {
			const errorText = await signedUrlResponse.text();
			return {
				success: false,
				error: "api_failed",
				errorMessage: `Failed to get signed URL: ${errorText}`,
			};
		}

		const { putUrl, objectPath } = (await signedUrlResponse.json()) as {
			putUrl: string;
			objectPath: string;
			expiresAt: string;
		};

		// 2. 画像を GCS にアップロード
		let imageBlob: Blob;
		if (Platform.OS === "web") {
			imageBlob = await uriToBlob(imageUri);
		} else {
			// ネイティブの場合、fetchでBlobを取得
			const response = await fetch(imageUri);
			imageBlob = await response.blob();
		}

		const uploadResponse = await fetch(putUrl, {
			method: "PUT",
			headers: {
				"Content-Type": mimeType,
			},
			body: imageBlob,
		});

		if (!uploadResponse.ok) {
			return {
				success: false,
				error: "upload_failed",
				errorMessage: `Failed to upload to GCS: ${uploadResponse.statusText}`,
			};
		}

		// 3. API にプロフィール更新リクエスト
		const updateProfileResponse = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/users/${userId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				avatar_path: objectPath,
			}),
		});

		if (!updateProfileResponse.ok) {
			const errorText = await updateProfileResponse.text();
			return {
				success: false,
				error: "api_failed",
				errorMessage: `Failed to update profile: ${errorText}`,
			};
		}

		const updatedProfile = await updateProfileResponse.json();

		return {
			success: true,
			avatarPath: updatedProfile.avatar_path,
		};
	} catch (error) {
		console.error("Error uploading avatar image:", error);
		return {
			success: false,
			error: "unknown",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
