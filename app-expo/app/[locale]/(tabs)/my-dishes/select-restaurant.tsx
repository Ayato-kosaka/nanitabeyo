import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { View, StyleSheet, TouchableOpacity, InteractionManager } from "react-native";
import { Navigation, RotateCw } from "lucide-react-native";
import MapView, { Region } from "@/components/MapView";
import type { PoiClickEvent } from "react-native-maps";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useAPICall, type ApiError } from "@/hooks/useAPICall";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import {
	type AutocompleteLocation,
	type CreateRestaurantResponse,
	type QueryMeSavedRestaurantsResponse,
	type QueryRestaurantsResponse,
	ErrorCode,
} from "@shared/api/v1/res";
import type { CreateRestaurantDto, QueryRestaurantsDto, QuerySavedRestaurantsDto } from "@shared/api/v1/dto";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";
import { asApiList } from "@/lib/apiList";
import { useLogger } from "@/hooks/useLogger";
import MapViewClass from "react-native-maps";
import { isFoodAndDrinkPlaceForUser } from "@shared/utils/google_places_restaurant_type";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import {
	RestaurantClusterMarker,
	RestaurantPinMarker,
	type RestaurantPinCluster,
} from "@/features/restaurantPicker/components/RestaurantPinMarkers";
import {
	clusterMapPins,
	isSameClusterViewport,
	regionForCluster,
	type ClusterViewport,
} from "@/features/map/clustering";
import {
	MAX_PICKER_MARKERS,
	NEARBY_PIN_FETCH_LIMIT,
	PICKER_FETCH_DEBOUNCE_MS,
	SAVED_PIN_FETCH_LIMIT,
	pinDetailLevelForRegion,
	radiusForRegion,
	type RestaurantPin,
} from "@/features/restaurantPicker/mapPins";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import {
	SavedRestaurantsSheet,
	SavedRestaurantsSheetHandle,
} from "@/features/restaurantPicker/components/SavedRestaurantsSheet";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useRestaurantStore } from "@/stores/useRestaurantStore";
import { useLocale } from "@/hooks/useLocale";
import { ScreenHeader } from "@/components/ScreenHeader";
import { INITIAL_REGION, REGION_JP } from "@/features/map/constants";
import { usePickedRestaurantStore } from "@/features/restaurantPicker/stores/usePickedRestaurantStore";

type SavedRestaurant = QueryMeSavedRestaurantsResponse["data"][number];

/**
 * レビュー投稿画面のレストラン選択マップ画面
 * - 地図上のPOIタップ or 検索バーからレストラン選択でレストラン作成＆詳細画面へ遷移
 * - 保存したお店を地図上にマーカー表示、カード表示
 */
/*
#1629（オーナー指摘）**「このエリアで再検索が重い。ピンが出てる数もめっちゃ多い」。**

## 直す前に測ったこと

- 「このエリアで再検索」1 回で描くマーカー: **API が返した件数そのまま**。
  `limit` を渡していなかったのでサーバ既定の 20 件が効いており、
  クライアント側の `slice(0, 40)` は一度も働いていなかった（＝ 上限が無いのと同じで、
  サーバの既定値が変われば黙って増える）。**表示域の外のピンも全部マーカーにしていた。**
- viewport を動かしたときの API 回数: `onRegionChangeComplete` **1 回につき 1 本**。
  デバウンスが無く、飛んでいるリクエストのキャンセルも無い（応答を捨てるだけなので、
  サーバ側の集計クエリは全部走り切る）。
- radius: `max(latitudeDelta, longitudeDelta) * 50000` を 50km で頭打ち。下限は無し。
  （#1629 後半で頭打ちは撤廃した。理由は `mapPins.ts` の `radiusForRegion` を参照）

## どう変えたか（大手の地図アプリの標準的な作りへ）

1. 画面の外のピンはマーカーにしない（間引き）
2. 重なるピンは 1 つの «数字の丸» へ畳む（クラスタ。`features/map/clustering.ts` を共用）
3. 同時に描く数に上限を置く（`MAX_PICKER_MARKERS`）
4. 引きでは点、寄りで店名つき（`pinDetailLevelForRegion`）
5. viewport 変更はデバウンスし、前のリクエストは `AbortController` で止める

数字と切り替えの基準は `features/restaurantPicker/mapPins.ts` に置き、テストで固定してある。
*/

export default function SelectRestaurantScreen() {
	/**
	 * #1375（3 巡目）`?mode=pick` — «お店を 1 件選んで戻る» モード。
	 *
	 * 食べたを記録（sns-import の統合フォーム）と SNS 取り込みの「地図からお店を選ぶ」が使う。
	 * このモードでは店舗詳細やレビュー画面へ **push しない**（ネイティブスタックが
	 * どんどん積まれる、と実機で指摘された）。選んだ結果を `usePickedRestaurantStore` に
	 * 置いて `router.back()` するだけである。既定（mode 無し）の挙動は従来どおり
	 */
	const { mode } = useLocalSearchParams<{ mode?: string }>();
	const isPickMode = mode === "pick";
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { showSnackbar } = useSnackbar();
	const { locale, isJapanese } = useLocale();
	const navigation = useNavigation();
	const [searchQuery, setSearchQuery] = useState("");
	const [isLoadingRestaurantCreation, setIsLoadingRestaurantCreation] = useState(false);
	const { getLocationDetails, getCurrentLocation } = useLocationSearch();

	// #644 【設計】MapView のアニメーションを制御するための ref
	const mapRef = useRef<MapViewClass>(null);
	// 現在の地図の表示領域
	const currentRegion = useRef<Region>({
		latitude: 35.6762,
		longitude: 139.6503,
		latitudeDelta: 0.01,
		longitudeDelta: 0.01,
	});

	/*
	#1375（オーナー指示 8 巡目）**「お店を探す」ときは、保存したピンではなく
	アプリ内のお店データを、店名の文字付きで出す。**

	保存済みのピンだけが出ていたので、«まだ保存していない店を探す» という
	この画面本来の目的に対して、地図に何の手がかりも無かった。

	引くのは `GET /v1/restaurants/search`（**自前の restaurants テーブル**。
	Google Places は呼ばないので課金枠を消費しない — この endpoint 自身の申し送りにある）。

	⚠️ **上限を設ける。** マーカーは 1 個ごとにネイティブでビットマップになるので、
	無制限に置くと重くなり、低メモリ端末では落ちる（#1375 でマップ画面が実際に落ちた）。
	*/
	const [nearbyRestaurants, setNearbyRestaurants] = useState<QueryRestaurantsResponse>([]);

	/*
	#1629 **クラスタリングの単位になる表示域。**

	`onRegionChangeComplete` は指を離すたびに «新しいオブジェクト» を寄こす。そのまま
	state に入れると中身が同じでも参照が変わり、`useMemo` が外れて全マーカーが作り直される。
	`isSameClusterViewport` で «畳み方にも間引きにも影響しない変化» を吸収し、前の参照を保つ
	（判定の根拠は features/map/clustering.ts）。
	*/
	const [clusterViewport, setClusterViewport] = useState<ClusterViewport>(() => ({
		latitude: currentRegion.current.latitude,
		longitude: currentRegion.current.longitude,
		latitudeDelta: currentRegion.current.latitudeDelta,
		longitudeDelta: currentRegion.current.longitudeDelta,
	}));
	const updateClusterViewport = useCallback((region: Region) => {
		setClusterViewport((prev) =>
			isSameClusterViewport(prev, region)
				? prev
				: {
						latitude: region.latitude,
						longitude: region.longitude,
						latitudeDelta: region.latitudeDelta,
						longitudeDelta: region.longitudeDelta,
					},
		);
	}, []);

	/*
	#1629 **飛んでいる検索を止める / 連打の分をまとめる。**

	- `nearbyAbortRef`: 直前のリクエストの `AbortController`。新しい検索を始める前に必ず止める。
	  応答を捨てるだけ（旧実装の `requestId`）では、**サーバ側の集計クエリは全部走り切る**。
	- `nearbyDebounceRef`: 表示域の変化をまとめるタイマー。慣性スクロールの停止や
	  `animateToRegion` の着地でも `onRegionChangeComplete` は飛ぶので、
	  1 操作で複数本のリクエストが並んでいた。
	- `nearbyRequestRef`: 中断が間に合わなかった応答の追い越しを捨てる最後の砦（据え置き）。
	*/
	const nearbyRequestRef = useRef(0);
	const nearbyAbortRef = useRef<AbortController | null>(null);
	const nearbyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const fetchNearbyRestaurants = useCallback(
		async (region: Region) => {
			if (!isPickMode) return;
			// 前の検索はもう要らない。応答を待たずに止める
			nearbyAbortRef.current?.abort();
			const controller = new AbortController();
			nearbyAbortRef.current = controller;
			const requestId = ++nearbyRequestRef.current;
			try {
				const response = await callBackend<QueryRestaurantsDto, QueryRestaurantsResponse>("v1/restaurants/search", {
					method: "GET",
					requestPayload: {
						lat: region.latitude,
						lng: region.longitude,
						// 半径の決め方（見えている範囲の外接円 / 下限 200m）は mapPins.ts に理由付きで置いてある
						radius: radiusForRegion(region),
						/*
							  #1629 【修正】`limit` を明示する。渡していなかったのでサーバ既定の 20 件が
							  効いており、クライアント側の上限（旧 `slice(0, 40)`）は一度も働いていなかった。
							  取った件数をそのまま描くのではなく、**畳んでから** `MAX_PICKER_MARKERS` で切る。
							*/
						limit: NEARBY_PIN_FETCH_LIMIT,
					},
					signal: controller.signal,
				});
				// 追い越しを捨てる（指を離すたびに投げるので、古い応答が後から届きうる）
				if (requestId !== nearbyRequestRef.current) return;
				setNearbyRestaurants(asApiList(response));
			} catch (error) {
				// 自分で止めたものは «失敗» ではない。ログにも出さない
				if ((error as ApiError | undefined)?.code === "aborted") return;
				// 地図の手がかりが出ないだけなので、画面は止めない（スナックバーも出さない）
				logFrontendEvent({
					event_name: "nearby_restaurants_search_error",
					error_level: "warn",
					payload: { error },
				});
			} finally {
				if (nearbyAbortRef.current === controller) nearbyAbortRef.current = null;
			}
		},
		[callBackend, isPickMode, logFrontendEvent],
	);

	/**
	 * 表示域が変わったときの取得。**まとめてから 1 本だけ投げる。**
	 *
	 * ⚠️ ここを «即時» に戻さないこと。`onRegionChangeComplete` は 1 回の操作で複数回飛ぶ。
	 */
	const scheduleNearbyFetch = useCallback(
		(region: Region) => {
			if (!isPickMode) return;
			if (nearbyDebounceRef.current) clearTimeout(nearbyDebounceRef.current);
			nearbyDebounceRef.current = setTimeout(() => {
				nearbyDebounceRef.current = null;
				void fetchNearbyRestaurants(region);
			}, PICKER_FETCH_DEBOUNCE_MS);
		},
		[fetchNearbyRestaurants, isPickMode],
	);

	// 画面を離れるときに、待っているタイマーと飛んでいるリクエストを両方片付ける
	useEffect(
		() => () => {
			if (nearbyDebounceRef.current) clearTimeout(nearbyDebounceRef.current);
			nearbyAbortRef.current?.abort();
		},
		[],
	);

	const handleRegionChangeComplete = useCallback(
		(region: Region) => {
			currentRegion.current = region;
			// 畳み方・間引きの基準は «指を離したときの表示域»。pan 中に畳み直すと重く、ピンが動いて見える
			updateClusterViewport(region);
			scheduleNearbyFetch(region);
		},
		[scheduleNearbyFetch, updateClusterViewport],
	);

	// #644 【設計】レストラン作成＆詳細画面へ遷移する関数（ストアにキャッシュ→ナビゲーション）
	// #525 【設計】エラーハンドリングを整備し、422/404/network_error 等を適切にスナックバーで通知
	const createAndOpenRestaurant = useCallback(
		async (googlePlaceId: string) => {
			setIsLoadingRestaurantCreation(true);
			try {
				const response = await callBackend<CreateRestaurantDto, CreateRestaurantResponse>("v1/restaurants", {
					method: "POST",
					requestPayload: { googlePlaceId },
				});

				if (isPickMode) {
					// pick モード: 選択として返して戻るだけ。詳細画面へは行かない
					usePickedRestaurantStore.getState().setPicked({
						restaurantId: response.restaurant.id,
						name: response.restaurant.name,
						restaurant: response.restaurant,
					});
					router.back();
					return;
				}

				// #644 【設計】ストアに upsert してから詳細画面へ遷移
				const { upsert } = useRestaurantStore.getState();
				upsert({
					restaurant: response.restaurant,
					meta: response.meta,
				});

				router.push({
					pathname: "/[locale]/restaurant/[restaurantId]",
					params: { locale, restaurantId: response.restaurant.id },
				});
			} catch (rawError: unknown) {
				const error = rawError as ApiError;

				// 422 + PLACE_NOT_FOOD_AND_DRINK: レストランではない Place
				if (error.status === 422 && error.errorCode === ErrorCode.PLACE_NOT_FOOD_AND_DRINK) {
					showSnackbar(i18n.t("Map.errors.placeNotRestaurant"));
					return;
				}

				// 404: Place が見つからない
				if (error.status === 404) {
					showSnackbar(i18n.t("Map.errors.placeNotFound"));
					return;
				}

				// ネットワークエラー
				if (error.code === "network_error" || error.status === 0) {
					showSnackbar(i18n.t("Common.errors.network"));
				} else {
					// その他のエラー（http_error / api_error / invalid_response など）
					showSnackbar(i18n.t("Common.errors.unexpected"));
				}

				logFrontendEvent({
					event_name: "poi_press_error",
					error_level: "error",
					payload: { error, googlePlaceId },
				});
			} finally {
				setIsLoadingRestaurantCreation(false);
			}
		},
		[callBackend, isPickMode, logFrontendEvent, showSnackbar, locale],
	);

	// #644 【設計】POI押下時にレストラン情報を取得してモーダル表示
	const handlePoiPress = useCallback(
		async (event: PoiClickEvent) => {
			lightImpact();
			createAndOpenRestaurant(event.nativeEvent.placeId);
		},
		[createAndOpenRestaurant, lightImpact],
	);

	const handleCurrentLocation = useCallback(async () => {
		lightImpact();
		try {
			const { location } = await getCurrentLocation();
			const newRegion = {
				latitude: location.latitude,
				longitude: location.longitude,
				latitudeDelta: 0.01,
				longitudeDelta: 0.01,
			};
			currentRegion.current = newRegion;
			mapRef.current?.animateToRegion(newRegion, 1000);
		} catch (error) {
			logFrontendEvent({
				event_name: "MapCurrentLocationError",
				error_level: "error",
				payload: { error },
			});
		}
	}, [getCurrentLocation, lightImpact, logFrontendEvent]);

	// 画面フォーカスに連動して Sheet を開閉
	const [isSheetVisible, setIsSheetVisible] = useState(false);
	// 画面フォーカス状態を保持する ref
	const isFocusedRef = useRef(false);
	useFocusEffect(
		useCallback(() => {
			isFocusedRef.current = true;
			// #1375 実機確認（2 巡目）: 遷移アニメーションの最中に TrueSheet を present すると、
			// iOS でシートが **遷移前の画面の view controller に取り付く**ことがあり、
			// 「シートは見えているのにボタンが効かず、タップが背後の画面へ抜ける」状態になる
			// （実機で «モーダルのボタンが効かない» と指摘された症状）。
			// InteractionManager で遷移が終わってから present する
			const task = InteractionManager.runAfterInteractions(() => {
				if (isFocusedRef.current) setIsSheetVisible(true);
			});
			return () => {
				task.cancel();
				isFocusedRef.current = false;
				setIsSheetVisible(false);
			};
		}, []),
	);
	// #644 【設計】SavedRestaurantsSheet の ref
	const savedRestaurantsSheetRef = useRef<SavedRestaurantsSheetHandle>(null);
	useEffect(() => {
		const unsubscribe = navigation.addListener("beforeRemove", () => {
			// 戻り操作（ボタンでもスワイプでも）開始時に必ずシートを閉じる
			savedRestaurantsSheetRef.current?.dismiss();
			setIsSheetVisible(false);
		});

		return unsubscribe;
	}, [navigation]);

	// シート表示を安全に行う関数
	const safePresentSheet = useCallback(() => {
		if (!isFocusedRef.current) return;
		setIsSheetVisible(true);
	}, []);

	// #644 【設計】保存したお店の状態管理
	const [savedRestaurants, setSavedRestaurants] = useState<QueryMeSavedRestaurantsResponse["data"]>([]);
	const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);
	const [isLoadingSavedRestaurants, setIsLoadingSavedRestaurants] = useState(false);
	const isLoadingSavedRestaurantsRef = useRef(false);
	useEffect(() => {
		isLoadingSavedRestaurantsRef.current = isLoadingSavedRestaurants;
	}, [isLoadingSavedRestaurants]);

	// #644 【設計】保存したお店を現在地で検索
	const searchSavedRestaurants = useCallback(
		async (region: Region) => {
			if (isLoadingSavedRestaurantsRef.current) return;

			lightImpact();
			setIsLoadingSavedRestaurants(true);

			// 保存したお店の検索後に必ずシートを開く
			safePresentSheet();
			try {
				const response = await callBackend<QuerySavedRestaurantsDto, QueryMeSavedRestaurantsResponse>(
					"v1/users/me/saved-restaurants",
					{
						method: "GET",
						requestPayload: {
							lat: region.latitude,
							lng: region.longitude,
							// 半径の決め方（見えている範囲の外接円 / 下限 200m）とその経緯は mapPins.ts の radiusForRegion
							radius: radiusForRegion(region),
							limit: SAVED_PIN_FETCH_LIMIT,
						},
					},
				);

				// #1561 API が 200 で «data の無い本文» を返すと、次のレンダーの .map で
				// 画面ごと ErrorBoundary へ落ちていた（throw は try の外なので catch できない）
				setSavedRestaurants(asApiList(response.data));
				setActiveRestaurantId(null);
				// #1629 取り直した範囲でクラスタも畳み直す（地図は動いていないので通常は同じ参照が返る）
				updateClusterViewport(region);
			} catch (error) {
				showSnackbar(i18n.t("SelectRestaurant.fetchSavedRestaurantsError"));
				logFrontendEvent({
					event_name: "saved_restaurants_search_error",
					error_level: "error",
					payload: { error },
				});
			} finally {
				setIsLoadingSavedRestaurants(false);
			}
		},
		[callBackend, lightImpact, logFrontendEvent, showSnackbar, safePresentSheet, updateClusterViewport],
	);

	// #644 【設計】保存したお店のマーカー押下時の処理（ストア upsert → 遷移）
	/*
	#1375（オーナー指示 8 巡目）アプリ内のお店ピンを押したとき。

	**1 回目で選択、2 回目で確定**（保存済みピンと同じ作法）にする。
	いきなり確定すると、地図を触っていて指が当たっただけで記録の店が決まってしまう。
	*/
	/*
	#1629 **選択中の店舗は ref からも読む。**

	マーカーの `onPress` を `activeRestaurantId`（state）に依存させると、1 件選ぶたびに
	ハンドラの identity が変わり、**画面に出ている全マーカーへ新しい props が流れる**。
	View Marker はネイティブでビットマップになるので、そのたびに全部が焼き直しの対象になる。
	ハンドラは «押されたときに最新の選択を読む» 形にして、identity を固定する。
	*/
	const activeRestaurantIdRef = useRef<string | null>(null);
	useEffect(() => {
		activeRestaurantIdRef.current = activeRestaurantId;
	}, [activeRestaurantId]);

	const handleNearbyRestaurantMarkerPress = useCallback(
		(item: QueryRestaurantsResponse[number]) => {
			lightImpact();
			if (activeRestaurantIdRef.current === item.restaurant.id) {
				usePickedRestaurantStore.getState().setPicked({
					restaurantId: item.restaurant.id,
					name: item.restaurant.name,
					restaurant: item.restaurant,
				});
				router.back();
				return;
			}
			setActiveRestaurantId(item.restaurant.id);
		},
		[lightImpact],
	);

	const handleSavedRestaurantMarkerPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();

			// すでにアクティブなら確定（pick モードは選択して戻る / 通常は詳細画面へ）
			if (activeRestaurantIdRef.current === restaurant.restaurant.id) {
				if (isPickMode) {
					usePickedRestaurantStore.getState().setPicked({
						restaurantId: restaurant.restaurant.id,
						name: restaurant.restaurant.name,
						restaurant: restaurant.restaurant,
					});
					router.back();
					return;
				}
				// ストアに upsert
				const { upsert } = useRestaurantStore.getState();
				upsert({
					restaurant: restaurant.restaurant,
					meta: restaurant.meta,
				});

				router.push({
					pathname: "/[locale]/restaurant/[restaurantId]",
					params: { locale, restaurantId: restaurant.restaurant.id },
				});
				return;
			}

			// アクティブ更新（スクロールはシート側で active ID を監視して同期）
			setActiveRestaurantId(restaurant.restaurant.id);
		},
		[isPickMode, lightImpact, locale],
	);

	/**
	 * 地図のピンを押したときの唯一の入口。**identity を固定する**（上の申し送り参照）。
	 *
	 * pick モードは «アプリ内のお店»、それ以外は «保存したお店» を出しているので、
	 * どちらのピンかはモードで決まる。
	 */
	const handlePinPress = useCallback(
		(pin: RestaurantPin) => {
			if (isPickMode) {
				handleNearbyRestaurantMarkerPress(pin as QueryRestaurantsResponse[number]);
				return;
			}
			handleSavedRestaurantMarkerPress(pin as SavedRestaurant);
		},
		[handleNearbyRestaurantMarkerPress, handleSavedRestaurantMarkerPress, isPickMode],
	);

	/**
	 * 畳んだ丸を押したら «もう一段ほどく»。中のピンの外接矩形へ寄せる
	 * （my-dishes の Map と同じ作法。`regionForCluster`）。
	 */
	const handleClusterPress = useCallback(
		(cluster: RestaurantPinCluster) => {
			lightImpact();
			const region = regionForCluster(cluster);
			currentRegion.current = region;
			updateClusterViewport(region);
			mapRef.current?.animateToRegion(region, 400);
		},
		[lightImpact, updateClusterViewport],
	);

	// #644 【設計】保存したお店のカード押下時の処理（ボタン以外）（ストア upsert → 遷移）
	const handleSavedRestaurantCardPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();
			setActiveRestaurantId(restaurant.restaurant.id);

			if (isPickMode) {
				usePickedRestaurantStore.getState().setPicked({
					restaurantId: restaurant.restaurant.id,
					name: restaurant.restaurant.name,
					restaurant: restaurant.restaurant,
				});
				router.back();
				return;
			}

			// ストアに upsert
			const { upsert } = useRestaurantStore.getState();
			upsert({
				restaurant: restaurant.restaurant,
				meta: restaurant.meta,
			});

			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: restaurant.restaurant.id },
			});

			logFrontendEvent({
				event_name: "saved_restaurant_card_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[isPickMode, lightImpact, logFrontendEvent, locale],
	);

	// #644 【設計】保存したお店カードの「写真・動画を投稿」ボタン押下時の処理（ストア upsert → レビュー画面遷移）
	const handleSavedRestaurantReviewPress = useCallback(
		(restaurant: SavedRestaurant) => {
			lightImpact();

			// ストアに upsert
			const { upsert } = useRestaurantStore.getState();
			upsert({
				restaurant: restaurant.restaurant,
				meta: restaurant.meta,
			});

			// レビュー投稿画面へ直接遷移
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]/review",
				params: { locale, restaurantId: restaurant.restaurant.id },
			});

			logFrontendEvent({
				event_name: "saved_restaurant_review_button_press",
				error_level: "log",
				payload: { restaurant_id: restaurant.restaurant.id },
			});
		},
		[lightImpact, logFrontendEvent, locale],
	);

	// Map ready 後に pendingRegionRef に保存された region があれば移動させる
	const [mapReady, setMapReady] = useState(false);
	const pendingRegionRef = useRef<Region | null>(null);
	useEffect(() => {
		if (!mapReady) return;

		const region = pendingRegionRef.current;
		if (!region) return;

		mapRef.current?.animateToRegion(region, 1); // 1msで“delta含め確定”させる
		pendingRegionRef.current = null;
	}, [mapReady]);

	const initialRegion = useMemo<Region>(() => (isJapanese ? REGION_JP : INITIAL_REGION), [isJapanese]);
	const didInitRef = useRef(false);
	// 初期表示時の現在地取得＆保存店検索
	useEffect(() => {
		if (didInitRef.current) return;
		didInitRef.current = true;

		let cancelled = false;

		const init = async () => {
			logFrontendEvent({
				event_name: "screen_view",
				error_level: "log",
				payload: { screen: "review_select_restaurant" },
			});

			try {
				if (isJapanese) {
					pendingRegionRef.current = REGION_JP;
					currentRegion.current = REGION_JP;
					mapRef.current?.animateToRegion(REGION_JP, 1000);
					await searchSavedRestaurants(REGION_JP);
					return;
				}

				const { location } = await getCurrentLocation();
				if (cancelled) return;

				const newRegion = {
					latitude: location.latitude,
					longitude: location.longitude,
					latitudeDelta: 0.01,
					longitudeDelta: 0.01,
				};

				pendingRegionRef.current = newRegion;
				currentRegion.current = newRegion;
				mapRef.current?.animateToRegion(newRegion, 1000);
				await searchSavedRestaurants(newRegion);
			} catch (error) {
				if (cancelled) return;
				pendingRegionRef.current = REGION_JP;
				currentRegion.current = REGION_JP;
				mapRef.current?.animateToRegion(REGION_JP, 1000);
				await searchSavedRestaurants(REGION_JP);
			}
		};

		init();
		return () => {
			cancelled = true;
		};
	}, [getCurrentLocation, isJapanese, logFrontendEvent, searchSavedRestaurants]);

	// #644 【設計】オートコンプリート選択時の処理
	const handleAutocompleteSelect = useCallback(
		async (prediction: AutocompleteLocation) => {
			lightImpact();
			if (isFoodAndDrinkPlaceForUser(prediction)) {
				// 飲食店カテゴリの場合はレストラン作成＆詳細表示
				createAndOpenRestaurant(prediction.place_id);
			} else {
				// 一般の場所の場合は地図移動のみ
				try {
					const { location } = await getLocationDetails(prediction);
					const newRegion = {
						latitude: location.latitude,
						longitude: location.longitude,
						latitudeDelta: 0.01,
						longitudeDelta: 0.01,
					};
					currentRegion.current = newRegion;
					mapRef.current?.animateToRegion(newRegion, 1000);
					setSearchQuery("");
					// エリア選択時にそのエリアで保存したお店を検索
					searchSavedRestaurants(newRegion);
				} catch (error) {
					logFrontendEvent({
						event_name: "MapSearchError",
						error_level: "error",
						payload: { error, prediction },
					});
				}
			}
		},
		[createAndOpenRestaurant, getLocationDetails, lightImpact, logFrontendEvent, searchSavedRestaurants],
	);

	/*
	#1629 **地図に出すものを «取得した全件» から «いま見える範囲の、畳んだあとの上限内» へ変える。**

	直す前は、取得した配列をそのまま 1 件 1 マーカーで描いていた（下の 3 つが全部無かった）。

	  1. 間引き … 表示域の外のピンもマーカーにしていた
	  2. クラスタ … 重なって読めないピンがそのまま並んでいた
	  3. 上限 … 描く数に天井が無かった（サーバ既定の 20 件に暗黙に依存）

	`clusterMapPins` が 3 つをまとめて行う（features/map/clustering.ts）。畳む単位は
	**指を離したときの表示域**（`clusterViewport`）で、pan で毎フレーム畳み直さない。

	#1375（オーナー指示 8 巡目）**pick モードはアプリ内のお店（店名つき）を出す。**
	それ以外（この画面を単体で開く経路）は従来どおり «保存したお店» を出す。
	*/
	const pins = useMemo<RestaurantPin[]>(
		() => (isPickMode ? nearbyRestaurants : savedRestaurants),
		[isPickMode, nearbyRestaurants, savedRestaurants],
	);
	const clusters = useMemo(
		() => clusterMapPins(pins, clusterViewport, { maxRendered: MAX_PICKER_MARKERS }),
		[pins, clusterViewport],
	);
	/*
	引きでは «点»、寄りで «写真 + 店名»。ラベルは引くと重なって読めなくなるうえ、
	ビットマップだけが増える。大手の地図アプリと同じ切り替え（基準は mapPins.ts）。
	*/
	const pinDetail = useMemo(() => pinDetailLevelForRegion(clusterViewport), [clusterViewport]);

	/*
	#1375（実機: マップの重さ）**マーカー配列を memo で固定する。**

	素の `.map` だと、検索文字を 1 文字打つ・シートの開閉といった **マーカーと無関係な
	state 更新のたびに**、全マーカーへ新しい `coordinate`（毎回新しいオブジェクト）と
	新しい `onPress`（毎回新しい関数）が流れる。View Marker はネイティブでビットマップに
	なるので、props が変わるたびに焼き直しの対象になる。

	#1629 それでも `activeRestaurantId` が変わると配列は作り直される（依存に入っているため）。
	**要になるのは «作り直された要素の props が前と同じ参照か» の方**である。
	座標オブジェクトと onPress のクロージャは `RestaurantPinMarker` の内側で作るので、
	選択が変わっても props が実際に変わるのは «選択が外れた 1 件と、選ばれた 1 件» だけ。
	残りは `React.memo` が止める。
	*/
	const markers = useMemo(
		() =>
			clusters.map((cluster) =>
				cluster.pins.length === 1 ? (
					<RestaurantPinMarker
						key={cluster.id}
						cluster={cluster}
						appearance={isPickMode ? "label" : "avatar"}
						detail={pinDetail}
						isActive={activeRestaurantId === cluster.pins[0].restaurant.id}
						onPress={handlePinPress}
					/>
				) : (
					<RestaurantClusterMarker key={cluster.id} cluster={cluster} onPress={handleClusterPress} />
				),
			),
		[activeRestaurantId, clusters, handleClusterPress, handlePinPress, isPickMode, pinDetail],
	);

	return (
		<View style={styles.container}>
			{/* Map */}
			<MapView
				ref={mapRef}
				// #1629 Detox から «地図が出たか» を待つための口。実機の録画で
				// 「このエリアで再検索」の所要時間を測るのに要る（e2e-mobile の perf spec）
				testID="select-restaurant-map"
				style={styles.map}
				initialRegion={initialRegion}
				onMapReady={() => setMapReady(true)}
				onRegionChangeComplete={handleRegionChangeComplete}
				onPoiClick={handlePoiPress}>
				{/* #644 【設計】保存したお店のマーカー表示 */}
				{markers}
			</MapView>

			{/* Loading Indicator */}
			{isLoadingRestaurantCreation && (
				<View style={styles.loadingOverlay}>
					<LoadingIndicator size="large" />
				</View>
			)}

			{/* 🔹上部 UI レイヤー（ヘッダー＋検索＋ボタン） */}
			<View
				style={[styles.topOverlay]}
				pointerEvents="box-none" // 余白部分は Map をタッチ可能にする
			>
				{/* #644 【設計】画面タイトル with 戻るボタン */}
				<ScreenHeader
					title={i18n.t(isPickMode ? "SelectRestaurant.pickTitle" : "SelectRestaurant.title")}
					onPressBack={() => {
						lightImpact();
						router.back();
					}}
				/>

				{/* #1375 実機確認: 検索窓は 1 本だけにする。
				    以前は #1398 PR6 の店名検索（自前 restaurants テーブル）と、この
				    Places の検索の 2 本が縦に並んでいて、どちらに何を打てばよいか分からなかった。
				    店名検索の部品自体（`RestaurantNameSearch`）は消していない。

				    ⚠️ この 1 本は «エリア専用» ではない（2 巡目の指摘「保存してないお店が見れない」）。
				    `handleAutocompleteSelect` は候補が飲食店なら `createAndOpenRestaurant` へ、
				    そうでなければ地図移動 +（そのエリアの）保存済み検索へ振り分ける。つまり
				    **店名を打てば未保存の店もそのまま選べる**。プレースホルダを「エリアで検索」に
				    していたせいでその道が隠れていたので、「店名やエリアで検索」に戻す */}
				<View style={styles.searchContainer}>
					<LocationAutocomplete
						value={searchQuery}
						onChangeText={setSearchQuery}
						onSelectSuggestion={handleAutocompleteSelect}
						onClear={() => setSearchQuery("")}
						placeholder={i18n.t("Map.placeholders.searchRestaurantsForReview")}
						renderInputRight={
							<TouchableOpacity
								style={styles.currentLocationButton}
								onPress={handleCurrentLocation}
								hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
								accessibilityRole="button"
								accessibilityLabel={i18n.t("Map.accessibility.useCurrentLocation")}
								testID="review-select-restaurant-current-location-button">
								<Navigation size={20} color={colors.textStrong} />
							</TouchableOpacity>
						}
					/>
				</View>

				{/* Search This Area button under LocationAutocomplete; map remains interactive on sides */}
				<View style={styles.searchButtonContainer}>
					<PrimaryButton
						onPress={() => searchSavedRestaurants(currentRegion.current)}
						testID="select-restaurant-search-this-area"
						label={i18n.t("SelectRestaurant.searchThisArea")}
						// #1375（5 巡目）「この範囲で再検索」は青（#357AFF）から主要文字色（#111827）へ。
						// #1509 でその 2 色をトークン化してある
						icon={<RotateCw size={16} color={colors.textPrimaryAlt} />}
						colors={[colors.surface, colors.surface]}
						shadowColor={"transparent"}
						labelStyle={{ color: colors.textPrimaryAlt, fontSize: 14 }}
						loading={isLoadingSavedRestaurants}
						loadingIndicatorType="native"
						nativeLoadingColor={colors.textPrimaryAlt}
					/>
				</View>
			</View>

			{/* Saved Restaurants BottomSheet

			    #1375（オーナー指示）**「お店を選ぶ」ときは出さない。**
			    記録の途中でこの画面へ来る人は «探している店» が決まっているので、
			    保存済みの一覧が下から出ても選択の役に立たず、地図と検索結果を隠すだけになる。
			    保存済みの店は地図上のピンとして見えているので、そこから選べる。

			    ⚠️ pick モード以外（この画面を単体で開く経路）では従来どおり出す。 */}
			{!isPickMode && (
				<SavedRestaurantsSheet
					ref={savedRestaurantsSheetRef}
					visible={isSheetVisible}
					showReviewButton={!isPickMode}
					savedRestaurants={savedRestaurants}
					isLoadingSavedRestaurants={isLoadingSavedRestaurants}
					activeRestaurantId={activeRestaurantId}
					onRestaurantCardPress={handleSavedRestaurantCardPress}
					onRestaurantReviewPress={handleSavedRestaurantReviewPress}
					onSnapToRestaurant={(restaurant) => setActiveRestaurantId(restaurant.restaurant.id)}
				/>
			)}
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: c.surface,
		},
		map: {
			flex: 1,
		},
		topOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			zIndex: 100,
		},
		searchContainer: {
			marginTop: 8,
			marginHorizontal: 16,
		},
		currentLocationButton: {
			padding: 16,
			borderLeftWidth: 0.5,
			borderLeftColor: c.border,
		},
		searchButtonContainer: {
			marginTop: 8,
			alignItems: "center",
		},
		loadingOverlay: {
			position: "absolute",
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			justifyContent: "center",
			alignItems: "center",
			backgroundColor: "rgba(0, 0, 0, 0.3)",
			zIndex: 20,
		},
	});
