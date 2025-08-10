import type { DishMediaEntry } from "@shared/api/v1/res";

export interface SearchLocation {
	latitude: number;
	longitude: number;
	address: string;
}

export interface SearchParams {
	address: string;
	location: string; // Keep for bulk-import API compatibility "lat,lng" format
	timeSlot: "morning" | "lunch" | "afternoon" | "dinner" | "late_night";
	scene?: "solo" | "date" | "group" | "large_group" | "tourism";
	mood?: "hearty" | "light" | "sweet" | "spicy" | "healthy" | "junk" | "alcohol";
	restrictions: string[];
	distance: number; // Keep for bulk-import API compatibility (meters)
	budgetMin: number | undefined; // null for no minimum
	budgetMax: number | undefined; // null for no maximum
}

export interface Topic {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	dishItemsPromise: Promise<DishMediaEntry[]>;
	isHidden?: boolean;
}

export interface GooglePlacesPrediction {
	placeId: string;
	description: string;
	structured_formatting: {
		main_text: string;
		secondary_text: string;
	};
}
