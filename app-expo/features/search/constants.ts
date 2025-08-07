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

// Budget options in yen
export const budgetOptions = [
        { value: null, label: "Search.labels.noMinBudget" },
        { value: 1000, label: `1,000${i18n.t("Search.currencySuffix")}` },
        { value: 2000, label: `2,000${i18n.t("Search.currencySuffix")}` },
        { value: 3000, label: `3,000${i18n.t("Search.currencySuffix")}` },
        { value: 4000, label: `4,000${i18n.t("Search.currencySuffix")}` },
        { value: 5000, label: `5,000${i18n.t("Search.currencySuffix")}` },
        { value: 6000, label: `6,000${i18n.t("Search.currencySuffix")}` },
        { value: 7000, label: `7,000${i18n.t("Search.currencySuffix")}` },
        { value: 8000, label: `8,000${i18n.t("Search.currencySuffix")}` },
        { value: 9000, label: `9,000${i18n.t("Search.currencySuffix")}` },
        { value: 10000, label: `10,000${i18n.t("Search.currencySuffix")}` },
        { value: 15000, label: `15,000${i18n.t("Search.currencySuffix")}` },
        { value: 20000, label: `20,000${i18n.t("Search.currencySuffix")}` },
        { value: 30000, label: `30,000${i18n.t("Search.currencySuffix")}` },
        { value: 40000, label: `40,000${i18n.t("Search.currencySuffix")}` },
        { value: 50000, label: `50,000${i18n.t("Search.currencySuffix")}` },
        { value: 60000, label: `60,000${i18n.t("Search.currencySuffix")}` },
        { value: 80000, label: `80,000${i18n.t("Search.currencySuffix")}` },
        { value: 100000, label: `100,000${i18n.t("Search.currencySuffix")}` },
        { value: null, label: "Search.labels.noMaxBudget" },
];

export const restrictionOptions = [
	{ id: "vegetarian", label: "Search.restrictionOptions.vegetarian", icon: "🌱" },
	{ id: "gluten_free", label: "Search.restrictionOptions.glutenFree", icon: "🌾" },
	{ id: "dairy_free", label: "Search.restrictionOptions.dairyFree", icon: "🥛" },
	{ id: "nut_allergy", label: "Search.restrictionOptions.nutAllergy", icon: "🥜" },
	{ id: "seafood_allergy", label: "Search.restrictionOptions.seafoodAllergy", icon: "🐟" },
	{ id: "halal", label: "Search.restrictionOptions.halal", icon: "🕌" },
];
