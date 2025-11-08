import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";

/**
 * 画像選択結果
 */
export interface AvatarSelectionResult {
	success: boolean;
	imageUri?: string;
	mimeType?: string;
	fileName?: string;
	error?: "cancelled" | "permission_denied" | "invalid_image" | "unknown";
	errorMessage?: string;
}

/**
 * メディアライブラリのパーミッションをリクエスト
 */
async function requestPermissions(): Promise<boolean> {
	if (Platform.OS === "web") {
		return true; // Webはパーミッション不要
	}

	const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
	return status === "granted";
}

/**
 * プロフィール画像選択用の画像ピッカーを起動
 * 正方形にトリミングされた画像を返す
 */
export async function selectAvatarImage(): Promise<AvatarSelectionResult> {
	try {
		// パーミッションをリクエスト
		const hasPermission = await requestPermissions();
		if (!hasPermission) {
			return {
				success: false,
				error: "permission_denied",
			};
		}

		// 画像ピッカーを起動
		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ["images"], // 画像のみ
			allowsMultipleSelection: false,
			quality: 0.9, // 高品質だが完全な1.0ではなくファイルサイズを抑える
			allowsEditing: true, // 編集モードを有効化（正方形トリミング）
			aspect: [1, 1], // 正方形のアスペクト比
		});

		if (result.canceled) {
			return { success: false, error: "cancelled" };
		}

		const asset = result.assets[0];
		if (!asset) {
			return { success: false, error: "unknown" };
		}

		// 画像のMIMEタイプを確認
		const mimeType = asset.mimeType ?? "image/jpeg";
		if (!mimeType.startsWith("image/")) {
			return {
				success: false,
				error: "invalid_image",
				errorMessage: "Selected file is not an image",
			};
		}

		return {
			success: true,
			imageUri: asset.uri,
			mimeType,
			fileName: asset.fileName ?? "avatar.jpg",
		};
	} catch (error) {
		console.error("Error selecting avatar image:", error);
		return {
			success: false,
			error: "unknown",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
