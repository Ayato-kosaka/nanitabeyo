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
	{ id: "friends", label: "Search.sceneOptions.friends", icon: "👥" },
	{ id: "family", label: "Search.sceneOptions.family", icon: "👪" },
	{ id: "drinking", label: "Search.sceneOptions.drinking", icon: "🍻" },
] as const;

export const moodOptions = [
	{ id: "light", label: "Search.moodOptions.light", icon: "🥗" },
	{ id: "normal", label: "Search.moodOptions.normal", icon: "🍱" },
	{ id: "heavy", label: "Search.moodOptions.heavy", icon: "🍖" },
] as const;

export const tasteOptions = [
	{ id: "sweet", label: "Search.tasteOptions.sweet", icon: "🍰" },
	{ id: "spicy", label: "Search.tasteOptions.spicy", icon: "🌶️" },
	{ id: "healthy", label: "Search.tasteOptions.healthy", icon: "🥬" },
	{ id: "junk", label: "Search.tasteOptions.junk", icon: "🍔" },
	{ id: "alcohol", label: "Search.tasteOptions.alcohol", icon: "🍺" },
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
	{ value: "PRICE_LEVEL_INEXPENSIVE", label: "Search.priceLevels.inexpensive", icon: "💰" },
	{ value: "PRICE_LEVEL_MODERATE", label: "Search.priceLevels.moderate", icon: "💰💰" },
	{ value: "PRICE_LEVEL_EXPENSIVE", label: "Search.priceLevels.expensive", icon: "💰💰💰" },
	{ value: "PRICE_LEVEL_VERY_EXPENSIVE", label: "Search.priceLevels.veryExpensive", icon: "💰💰💰💰" },
] as const;

export const restrictionOptions = [
	{ id: "vegetarian", label: "Search.restrictionOptions.vegetarian", icon: "🌱" },
	{ id: "gluten_free", label: "Search.restrictionOptions.glutenFree", icon: "🌾" },
	{ id: "dairy_free", label: "Search.restrictionOptions.dairyFree", icon: "🥛" },
	{ id: "nut_allergy", label: "Search.restrictionOptions.nutAllergy", icon: "🥜" },
	{ id: "seafood_allergy", label: "Search.restrictionOptions.seafoodAllergy", icon: "🐟" },
	{ id: "halal", label: "Search.restrictionOptions.halal", icon: "🕌" },
];
