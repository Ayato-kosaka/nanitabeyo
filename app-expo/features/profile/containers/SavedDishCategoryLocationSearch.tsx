import React, { useCallback } from "react";
import { router } from "expo-router";
import { LocationSearchForm } from "../components/LocationSearchForm";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useDishCategorySearch } from "@/features/dishCategories/hooks/useDishCategorySearch";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import type { LocationDetailsResponse } from "@shared/api/v1/res";
import type { SelectedLocation } from "@/features/search/hooks/useLocationField";
import { useRecentLocations } from "@/features/search/hooks/useRecentLocations";
import { makeDishMediaEntriesKey } from "@/features/dishMedia/utils/dishMediaEntriesKey";
import { DEFAULT_PRICE_LEVELS, DEFAULT_SEARCH_RADIUS } from "@/features/dishCategories/constants";

interface SavedDishCategoryLocationSearchProps {
	/** 検索対象の料理カテゴリ（`DishCategory.id`）。ルートのパラメータから渡る */
	dishCategoryId?: string;
	/**
	 * 検索対象の料理カテゴリの英語ラベル（`DishCategory.label_en`）。
	 *
	 * #1369 ストアから引かずパラメータで受け取るのは、この画面が «単独で» 着地しうるため
	 * （URL 直リンク / web のリロード）。`search-results.tsx` が entriesKey だけで成立するのと同じ形。
	 */
	dishCategoryLabelEn?: string;
}

/**
 * 📍 保存した料理カテゴリからの地点検索（画面の中身）。
 *
 * #1369 【設計】以前は `SavedDishCategoriesTab` の中の BlurModal だった。地点オートコンプリートを
 * BlurModal の中に置いていた «唯一の» 画面で、#528（候補をタップするとキーボードだけ閉じて
 * 選択が反応しない）の当事者でもある。ルートにするとモーダル側の KeyboardAvoidingView が
 * 消え、キーボードの管理は OS と `LocationAutocomplete` だけになる。
 *
 * ロジック（details を取りに行くか・「最近使った場所」への登録・entriesKey の作り分け）は
 * #1133 で `SavedDishCategoriesTab` が持っていたものをそのまま移設したもので、検証は
 * `SavedDishCategoryLocationSearch.test.tsx` にある。ここを触ったら必ずテストを一緒に見ること。
 */
export function SavedDishCategoryLocationSearch({ dishCategoryId, dishCategoryLabelEn }: SavedDishCategoryLocationSearchProps) {
	const { locale } = useLocale();
	const { logFrontendEvent } = useLogger();
	const { createDishItemsPromise } = useDishCategorySearch();
	const { getLocationDetails } = useLocationSearch();
	// #1133 【設計】「最近使った場所」への登録はここで行う。登録できるのは details が解決した後
	// (＝遷移後に走る getIds() の中)であり、その時点でフォーム側(useLocationField)は
	// 「地点を親へ渡す」責務を終えているため、フォームには置けない。
	// ストレージはホームと共有する(#953 の recent_locations_v1)ので、キーは増やさない。
	const { addRecentLocation } = useRecentLocations();

	const handleLocationSelect = useCallback(
		async (selected: SelectedLocation) => {
			// パラメータ無しでこの URL へ着地した場合（直リンク）。検索対象が決まらないので何もしない
			if (!dishCategoryId || !dishCategoryLabelEn) return;

			const { mediaIdsByKey, isLoadingByKey, upsertDishMediaEntries, updateMediaIdsByKeyAsync } =
				useDishMediaEntriesStore.getState();
			const entriesKey = makeDishMediaEntriesKey({
				categoryId: dishCategoryId,
				// #1133 【設計】経路によって手元にある情報が違うため、location キーを作り分ける。
				// サジェストは place_id しか持たず(緯度経度は details API を叩くまで不明)、
				// 現在地・最近使った場所は緯度経度だけを持ち place_id を持たない。
				// makeDishMediaEntriesKey(#633) は両形式を受けるので、ここで詰め替えは不要。
				// ⚠️ 結果として同じ地点でも経路が違えば別キーになる(`pid:` と `ll:`)。これは
				// ホーム(常に `ll:`)と保存料理(従来 `pid:`)の間に元からある非対称で、今回広げない。
				location:
					selected.kind === "prediction"
						? { place_id: selected.prediction.place_id }
						: {
								latitude: selected.location.location.latitude,
								longitude: selected.location.location.longitude,
							},
				radius: DEFAULT_SEARCH_RADIUS,
				priceLevels: [...DEFAULT_PRICE_LEVELS],
				// #817 端末言語でレビューの並びが変わるためキーに含める
				viewerLanguageCode: locale,
			});

			if (mediaIdsByKey[entriesKey] === undefined && !isLoadingByKey[entriesKey]) {
				const getIds = async () => {
					// #1133 サジェスト経由だけ details を取りに行く。現在地・最近使った場所は緯度経度が
					// 確定済みなので、遷移前にも遷移後にも API 待ちを増やさない。
					let locationDetails: Omit<LocationDetailsResponse, "viewport">;
					if (selected.kind === "prediction") {
						const details = await getLocationDetails(selected.prediction);
						// #1133 【仕様】details が取れて初めて緯度経度が判るので、ここで初めて登録できる。
						// viewport はスプレッドすると型上は Omit していても実行時に残るため明示的に除く。
						// 最近使った場所経由は既にリストにあり、MRU の先頭移動(#1129)は useLocationField 側が担う。
						const { viewport: _viewport, ...locationWithoutViewport } = details;
						addRecentLocation({ ...locationWithoutViewport, locationQuery: selected.locationQuery });
						locationDetails = locationWithoutViewport;
					} else {
						locationDetails = selected.location;
					}

					const dishItems = await createDishItemsPromise(
						dishCategoryId,
						dishCategoryLabelEn,
						locationDetails.location.latitude,
						locationDetails.location.longitude,
						locationDetails.localLanguageCode,
					);
					upsertDishMediaEntries(dishItems);
					return dishItems.map((item) => String(item.dish_media.id));
				};
				updateMediaIdsByKeyAsync(entriesKey, getIds(), (_, ids) => ids);
			}

			// #1133 【既知の制約】getIds() は entriesKey が未取得のときしか走らないため、
			// 同じカテゴリ×同じ地点で 2 回目に検索したときは「最近使った場所」への登録が起きない。
			// 解消には遷移前に getLocationDetails を await する必要があり、この画面に
			// ローディングとエラー処理を新設することになるため今回は採らない(別 Issue)。

			// #1369 【バグ】ここは `replace` にしないこと。上の getIds() は details の解決後に
			// `addRecentLocation` を呼ぶが、その実体は `setRecentLocations` の updater の中で
			// AsyncStorage へ書く形（features/search/hooks/useRecentLocations.ts）。
			// unmount 済みのコンポーネントの setState は React が捨てる ＝ updater ごと走らないため、
			// replace でこの画面を消すと «サジェストで選んだ地点が履歴に積まれない» という
			// 静かな退行になる（モーダル時代は SavedDishCategoriesTab が残り続けていたので起きなかった）。
			// push なら遷移後もこの画面はスタックに残り、従来と同じ寿命になる。
			router.push({
				pathname: "/[locale]/(tabs)/profile/search-results",
				params: {
					locale,
					entriesKey,
				},
			});

			logFrontendEvent({
				event_name: "saved_topic_location_selected",
				error_level: "log",
				payload: {
					dishCategoryId,
					location: selected.locationQuery,
					categoryId: dishCategoryId,
					// #1133 どの経路で地点が決まったかを出所として残す(サジェスト / 現在地・最近使った場所)
					source: selected.kind,
				},
			});
		},
		[dishCategoryId, dishCategoryLabelEn, createDishItemsPromise, locale, logFrontendEvent, getLocationDetails, addRecentLocation],
	);

	return (
		// 見出しは画面の ScreenHeader が持つので、フォーム側の見出しは描かせない（同じ文言の二重表示を避ける）
		<LocationSearchForm onSubmit={handleLocationSelect} title={null} testID="saved-dish-category-location-search" />
	);
}
