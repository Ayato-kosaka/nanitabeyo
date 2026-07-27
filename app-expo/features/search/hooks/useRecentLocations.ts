import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationDetailsResponse } from "@shared/api/v1/res";

const RECENT_LOCATIONS_STORAGE_KEY = "recent_locations_v1";
const MAX_RECENT_LOCATIONS = 5;

/**
 * #953 【仕様】details API のレスポンスから viewport を除いたもの＋検索画面の表示用文字列。
 * SearchParams が要求する location/address/localLanguageCode/locationQuery とそのまま一致する形にし、
 * 再選択時に details API を呼び直さず SearchParams へ復元できるようにする。
 */
export type RecentLocation = Omit<LocationDetailsResponse, "viewport"> & {
	locationQuery: string;
};

/**
 * #953 【仕様】検索の起点になる地点は繰り返し使われることが多いが、毎回文字入力を要求すると
 * 再訪時のコストが高い。端末ローカル(AsyncStorage)に直近5件を保持し、地点未入力でのフォーカス時に
 * 候補として提示する。他端末との同期は対象外(設計議論で決定済み)。
 */
export function useRecentLocations() {
	const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const loadRecentLocations = useCallback(async () => {
		try {
			const value = await AsyncStorage.getItem(RECENT_LOCATIONS_STORAGE_KEY);
			setRecentLocations(value ? (JSON.parse(value) as RecentLocation[]) : []);
		} catch (error) {
			console.error("Failed to load recent locations:", error);
			setRecentLocations([]);
		} finally {
			setIsLoading(false);
		}
	}, []);

	// 新しい地点を先頭に追加する。同一地点(place_id相当の座標一致)は重複させず先頭へ移動し、
	// 最大件数を超えた分は古い順に切り捨てる。
	const addRecentLocation = useCallback(async (location: RecentLocation) => {
		try {
			setRecentLocations((current) => {
				const deduped = current.filter(
					(entry) =>
						entry.location.latitude !== location.location.latitude ||
						entry.location.longitude !== location.location.longitude,
				);
				const next = [location, ...deduped].slice(0, MAX_RECENT_LOCATIONS);
				AsyncStorage.setItem(RECENT_LOCATIONS_STORAGE_KEY, JSON.stringify(next)).catch((error) => {
					console.error("Failed to save recent locations:", error);
				});
				return next;
			});
		} catch (error) {
			console.error("Failed to add recent location:", error);
		}
	}, []);

	const clearRecentLocations = useCallback(async () => {
		try {
			await AsyncStorage.removeItem(RECENT_LOCATIONS_STORAGE_KEY);
			setRecentLocations([]);
		} catch (error) {
			console.error("Failed to clear recent locations:", error);
		}
	}, []);

	useEffect(() => {
		loadRecentLocations();
	}, [loadRecentLocations]);

	return {
		recentLocations,
		isLoading,
		addRecentLocation,
		clearRecentLocations,
	};
}
