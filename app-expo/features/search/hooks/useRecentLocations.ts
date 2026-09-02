import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import { isCanonicalAddress } from "@/lib/addressFormat";

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
			const stored = value ? (JSON.parse(value) as RecentLocation[]) : [];

			// #1196 【設計】読み出し時に address の形式を検査し、正規形式でないエントリは捨てる。
			//
			// 保存経路は「autocomplete で選択 → details API 成功」の 1 箇所だけで、details API は
			// 2025-08-21 以降ずっと正規形式("country:JP, ...")を返している。このキー(v1)の導入は
			// 2026-07-25 なので、理屈のうえでは壊れた値が保存されているはずはない。
			// ただし端末ローカルの値は一度壊れると**コードを直しても直らない**(サーバ側で救えない)。
			// キーのバージョンを上げると正常なエントリまで全消しになるため、
			// 「壊れたものだけを読み出し時に落とす」形で、事故時の自己修復性だけを確保する。
			const valid = Array.isArray(stored) ? stored.filter((entry) => isCanonicalAddress(entry?.address)) : [];

			setRecentLocations(valid);

			// 捨てた分は保存内容からも取り除き、以降の読み出しコストを増やさない
			if (Array.isArray(stored) && valid.length !== stored.length) {
				AsyncStorage.setItem(RECENT_LOCATIONS_STORAGE_KEY, JSON.stringify(valid)).catch((error) => {
					console.error("Failed to prune recent locations:", error);
				});
			}
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
