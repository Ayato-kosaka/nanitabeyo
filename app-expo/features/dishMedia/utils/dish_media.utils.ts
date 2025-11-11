import { DishMediaEntry } from "@shared/api/v1/res";

/**
 * 指定された DishMediaEntry のメディアURLを取得する
 */
export const getDishMediaMediaUrl = (dishMedia: DishMediaEntry["dish_media"]): string => {
    return dishMedia.mediaUrls.xl || dishMedia.mediaUrl;
}

/**
 * 指定された DishMediaEntry のサムネイルURLを取得する
 */
export const getDishMediaThumbnailUrl = (dishMedia: DishMediaEntry["dish_media"]): string => {
    return dishMedia.thumbnailImageUrls.md || dishMedia.thumbnailImageUrl;
}
