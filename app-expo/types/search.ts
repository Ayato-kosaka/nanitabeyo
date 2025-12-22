import type { DishMediaEntry, LocationDetailsResponse } from "@shared/api/v1/res";

export type SearchParams = Omit<LocationDetailsResponse, "viewport"> & {
	timeSlot: "morning" | "lunch" | "afternoon" | "dinner" | "late_night";
	scene: "solo" | "date" | "friends" | "family" | "drinking";
	mood?: "light" | "normal" | "heavy";
	taste?: "sweet" | "spicy" | "healthy" | "junk" | "alcohol";
	distance: number; // meters
	priceLevels: string[]; // price levels
};

export interface Topic {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	dishItemsPromise: Promise<DishMediaEntry[]>;
	isHidden?: boolean;
}
