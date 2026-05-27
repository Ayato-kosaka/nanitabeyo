import type { NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

export const getDishMediaBackgroundImageUri = (entry: NormalizedDishMediaEntry) => {
	const isVideo = entry.dish_media.media_type === "video";
	if (isVideo) return entry.dish_media.thumbnailImageUrl;
	return entry.dish_media.mediaUrl ?? entry.dish_media.thumbnailImageUrl;
};

export const getDishMediaBackgroundImageKey = (entry: NormalizedDishMediaEntry) => {
	const bgUri = getDishMediaBackgroundImageUri(entry);
	return bgUri ? `${entry.dish_media.id}::${bgUri}` : `${entry.dish_media.id}::`;
};
