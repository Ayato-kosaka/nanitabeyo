
// ① レストラン系：ほぼ「外食としての目的地」
const EAT_IN_PATTERNS_SUFFIX = [
    '_restaurant',      // ほぼ全部の○○料理レストラン
];

const EAT_IN_EXACT = new Set<string>([
    'restaurant',
    'bar',
    'bar_and_grill',
    'pub',
    'wine_bar',
    'cafe',
    'coffee_shop',
    'tea_house',
    'diner',
    'food_court',
]);

// ② 軽食・スイーツ・カフェ的なお店（お好みでレストラン扱いにするか選べる）
const SNACK_AND_DESSERT_EXACT = new Set<string>([
    'bakery',
    'ice_cream_shop',
    'sandwich_shop',
    'bagel_shop',
    'donut_shop',
    'dessert_shop',
    'candy_store',
    'juice_shop',
    'cat_cafe',
    'dog_cafe',
    // など「Food and Drink」カテゴリ内の *_shop / cafe 系
]);

// ③ 物販中心（イートインではなく小売り・デリバリー寄り）
const FOOD_RETAIL_EXACT = new Set<string>([
    'grocery_store',
    'supermarket',
    'convenience_store',
    'food_store',
    'liquor_store',
    'asian_grocery_store',
    'butcher_shop',
]);

const FOOD_SERVICE_ONLY_EXACT = new Set<string>([
    'meal_delivery',
    'meal_takeaway',
    'food_delivery',  // Services カテゴリ
]);


type PlaceLike = {
    primaryType?: string | null;   // places.primaryType
    types?: string[] | null;       // places.types
};

function hasType(place: PlaceLike, predicate: (t: string) => boolean): boolean {
    if (place.primaryType && predicate(place.primaryType)) return true;
    if (place.types) {
        for (const t of place.types) {
            if (predicate(t)) return true;
        }
    }
    return false;
}

function isEatInRestaurantType(place: PlaceLike): boolean {
    return hasType(place, (t) => {
        // 1) *_restaurant の全部
        if (EAT_IN_PATTERNS_SUFFIX.some(suffix => t.endsWith(suffix))) return true;

        // 2) レストラン系・バー系・カフェ系などの正確マッチ
        if (EAT_IN_EXACT.has(t)) return true;

        return false;
    });
}

// 軽食・スイーツ・カフェ専門店もレストラン扱いにするならこれ
function isSnackOrDessertPlace(place: PlaceLike): boolean {
    return hasType(place, (t) => SNACK_AND_DESSERT_EXACT.has(t));
}

// 「外食に使える店」全般（カフェ・スイーツも含む）
export function isFoodAndDrinkPlaceForUser(place: PlaceLike): boolean {
    if (isEatInRestaurantType(place)) return true;
    if (isSnackOrDessertPlace(place)) return true;

    // 一部の borderline なタイプを含めるかどうかはお好みで
    // 例: night_club にもフードが出るケースがある
    if (hasType(place, (t) => t === 'night_club')) return true;

    return false;
}

// 「食品関連だが、スーパーなども含む」広い意味での food place
// function isAnyFoodRelatedPlace(place: PlaceLike): boolean {
//     if (isFoodAndDrinkPlaceForUser(place)) return true;

//     if (hasType(place, (t) => FOOD_RETAIL_EXACT.has(t))) return true;
//     if (hasType(place, (t) => FOOD_SERVICE_ONLY_EXACT.has(t))) return true;

//     // Table B の `food` がついていて、他にタイプがないケースも fallback として拾える
//     if (hasType(place, (t) => t === 'food')) return true;

//     return false;
// }
