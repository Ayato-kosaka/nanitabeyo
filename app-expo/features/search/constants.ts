// Constants and option data for the search feature
export const timeSlots = [
	{ id: "morning", label: "朝食", icon: "🌅" },
	{ id: "lunch", label: "ランチ", icon: "🌞" },
	{ id: "dinner", label: "ディナー", icon: "🌙" },
	{ id: "late_night", label: "夜食", icon: "🌃" },
] as const;

export const sceneOptions = [
	{ id: "solo", label: "おひとり様", icon: "👤" },
	{ id: "date", label: "デート", icon: "💕" },
	{ id: "group", label: "複数人と", icon: "👥" },
	{ id: "large_group", label: "大人数", icon: "👥👥" },
	{ id: "tourism", label: "観光", icon: "🌍" },
] as const;

export const moodOptions = [
	{ id: "hearty", label: "がっつり", icon: "🍖" },
	{ id: "light", label: "軽めに", icon: "🥗" },
	{ id: "sweet", label: "甘いもの", icon: "🍰" },
	{ id: "spicy", label: "辛いもの", icon: "🌶️" },
	{ id: "healthy", label: "ヘルシー", icon: "🥬" },
	{ id: "junk", label: "ジャンク", icon: "🍔" },
	{ id: "alcohol", label: "お酒メイン", icon: "🍺" },
] as const;

// Distance options in meters
export const distanceOptions = [
	{ value: 100, label: "100m" },
	{ value: 300, label: "300m" },
	{ value: 500, label: "500m" },
	{ value: 800, label: "800m" },
	{ value: 1000, label: "1km" },
	{ value: 2000, label: "2km" },
	{ value: 3000, label: "3km" },
	{ value: 5000, label: "5km" },
	{ value: 10000, label: "10km" },
	{ value: 15000, label: "15km" },
	{ value: 20000, label: "20km" },
];

// Budget options in yen
export const budgetOptions = [
	{ value: null, label: "下限なし" },
	{ value: 1000, label: "1,000円" },
	{ value: 2000, label: "2,000円" },
	{ value: 3000, label: "3,000円" },
	{ value: 4000, label: "4,000円" },
	{ value: 5000, label: "5,000円" },
	{ value: 6000, label: "6,000円" },
	{ value: 7000, label: "7,000円" },
	{ value: 8000, label: "8,000円" },
	{ value: 9000, label: "9,000円" },
	{ value: 10000, label: "10,000円" },
	{ value: 15000, label: "15,000円" },
	{ value: 20000, label: "20,000円" },
	{ value: 30000, label: "30,000円" },
	{ value: 40000, label: "40,000円" },
	{ value: 50000, label: "50,000円" },
	{ value: 60000, label: "60,000円" },
	{ value: 80000, label: "80,000円" },
	{ value: 100000, label: "100,000円" },
	{ value: null, label: "上限なし" },
];

export const restrictionOptions = [
	{ id: "vegetarian", label: "ベジタリアン", icon: "🌱" },
	{ id: "gluten_free", label: "グルテンフリー", icon: "🌾" },
	{ id: "dairy_free", label: "乳製品不使用", icon: "🥛" },
	{ id: "nut_allergy", label: "ナッツアレルギー", icon: "🥜" },
	{ id: "seafood_allergy", label: "魚介アレルギー", icon: "🐟" },
	{ id: "halal", label: "ハラール", icon: "🕌" },
];
