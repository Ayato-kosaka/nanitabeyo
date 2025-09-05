// This is an example file showing how to use the restaurant and user-uploads APIs
// following the existing pattern in nanitabeyo app.
// DO NOT import this file - it's for reference only.

import React, { useCallback, useEffect, useState } from "react";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/features/profile/hooks/useCursorPagination";
import type {
	QueryRestaurantsDto,
	CreateRestaurantDto,
	QueryRestaurantDishMediaDto,
	QueryRestaurantsByGooglePlaceIdDto,
	CreateUserUploadSignedUrlDto,
} from "@shared/api/v1/dto";
import type {
	QueryRestaurantsResponse,
	CreateRestaurantResponse,
	QueryRestaurantDishMediaResponse,
	QueryRestaurantsByGooglePlaceIdResponse,
	CreateUserUploadSignedUrlResponse,
} from "@shared/api/v1/res";

/**
 * Example 1: Restaurant Search with Direct API Call
 * Use this pattern in map components or restaurant search screens
 */
export function ExampleRestaurantSearch() {
	const { callBackend } = useAPICall();
	const [restaurants, setRestaurants] = useState<QueryRestaurantsResponse>([]);
	const [isLoading, setIsLoading] = useState(false);

	const searchNearbyRestaurants = useCallback(
		async (lat: number, lng: number, radius: number) => {
			setIsLoading(true);
			try {
				const results = await callBackend<QueryRestaurantsDto, QueryRestaurantsResponse>(
					"v1/restaurants/search",
					{
						method: "GET",
						requestPayload: { lat, lng, radius, limit: 20 },
					},
				);
				setRestaurants(results);
			} catch (error) {
				console.error("Failed to search restaurants:", error);
			} finally {
				setIsLoading(false);
			}
		},
		[callBackend],
	);

	// Usage: searchNearbyRestaurants(35.6762, 139.6503, 1000);
	return null; // Example component
}

/**
 * Example 2: Create Restaurant from Google Place ID
 * Use this pattern when user selects a place from Google Places API
 */
export function ExampleCreateRestaurant() {
	const { callBackend } = useAPICall();

	const createRestaurant = useCallback(
		async (googlePlaceId: string) => {
			try {
				const restaurant = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>(
					"v1/restaurants",
					{
						method: "POST",
						requestPayload: { googlePlaceId },
					},
				);
				return restaurant;
			} catch (error) {
				console.error("Failed to create restaurant:", error);
				throw error;
			}
		},
		[callBackend],
	);

	// Usage: const restaurant = await createRestaurant("ChIJOwg_06VPwokRYv534QaPC8g");
	return null; // Example component
}

/**
 * Example 3: Get Restaurant by Google Place ID
 * Use this pattern to check if restaurant already exists
 */
export function ExampleGetRestaurantByPlaceId() {
	const { callBackend } = useAPICall();

	const getRestaurantByGooglePlaceId = useCallback(
		async (googlePlaceId: string) => {
			try {
				const restaurant = await callBackend<
					QueryRestaurantsByGooglePlaceIdDto,
					QueryRestaurantsByGooglePlaceIdResponse | null
				>("v1/restaurants/by-google-place-id", {
					method: "GET",
					requestPayload: { googlePlaceId },
				});
				return restaurant;
			} catch (error) {
				console.error("Failed to get restaurant:", error);
				return null;
			}
		},
		[callBackend],
	);

	// Usage: const restaurant = await getRestaurantByGooglePlaceId("ChIJOwg_06VPwokRYv534QaPC8g");
	return null; // Example component
}

/**
 * Example 4: Get Restaurant Dish Media with Pagination
 * Use this pattern in restaurant detail screens to show dish media
 * Following the same pattern as ReviewTab.tsx
 */
export function ExampleRestaurantDishMedia({ restaurantId }: { restaurantId: string }) {
	const { callBackend } = useAPICall();

	const { items, loadInitial, loadMore, refresh, error, isLoadingInitial, isLoadingMore } = useCursorPagination<
		QueryRestaurantDishMediaDto,
		QueryRestaurantDishMediaResponse["data"][number]
	>(
		useCallback(
			async ({ cursor }) => {
				const response = await callBackend<QueryRestaurantDishMediaDto, QueryRestaurantDishMediaResponse>(
					`v1/restaurants/${restaurantId}/dish-media`,
					{
						method: "GET",
						requestPayload: cursor ? { cursor } : {},
					},
				);
				return {
					data: response.data || [],
					nextCursor: response.nextCursor,
				};
			},
			[callBackend, restaurantId],
		),
	);

	useEffect(() => {
		loadInitial();
	}, []);

	// Use items, loadMore, refresh in your component
	return null; // Example component
}

/**
 * Example 5: File Upload with Signed URL
 * Use this pattern for uploading files to GCS
 */
export function ExampleFileUpload() {
	const { callBackend } = useAPICall();
	const [uploadProgress, setUploadProgress] = useState<number>(0);

	const uploadFile = useCallback(
		async (file: Blob | File, contentType: string, identifier: string) => {
			try {
				// 1. Get signed URL
				const signedUrlResponse = await callBackend<
					CreateUserUploadSignedUrlDto,
					CreateUserUploadSignedUrlResponse
				>("v1/user-uploads/signed-url", {
					method: "POST",
					requestPayload: { contentType, identifier },
				});

				// 2. Upload file to GCS using signed URL
				const xhr = new XMLHttpRequest();
				return new Promise<string>((resolve, reject) => {
					xhr.upload.addEventListener("progress", (event) => {
						if (event.lengthComputable) {
							const progress = (event.loaded / event.total) * 100;
							setUploadProgress(progress);
						}
					});

					xhr.addEventListener("load", () => {
						if (xhr.status >= 200 && xhr.status < 300) {
							setUploadProgress(100);
							resolve(signedUrlResponse.objectPath);
						} else {
							reject(new Error(`Upload failed with status: ${xhr.status}`));
						}
					});

					xhr.addEventListener("error", () => {
						reject(new Error("Network error during upload"));
					});

					xhr.open("PUT", signedUrlResponse.putUrl);
					xhr.setRequestHeader("Content-Type", contentType);
					xhr.send(file);
				});
			} catch (error) {
				console.error("Failed to upload file:", error);
				throw error;
			}
		},
		[callBackend],
	);

	// Usage: const objectPath = await uploadFile(fileBlob, "image/jpeg", "profile-photo");
	return null; // Example component
}

/**
 * Integration Tips:
 * 
 * 1. Use useAPICall() hook directly in components - don't create separate API hooks
 * 2. For paginated data, use useCursorPagination like in ReviewTab.tsx
 * 3. Handle loading states locally in components
 * 4. Use error boundaries or local error handling
 * 5. Follow existing patterns in features/profile/tabs/ for reference
 * 6. Store results in component state or context/store as needed
 * 7. Use existing UI components from components/ directory
 */