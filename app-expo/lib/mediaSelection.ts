import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import type { CreateDishMediaDto } from "@shared/api/v1/dto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { selectMediaForE2E } from "./e2e/selectMediaStub";

const MAX_VIDEO_DURATION_SECONDS = 120; // 2 minutes

export interface MediaData {
	type: CreateDishMediaDto["mediaType"];
	uri: string;
	width?: number;
	height?: number;
	durationSec?: number;
	thumbnailUri?: string;
	mimeType: string;
}

interface MediaSelectionResult {
	success: boolean;
	media?: MediaData;
	error?:
		| "cancelled"
		| "permission_denied"
		| "video_too_long"
		| "thumbnail_failed"
		| "unsupported_image_format"
		| "unknown";
	errorMessage?: string;
}

function isVideoAsset(asset: ImagePicker.ImagePickerAsset): boolean {
	if (asset.type === "video") return true;
	const mt = asset.mimeType?.toLowerCase() ?? "";
	if (mt.startsWith("video/")) return true;
	const ext = asset.fileName?.split(".").pop()?.toLowerCase();
	return ext === "mp4" || ext === "mov" || ext === "m4v";
}

/**
 * #1425 サーバがデコードできない画像形式か。現状は HEIC / HEIF のみ。
 *
 * `mimeType` は端末・プラットフォームによって欠けることがあるため、
 * ファイル名と URI の拡張子もあわせて見る（Android は mimeType を返さない場合がある）。
 *
 * ⚠️ ここを「EXTENSION_TABLE に無いものは全部弾く」へ広げないこと。
 * 現状たまたま通っている形式まで巻き込んで、直っていたものを壊す。
 * 実測で失敗が確認されている HEIC / HEIF だけを対象にする。
 */
function isUnsupportedImageAsset(asset: { mimeType?: string | null; fileName?: string | null; uri?: string }): boolean {
	const mimeType = asset.mimeType?.toLowerCase() ?? "";
	if (mimeType === "image/heic" || mimeType === "image/heif") return true;

	// クエリ文字列やフラグメントを落としてから拡張子を見る
	const name = (asset.fileName ?? asset.uri ?? "").toLowerCase().split(/[?#]/)[0] ?? "";
	return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * #1750 【バグ】`asset.mimeType` は端末によって **空文字**で返る。
 *
 * 旧実装は `asset.mimeType ?? "application/octet-stream"` だったが、`??` は `null` /
 * `undefined` しか拾わないので `""` はそのまま素通りしていた。本番ログ（prod,
 * 2026-08）に `{"mimeType":"","baseFileName":"user-avatar"}` が実在し、その結果
 *   - API の `getExt("")` が "bin" を返し、原本が `..._user-avatar.bin` で保存される
 *   - `buildFullPath` の usageType が `<userId>/` + "" となり **パスに // が入る**
 *   - 呼び出し側が `if (!mimeType) throw` で弾いていると、保存そのものが失敗する
 * が同時に起きていた。
 *
 * ここで «選んだ時点で» 拡張子から埋めておけば、後段はどれも起きない。
 * 判別できないときだけ `application/octet-stream` へ落とす（従来の既定値と同じ）。
 */
function resolveMimeType(asset: { mimeType?: string | null; fileName?: string | null; uri?: string }): string {
	const declared = asset.mimeType?.trim();
	if (declared) return declared;

	const name = (asset.fileName ?? asset.uri ?? "").toLowerCase().split(/[?#]/)[0] ?? "";
	const ext = name.includes(".") ? name.split(".").pop() : undefined;

	// API の EXTENSION_TABLE（api/src/core/storage/storage.utils.ts）に載っているものだけを埋める。
	// ここに無い拡張子を勝手に足すと、サーバが読めない形式へ «読めるふり» の MIME を付けることになる
	const table: Record<string, string> = {
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		gif: "image/gif",
		webp: "image/webp",
		mp4: "video/mp4",
		mov: "video/quicktime",
	};
	return (ext && table[ext]) || "application/octet-stream";
}

// ミリ秒/秒 混在に耐える正規化
function normalizeToSeconds(raw?: number | null): number | null {
	if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return null;
	// 明らかにミリ秒らしい値 (例: 1,000〜120,000 = 1s〜2m)
	// 秒として該当しうる値においてもミリ秒換算されてしまう。
	if (raw > 1000 && raw < 120 * 1000) {
		return Math.round(raw / 1000);
	}
	return Math.round(raw);
}

/**
 * Request media library permissions
 */
async function requestPermissions(source: "library" | "camera"): Promise<boolean> {
	if (Platform.OS === "web") {
		return true; // Web doesn't need permission
	}

	// #1375 4 巡目: カメラ起動（その場で撮って記録する導線）はカメラ権限を取る
	const { status } =
		source === "camera"
			? await ImagePicker.requestCameraPermissionsAsync()
			: await ImagePicker.requestMediaLibraryPermissionsAsync();
	return status === "granted";
}

/**
 * Generate thumbnail for video
 * Uses 0.1s to avoid black frames at the start
 */
async function generateVideoThumbnail(uri: string): Promise<string | null> {
	try {
		if (Platform.OS === "web") {
			// For web, create a thumbnail using video element and canvas
			return new Promise((resolve) => {
				const video = document.createElement("video");
				video.src = uri;
				video.currentTime = 0.1; // Seek to 0.1s to avoid black frame
				video.muted = true;
				video.playsInline = true;

				video.addEventListener("loadeddata", () => {
					try {
						const canvas = document.createElement("canvas");
						canvas.width = video.videoWidth;
						canvas.height = video.videoHeight;
						const ctx = canvas.getContext("2d");
						if (ctx) {
							ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
							const dataURL = canvas.toDataURL("image/jpeg", 0.8);
							resolve(dataURL);
						} else {
							resolve(null);
						}
					} catch (error) {
						console.error("Error generating web thumbnail:", error);
						resolve(null);
					} finally {
						video.remove();
					}
				});

				video.addEventListener("error", () => {
					video.remove();
					resolve(null);
				});

				video.load();
			});
		} else {
			// For native platforms, use expo-video-thumbnails
			const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(uri, {
				time: 100, // 100ms to avoid black frame
			});
			return thumbnailUri;
		}
	} catch (error) {
		console.error("Error generating thumbnail:", error);
		return null;
	}
}

/**
 * Get video duration in seconds
 */
async function getVideoDuration(uri: string): Promise<number | null> {
	try {
		if (Platform.OS === "web") {
			return new Promise((resolve) => {
				const video = document.createElement("video");
				video.src = uri;
				video.muted = true;
				video.playsInline = true;

				video.addEventListener("loadedmetadata", () => {
					const duration = video.duration;
					video.remove();
					resolve(duration);
				});

				video.addEventListener("error", () => {
					video.remove();
					resolve(null);
				});

				video.load();
			});
		}
		// For native, duration is already in the picker result
		return null;
	} catch (error) {
		console.error("Error getting video duration:", error);
		return null;
	}
}

/**
 * #1750 «いま開いているピッカーは、どの画面のためのものか» を端末へ残すキー。
 *
 * Android の保留結果（`getPendingResultAsync`）は **持ち主を持たない**。
 * 印を付けずに拾うと、料理写真として選んだものが、あとで開いたプロフィール編集へ
 * «選んだ画像» として入り込む。プロセスごと殺されるのがこの機能の前提なので、
 * 印はメモリではなく端末（AsyncStorage）へ置く必要がある。
 */
const PENDING_PICKER_OWNER_KEY = "mediaSelection.pendingPickerOwner";

const setPendingPickerOwner = async (owner: string | null): Promise<void> => {
	if (Platform.OS !== "android") return;
	try {
		if (owner === null) await AsyncStorage.removeItem(PENDING_PICKER_OWNER_KEY);
		else await AsyncStorage.setItem(PENDING_PICKER_OWNER_KEY, owner);
	} catch {
		// 印が残せなくても «復帰できない» だけで、通常の選択は壊れない。握り潰す
	}
};

/**
 * Launch media picker and handle media selection
 * Returns media data with thumbnail for videos
 */
export async function selectMedia(
	mediaTypes: ImagePicker.MediaType[],
	options?: {
		shouldGenerateThumbnail?: boolean;
		allowsEditing?: boolean;
		aspect?: [number, number];
		/**
		 * #1375 4 巡目: `"camera"` はフォトライブラリではなく **カメラを起動してその場で撮る**。
		 * web はカメラ起動をサポートしないのでライブラリへ縮退する。既定は `"library"`
		 */
		source?: "library" | "camera";
		/**
		 * #1750 Android で «アプリが殺されたときに、この選択を誰が拾ってよいか» を表す名前。
		 * 渡した画面だけが `recoverPendingMedia({ owner })` で復帰できる。
		 * 省略すると印を残さない ＝ 復帰の対象にならない（従来どおりの挙動）。
		 */
		pendingOwner?: string;
	},
): Promise<MediaSelectionResult> {
	try {
		// #1031 B6 【設計】E2E(Detox) 実行時のみ、OS のフォトピッカーを開かず固定画像を返す。
		// ピッカーはアプリ外プロセスで動くため Detox から操作できず、レビュー投稿フローが自動化できない。
		// 通常ビルドでは metro.config.js の resolver が noop 実装へ差し替えるため、この行は常に
		// null を返して素通りする（本番バンドルには差し替えコード自体が入らない）。
		const e2eMedia = await selectMediaForE2E();
		if (e2eMedia) {
			return { success: true, media: e2eMedia };
		}

		// web にはカメラ起動が無いのでライブラリへ縮退する
		const source = options?.source === "camera" && Platform.OS !== "web" ? "camera" : "library";

		// Request permissions
		const hasPermission = await requestPermissions(source);
		if (!hasPermission) {
			return {
				success: false,
				error: "permission_denied",
			};
		}

		const pickerOptions: ImagePicker.ImagePickerOptions = {
			mediaTypes,
			allowsMultipleSelection: false,
			quality: 1,
			videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
			allowsEditing: options?.allowsEditing,
			aspect: options?.aspect,
			// #1156 【バグ】既定の `Automatic` だと、iOS は端末が撮った写真を **HEIC のまま**返す。
			//
			// HEIC は API 側の EXTENSION_TABLE（api/src/core/storage/storage.utils.ts）に無いため
			// `getExt()` が "bin" を返し、`....bin` という名前で GCS へ上がる。アップロード自体は
			// 200 で成功するので UI 上は成功したように見えるが、後段の resize（sharp → webp）が
			// デコードできず `media_processing_status = "failed"` になり、フィードには
			// 「このメディアは現在ご利用いただけません」とだけ表示される。
			//
			// 実測（dev の frontend_event_logs, 2026-08-07 17:55:48）:
			//   mimeType "image/heic" / objectPath ".../image-heic/..._media.bin"
			// 同日 17:38 の "image/jpeg" は ".jpg" で正常に処理されている。
			//
			// `Compatible` は PHPickerConfigurationAssetRepresentationMode.compatible へ直接マップされ、
			// 「最も互換性の高い表現」＝ 画像なら JPEG へ変換して返す。iOS 14+ 専用オプションで、
			// Android / Web では無視されるため分岐は要らない。
			//
			// ⚠️ 画像限定にはできない。バグを踏んだのはレビュー投稿の
			// `selectMedia(["images", "videos"])`（features/map/components/ReviewForm.tsx）なので、
			// 動画を含む呼び出しにも効かせないと直らない。その結果 **動画側の表現も変わる**
			// （HEVC ではなく互換表現が返りうる）が、動画の MIME は video/mp4・video/quicktime とも
			// EXTENSION_TABLE にあり、どちらでも壊れないため許容する。
			preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
		};

		// #1750 ピッカーを開く «前» に印を置く。開いたあとでは、殺されるのが先になりうる
		if (options?.pendingOwner) await setPendingPickerOwner(options.pendingOwner);

		// Launch picker（camera はその場で撮影。以降の検証・サムネ生成は共通）
		const result =
			source === "camera"
				? await ImagePicker.launchCameraAsync(pickerOptions)
				: await ImagePicker.launchImageLibraryAsync(pickerOptions);

		// ここへ来た ＝ 殺されずに戻れた。保留結果は無いので印も要らない
		if (options?.pendingOwner) await setPendingPickerOwner(null);

		return await toMediaSelectionResult(result, options);
	} catch (error) {
		console.error("Error selecting media:", error);
		return {
			success: false,
			error: "unknown",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * ピッカーの結果（`launchImageLibraryAsync` / `launchCameraAsync` / `getPendingResultAsync`）を
 * このアプリの `MediaSelectionResult` へ落とす。
 *
 * #1750 `selectMedia` の中身から切り出したもの。**Android の «復帰» 経路
 * （`recoverPendingMedia`）が通常経路とまったく同じ検証を通る**ようにするために共通化してある。
 * 片方だけ HEIC 判定や動画の長さ検証を持つ状態にしないこと。
 */
async function toMediaSelectionResult(
	result: ImagePicker.ImagePickerResult,
	options?: { shouldGenerateThumbnail?: boolean },
): Promise<MediaSelectionResult> {
	if (result.canceled) {
		return { success: false, error: "cancelled" };
	}

	const asset = result.assets?.[0];
	if (!asset) {
		return { success: false, error: "unknown" };
	}

	// #1425 【バグ】サーバが HEIC をデコードできないので、選ばせた時点で断る。
	//
	// #1156 の `preferredAssetRepresentationMode: Compatible` は **iOS 限定**で、
	// Android と web では無視される。Samsung / Pixel の「高効率」設定は HEIC で保存するため、
	// Android のフォトピッカーは HEIC をそのまま返しうる。
	//
	// ここで断らないと «アップロードは 200 で成功 → 投稿後に静かに failed» になり、
	// フィードには「このメディアは現在ご利用いただけません」とだけ出る。
	// サーバ側（#1425）は恒久失敗として畳むだけで、画像が見えるようにはならない。
	if (!isVideoAsset(asset) && isUnsupportedImageAsset(asset)) {
		return { success: false, error: "unsupported_image_format" };
	}

	const isVideo = isVideoAsset(asset);

	// Check video duration
	let durationSec: number | null = null;
	if (isVideo) {
		// iOS: ms のことが多い。Web は別関数で取得。Android は秒のことが多い。
		durationSec = normalizeToSeconds(asset.duration);
		// For web, we need to get duration manually
		if (Platform.OS === "web" && !durationSec) {
			durationSec = normalizeToSeconds(await getVideoDuration(asset.uri));
		}
		if (durationSec && durationSec > MAX_VIDEO_DURATION_SECONDS) {
			return { success: false, error: "video_too_long" };
		}
	}

	// ---- サムネ生成 ----
	let thumbnailUri: string | undefined;
	if (options?.shouldGenerateThumbnail && isVideo) {
		const thumbnail = await generateVideoThumbnail(asset.uri);
		if (!thumbnail) {
			return {
				success: false,
				error: "thumbnail_failed",
			};
		}
		thumbnailUri = thumbnail;
	}

	const media: MediaData = {
		type: isVideo ? "video" : "image",
		uri: asset.uri,
		width: asset.width,
		height: asset.height,
		durationSec: isVideo && durationSec ? durationSec : undefined,
		thumbnailUri: isVideo ? thumbnailUri : undefined,
		mimeType: resolveMimeType(asset),
	};

	return {
		success: true,
		media,
	};
}

/**
 * #1750 【バグ】**Android は、ピッカーを開いている間にアプリの MainActivity を殺すことがある。**
 *
 * これが起きると `launchImageLibraryAsync()` の Promise は **解決も棄却もしない**。
 * 呼び出し元から見ると「ユーザーは画像を選んだのに、`onSelectImage` が一度も呼ばれない」
 * ＝ 何のエラーも出ないまま選択が消える、という形になる。プロフィール編集ではこれが
 * 「画像を選んで保存しても上がらない」として観測されていた（本番・dev とも
 * `CreateSignedUrl(baseFileName=user-avatar)` が 1 件も出ていない実機セッションがある）。
 *
 * expo-image-picker はこのために `getPendingResultAsync()` を用意している
 * （公式ドキュメントの «Make sure that you handle MainActivity destruction on Android»）。
 * **アプリが作り直されたあとに 1 度呼ぶと、失われた選択結果を取り戻せる。**
 * このリポジトリはこれまでどこからも呼んでいなかった。
 *
 * ⚠️ 保留結果は «どの画面のためのものか» を持たない。取りに行ってよいのは
 * **ピッカーを開いた当の画面が復帰したときだけ**である。アプリ起動時にまとめて拾うと、
 * 料理写真として選んだものがアバターに入るような取り違えが起きる。
 *
 * 開発者オプションの「アクティビティを保持しない」を ON にすると再現できる。
 *
 * @returns 取り戻せた選択結果。復帰対象が無い / Android 以外なら `null`
 */
export async function recoverPendingMedia(options: {
	/**
	 * `selectMedia({ pendingOwner })` に渡したのと同じ名前。
	 * 端末に残っている印と一致したときだけ拾う（一致しなければ他画面のものなので触らない）。
	 */
	owner: string;
	shouldGenerateThumbnail?: boolean;
}): Promise<MediaSelectionResult | null> {
	if (Platform.OS !== "android") return null;

	try {
		let storedOwner: string | null = null;
		try {
			storedOwner = await AsyncStorage.getItem(PENDING_PICKER_OWNER_KEY);
		} catch {
			return null;
		}
		if (storedOwner !== options.owner) return null;

		// 印は «拾おうとした» 時点で外す。残すと、復帰に失敗したあとも同じ画面が
		// 毎回取りに行くことになる（getPendingResultAsync 自体は 1 度で空になる）
		await setPendingPickerOwner(null);

		const pending = await ImagePicker.getPendingResultAsync();
		if (!pending) return null;

		// ImagePickerErrorResult（`code` を持つ）は復帰できなかった側。握り潰さずに返す
		if ("code" in pending) {
			return {
				success: false,
				error: "unknown",
				errorMessage: `pending_result_error: ${pending.code}`,
			};
		}

		return await toMediaSelectionResult(pending, options);
	} catch (error) {
		return {
			success: false,
			error: "unknown",
			errorMessage: error instanceof Error ? error.message : String(error),
		};
	}
}
