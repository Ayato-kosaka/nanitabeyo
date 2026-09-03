/**
 * #633 【設計】DishMedia 検索条件から一意の entriesKey を生成するユーティリティ
 *
 * 同じ検索条件 = 同じ entriesKey となることで、以下を保証：
 * - 再フェッチの防止
 * - store 上書きの防止
 * - いいね等の UI 状態の保持
 */

/**
 * DishMedia 検索の entriesKey を生成する。
 *
 * @param categoryId - 料理カテゴリ ID
 * @param location - 緯度経度（小数点以下4桁に丸め = 約11m精度）または place_id
 * @param radius - 検索半径（メートル）
 * @param priceLevels - 価格帯の配列（順序は問わない）
 * @param languageCode - 検索言語コード
 * @param timeSlot - #288 選んだ時間帯（営業時間フィルタの入力になり結果が変わるため含める）
 * @returns 一意の entriesKey 文字列
 */
export function makeDishMediaEntriesKey(params: {
	categoryId: string;
	location:
		| {
				latitude: number;
				longitude: number;
		  }
		| { place_id: string };
	radius: number;
	priceLevels: string[];
	languageCode?: string;
	/** #817 端末言語でレビューの並びが変わるため、キーに含めないと言語切替で古い結果が残る */
	viewerLanguageCode?: string;
	/** #288 未指定なら timeSlot によるフィルタは行われない側と揃え、キーにも含めない扱いにする */
	timeSlot?: string;
}): string {
	const { categoryId, location, radius, priceLevels, languageCode, viewerLanguageCode, timeSlot } = params;

	// #633 【設計】location は緯度経度 or place_id で表現
	const locationKey =
		"place_id" in location
			? `pid:${location.place_id}`
			: `ll:${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;

	// #633 【設計】priceLevels はソートして一意性を保証（順序によらず同じキーになる）
	const sortedPriceLevels = [...priceLevels].sort();
	const priceLevelsKey = sortedPriceLevels.join(",");

	const languageCodeKey = languageCode ?? "default";
	const viewerLanguageKey = viewerLanguageCode ?? "default";
	const timeSlotKey = timeSlot ?? "none";

	// #633 【設計】各要素を | で結合（可読性とデバッグのため）
	return `cat:${categoryId}|loc:${locationKey}|r:${radius}|pr:${priceLevelsKey}|lang:${languageCodeKey}|vlang:${viewerLanguageKey}|ts:${timeSlotKey}`;
}
