import { DishMediaEntry } from "@shared/api/v1/res";


export const getRestaurantImageUrl = (restaurant: DishMediaEntry["restaurant"]
    , size: keyof NonNullable<typeof restaurant["imageUrls"]>)
    : string | undefined => {
    return restaurant.imageUrls?.[size] || restaurant.imageSignedUrl || undefined;
}