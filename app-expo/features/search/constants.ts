// Constants and option data for the search feature
import i18n from "@/lib/i18n";
import type { TutorialPageConst } from "./components/TutorialBottomSheet";

export const timeSlots = [
	{ id: "morning", label: "Search.timeSlots.morning", icon: "🌅", image: require("./assets/timeSlots/morning.webp") },
	{ id: "lunch", label: "Search.timeSlots.lunch", icon: "🌞", image: require("./assets/timeSlots/lunch.webp") },
	{ id: "dinner", label: "Search.timeSlots.dinner", icon: "🌙", image: require("./assets/timeSlots/dinner.webp") },
	{
		id: "late_night",
		label: "Search.timeSlots.lateNight",
		icon: "🌃",
		image: require("./assets/timeSlots/late_night.webp"),
	},
] as const;

export const sceneOptions = [
	{ id: "solo", label: "Search.sceneOptions.solo", icon: "👤", image: require("./assets/scenes/solo.webp") },
	{ id: "date", label: "Search.sceneOptions.date", icon: "💕", image: require("./assets/scenes/date.webp") },
	{ id: "friends", label: "Search.sceneOptions.friends", icon: "👥", image: require("./assets/scenes/friends.webp") },
	{ id: "family", label: "Search.sceneOptions.family", icon: "👪", image: require("./assets/scenes/family.webp") },
	{
		id: "drinking",
		label: "Search.sceneOptions.drinking",
		icon: "🍻",
		image: require("./assets/scenes/drinking.webp"),
	},
] as const;

export const moodOptions = [
	{ id: "light", label: "Search.moodOptions.light", icon: "🥗" },
	{ id: "normal", label: "Search.moodOptions.normal", icon: "🍱" },
	{ id: "heavy", label: "Search.moodOptions.heavy", icon: "🍖" },
] as const;

export const tasteOptions = [
	{ id: "sweet", label: "Search.tasteOptions.sweet", icon: "🍰" },
	// { id: "spicy", label: "Search.tasteOptions.spicy", icon: "🌶️" },
	{ id: "healthy", label: "Search.tasteOptions.healthy", icon: "🥬" },
	{ id: "junk", label: "Search.tasteOptions.junk", icon: "🍔" },
] as const;

export const coreIngredientOptions = [
	{ id: "meat", label: "Search.coreIngredientOptions.meat", icon: "🍖" },
	{ id: "fish", label: "Search.coreIngredientOptions.fish", icon: "🐟" },
	{ id: "rice", label: "Search.coreIngredientOptions.rice", icon: "🍚" },
	{ id: "noodle", label: "Search.coreIngredientOptions.noodle", icon: "🍜" },
] as const;

export const foodStyleOptions = [
	...tasteOptions.map((option) => ({ ...option, featureType: "taste" as const })),
	...coreIngredientOptions.map((option) => ({ ...option, featureType: "core_ingredient" as const })),
] as const;

export const diningPaceOptions = [
	{ id: "quick", label: "Search.diningPaceOptions.quick", icon: "🐇" },
	{ id: "leisurely", label: "Search.diningPaceOptions.leisurely", icon: "🐢" },
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
	{ value: "PRICE_LEVEL_INEXPENSIVE", label: "Search.priceLevels.inexpensive", budgetIntent: "inexpensive" },
	{ value: "PRICE_LEVEL_MODERATE", label: "Search.priceLevels.moderate", budgetIntent: "moderate" },
	{ value: "PRICE_LEVEL_EXPENSIVE", label: "Search.priceLevels.expensive", budgetIntent: "expensive" },
	{ value: "PRICE_LEVEL_VERY_EXPENSIVE", label: "Search.priceLevels.veryExpensive", budgetIntent: "very_expensive" },
] as const;

export const budgetIntentToPriceLevel = Object.fromEntries(
	priceLevelOptions.map((option) => [option.budgetIntent, option.value]),
) as Record<(typeof priceLevelOptions)[number]["budgetIntent"], (typeof priceLevelOptions)[number]["value"]>;

export const priceLevelToBudgetIntent = Object.fromEntries(
	priceLevelOptions.map((option) => [option.value, option.budgetIntent]),
) as Record<(typeof priceLevelOptions)[number]["value"], (typeof priceLevelOptions)[number]["budgetIntent"]>;

export const allPriceLevelValues = priceLevelOptions.map((option) => option.value);

export const isNoPriceLevelsSelected = (priceLevels: string[]) => priceLevels.length === 0;

export const deriveBudgetIntentFromPriceLevels = (selectedPriceLevels: string[]) => {
	if (selectedPriceLevels.length === 0 || selectedPriceLevels.length === allPriceLevelValues.length) return undefined;

	return selectedPriceLevels
		.map((priceLevel) => priceLevelToBudgetIntent[priceLevel as keyof typeof priceLevelToBudgetIntent])
		.filter((budgetIntent): budgetIntent is NonNullable<typeof budgetIntent> => !!budgetIntent);
};

export const restrictionOptions = [
	{ id: "vegetarian", label: "Search.restrictionOptions.vegetarian", icon: "🌱" },
	{ id: "gluten_free", label: "Search.restrictionOptions.glutenFree", icon: "🌾" },
	{ id: "dairy_free", label: "Search.restrictionOptions.dairyFree", icon: "🥛" },
	{ id: "nut_allergy", label: "Search.restrictionOptions.nutAllergy", icon: "🥜" },
	{ id: "seafood_allergy", label: "Search.restrictionOptions.seafoodAllergy", icon: "🐟" },
	{ id: "halal", label: "Search.restrictionOptions.halal", icon: "🕌" },
];

// #667 【設計】ムード用の円形アイコンサイズ（小・中・大）
export const MOOD_ICON_SIZES = {
	light: 20,
	normal: 30,
	heavy: 40,
} as const;

export const TUTORIAL_PAGES = [
	{
		image: require("@/assets/images/tutorial/search-page1.webp"),
		titleKey: "Search.tutorial.page1.title",
		bodyLineKeys: ["Search.tutorial.page1.body1", "Search.tutorial.page1.body2"],
		primaryCtaLabelKey: "Search.tutorial.page1.cta",
	},
	{
		image: require("@/assets/images/tutorial/search-page2.webp"),
		titleKey: "Search.tutorial.page2.title",
		bodyLineKeys: ["Search.tutorial.page2.body1", "Search.tutorial.page2.body2"],
		primaryCtaLabelKey: "Search.tutorial.page2.cta",
	},
	{
		image: require("@/assets/images/tutorial/search-page3.webp"),
		titleKey: "Search.tutorial.page3.title",
		bodyLineKeys: ["Search.tutorial.page3.body1", "Search.tutorial.page3.body2"],
		primaryCtaLabelKey: "Search.tutorial.page3.cta",
	},
	{
		image: require("@/assets/images/tutorial/search-page4.webp"),
		titleKey: "Search.tutorial.page4.title",
		bodyLineKeys: ["Search.tutorial.page4.body1", "Search.tutorial.page4.body2"],
		primaryCtaLabelKey: "Search.tutorial.page4.primaryCta",
		secondaryCtaLabelKey: "Search.tutorial.page4.secondaryCta",
	},
] as const satisfies readonly TutorialPageConst[];

// 先読みする画像の配列
export const PRELOAD_IMAGES = [
	// 検索チュートリアル画像
	...TUTORIAL_PAGES.map((page) => page.image),
	// アプリアイコン画像
	require("@/assets/images/icon.webp"),
	// レビュー機能のヒーロー画像
	require("@/features/review/assets/review-hero.webp"),
	// Apple アイコン画像
	require("@/assets/images/logo_apple_icon.png"),
	// Google アイコン画像
	require("@/assets/images/logo_google_g_icon.png"),
];
