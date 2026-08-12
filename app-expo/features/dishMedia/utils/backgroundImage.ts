import type { NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

export const getDishMediaBackgroundImageUri = (entry: NormalizedDishMediaEntry) => {
	// external embedはWebView/iframe自身が描画する。canonical URLを画像preloadへ
	// 誤って渡さず、thumbnailがある場合だけ一覧・背面fallbackに利用する。
	if (entry.dish_media.renderType === "external_embed") {
		return entry.dish_media.thumbnailImageUrl || undefined;
	}
	const isVideo = entry.dish_media.media_type === "video";
	if (isVideo) return entry.dish_media.thumbnailImageUrl;
	return entry.dish_media.mediaUrl ?? entry.dish_media.thumbnailImageUrl;
};

export const getDishMediaBackgroundImageKey = (entry: NormalizedDishMediaEntry) => {
	const bgUri = getDishMediaBackgroundImageUri(entry);
	return bgUri ? `${entry.dish_media.id}::${bgUri}` : `${entry.dish_media.id}::`;
};
