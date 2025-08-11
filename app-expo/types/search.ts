import type { DishMediaEntry } from "@shared/api/v1/res";

export interface SearchLocation {
	latitude: number;
	longitude: number;
	address: string;
}

export interface SearchParams {
	location: string;
	timeSlot: "morning" | "lunch" | "afternoon" | "dinner" | "late_night";
	scene?: "solo" | "date" | "group" | "large_group" | "tourism";
	mood?: "hearty" | "light" | "sweet" | "spicy" | "healthy" | "junk" | "alcohol";
	restrictions: string[];
	distance: number; // meters
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
