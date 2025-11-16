import type { LocationDetailsResponse } from "@shared/api/v1/res";

export type SearchParams = Omit<LocationDetailsResponse, "viewport"> & {
	timeSlot: "morning" | "lunch" | "afternoon" | "dinner" | "late_night";
	scene?: "solo" | "date" | "group" | "large_group" | "tourism";
	mood?: "hearty" | "light" | "sweet" | "spicy" | "healthy" | "junk" | "alcohol";
	restrictions: string[];
	distance: number; // meters
	priceLevels: string[]; // price levels
};

// #433 【設計】Topic 型は useTopicStore に移動（唯一のソースオブトゥルース）
export type { Topic } from "@/stores/useTopicStore";
