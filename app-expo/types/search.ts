import type { DishMediaEntry, LocationDetailsResponse } from "@shared/api/v1/res";

export type SearchParams = Omit<LocationDetailsResponse, "viewport"> & {
	timeSlot: "morning" | "lunch" | "afternoon" | "dinner" | "late_night";
	scene?: "solo" | "date" | "group" | "large_group" | "tourism";
	mood?: "hearty" | "light" | "sweet" | "spicy" | "healthy" | "junk" | "alcohol";
	restrictions: string[];
	distance: number; // meters
	priceLevels: number[]; // price levels [0,1,2,3,4]
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
