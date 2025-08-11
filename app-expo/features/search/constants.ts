// Constants and option data for the search feature
import i18n from "@/lib/i18n";

export const timeSlots = [
	{ id: "morning", label: "Search.timeSlots.morning", icon: "🌅" },
	{ id: "lunch", label: "Search.timeSlots.lunch", icon: "🌞" },
	{ id: "dinner", label: "Search.timeSlots.dinner", icon: "🌙" },
	{ id: "late_night", label: "Search.timeSlots.lateNight", icon: "🌃" },
] as const;

export const sceneOptions = [
	{ id: "solo", label: "Search.sceneOptions.solo", icon: "👤" },
	{ id: "date", label: "Search.sceneOptions.date", icon: "💕" },
	{ id: "group", label: "Search.sceneOptions.group", icon: "👥" },
	{ id: "large_group", label: "Search.sceneOptions.largeGroup", icon: "👥👥" },
	{ id: "tourism", label: "Search.sceneOptions.tourism", icon: "🌍" },
] as const;

export const moodOptions = [
	{ id: "hearty", label: "Search.moodOptions.hearty", icon: "🍖" },
	{ id: "light", label: "Search.moodOptions.light", icon: "🥗" },
	{ id: "sweet", label: "Search.moodOptions.sweet", icon: "🍰" },
	{ id: "spicy", label: "Search.moodOptions.spicy", icon: "🌶️" },
	{ id: "healthy", label: "Search.moodOptions.healthy", icon: "🥬" },
	{ id: "junk", label: "Search.moodOptions.junk", icon: "🍔" },
	{ id: "alcohol", label: "Search.moodOptions.alcohol", icon: "🍺" },
] as const;

// Distance options in meters
export const distanceOptions = [
	{ value: 100, label: i18n.t("Search.distanceLabels.100m") },
	{ value: 300, label: i18n.t("Search.distanceLabels.300m") },
	{ value: 500, label: i18n.t("Search.distanceLabels.500m") },
	{ value: 800, label: i18n.t("Search.distanceLabels.800m") },
	{ value: 1000, label: i18n.t("Search.distanceLabels.1km") },
	{ value: 2000, label: i18n.t("Search.distanceLabels.2km") },
	{ value: 3000, label: i18n.t("Search.distanceLabels.3km") },
	{ value: 5000, label: i18n.t("Search.distanceLabels.5km") },
	{ value: 10000, label: i18n.t("Search.distanceLabels.10km") },
	{ value: 15000, label: i18n.t("Search.distanceLabels.15km") },
	{ value: 20000, label: i18n.t("Search.distanceLabels.20km") },
];

// Price level options (Google Maps PriceLevel enum compliant, excluding FREE)
export const priceLevelOptions = [
	{ value: 2, label: "Search.priceLevels.inexpensive", icon: "💰" },
	{ value: 3, label: "Search.priceLevels.moderate", icon: "💰💰" },
	{ value: 4, label: "Search.priceLevels.expensive", icon: "💰💰💰" },
	{ value: 5, label: "Search.priceLevels.veryExpensive", icon: "💰💰💰💰" },
];

export const restrictionOptions = [
	{ id: "vegetarian", label: "Search.restrictionOptions.vegetarian", icon: "🌱" },
	{ id: "gluten_free", label: "Search.restrictionOptions.glutenFree", icon: "🌾" },
	{ id: "dairy_free", label: "Search.restrictionOptions.dairyFree", icon: "🥛" },
	{ id: "nut_allergy", label: "Search.restrictionOptions.nutAllergy", icon: "🥜" },
	{ id: "seafood_allergy", label: "Search.restrictionOptions.seafoodAllergy", icon: "🐟" },
	{ id: "halal", label: "Search.restrictionOptions.halal", icon: "🕌" },
];
