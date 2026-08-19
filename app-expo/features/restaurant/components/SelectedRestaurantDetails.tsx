/*
このファイルの責務
- 店舗詳細（`app/[locale]/(tabs)/review/restaurant/[restaurantId].tsx` の中身）を描く。
- 「レビューを投稿」「入札する」「Google マップで開く」の 3 導線と、レビュー / 入札の 2 タブを持つ。
- 遷移はすべて «ルート» への push で行う（この画面はオーバーレイを 1 つも持たない）。

#1386 【設計】店舗詳細は長らく «2 実装» あった。

| 旧実装 | 描かれ方 | 持っていた機能 |
| --- | --- | --- |
| `features/map/components/SelectedRestaurantDetails.tsx`（353 行・削除） | map.tsx の `RestaurantBlurModal`（z1100）の中 | 入札タブ / 入札ボタン / 現在の入札額 / Google マップ / レビュー一覧はフィードを重ねて表示 |
| `features/review/components/SelectedRestaurantDetails.tsx`（このファイル） | `/review/restaurant/[restaurantId]` ルート | 投稿ボタン / レビュー一覧は既存メディアへのレビュー投稿へ push |

同じ「店の詳細」を 2 つ持つと、片方だけ直る（#1092 の is_anonymous 判定がまさにそれで、
2 ファイルへ同じ修正を入れている）。ルート側を残して map 側を畳み、**両方の機能の和**にした。
map 側にしか無かったものは 1 つも落としていない:

- 入札タブ（`RestaurantBidsTab`）と入札ボタン → 入札は `bid` ルートへ
- 現在の入札額 / 残り日数の表示（`meta.maxEndDate` があるときだけ出る）
- Google マップで開く（#1121 の openExternalUrl 経由）
- レビュー一覧の «フィード表示» → `feed` ルートへ

レビュー一覧の押下先だけは統合で意味が変わっている。旧レビュー側は既存メディアへの
レビュー投稿（`review-from-media`）へ直行していたが、統合後は map 側と同じくフィードを開き、
フィードの「この料理にレビューを書く」から `review-from-media` へ進む。どちらの機能も残っており、
「どの料理か」を見てから書ける分だけ経路として素直になる（フィードは
`app/[locale]/(tabs)/review/restaurant/[restaurantId]/feed.tsx`）。

⚠️ この画面に BlurModal / 手動 zIndex を戻さないこと。`Portal.Host` は `<Stack>` を包んでいる
（`app/[locale]/_layout.tsx`）ので portal レイヤは常にナビゲータより «上» にある。オーバーレイを
開いたまま push すると遷移先が下に潜って見えず触れない（#1364 で実測）。この画面が
オーバーレイを 1 つも持たないことは `__tests__/mapRestaurantRoute.test.tsx` が固定している。
*/
import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Platform } from "react-native";
import { Camera, DollarSign } from "lucide-react-native";
import { Card } from "@/components/Card";
import Stars from "@/components/Stars";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { RestaurantReviewsTab } from "@/features/map/components/tabs/RestaurantReviewsTab";
import { RestaurantBidsTab } from "@/features/map/components/tabs/RestaurantBidsTab";
import { Tabs } from "@/components/collapsible-tabs";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import { useSharedValueState } from "@/hooks/useSharedValueState";
import { useLogger } from "@/hooks/useLogger";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { getCacheKeyForImage } from "@/lib/image";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { RestaurantEntry } from "../stores/useRestaurantStore";
import { useLocale } from "@/hooks/useLocale";
import { useRouter } from "expo-router";

function RestaurantTabsBar({ tabNames, index, onTabPress }: TabBarProps<string>) {
	const currentIndex = useSharedValueState(index);
	return (
		<View style={styles.tabContainer}>
			{tabNames.map((name, i) => {
				const isActive = currentIndex === i;
				// #1386 2 実装の統合でタブは «レビュー / 入札» の 2 本になった。旧レビュー側は
				// 1 本だけで「みんなの投稿」と出していたが、対になる入札が並ぶため map 側の対語へ寄せる
				const label = name === "reviews" ? i18n.t("Map.tabs.reviews") : i18n.t("Map.tabs.bids");
				return (
					<TouchableOpacity
						key={name}
						style={[styles.tab, isActive && styles.activeTab]}
						onPress={() => onTabPress(name)}>
						<Text style={[styles.tabText, isActive && styles.activeTabText]}>{label}</Text>
					</TouchableOpacity>
				);
			})}
		</View>
	);
}

type SelectedRestaurantDetailsProps = {
	// #644 【設計】レストランエントリ（restaurant + meta 情報）
	restaurantEntry: RestaurantEntry;
};

export function SelectedRestaurantDetails({ restaurantEntry }: SelectedRestaurantDetailsProps) {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { showSnackbar } = useSnackbar();
	const router = useRouter();
	const { locale } = useLocale();
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const { user } = useAuth();
	const { restaurant, meta } = restaurantEntry;

	// #644 【設計】写真・動画を投稿するボタン押下時の処理（メディア選択ありモード）
	const handleReviewButtonPress = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "review_post_photo_video_button_press",
			error_level: "log",
			payload: {
				restaurant_id: restaurant.id,
			},
		});

		// #477【設計】匿名ユーザーの場合はログイン導線へ、非匿名ユーザーの場合は ReviewForm を表示
		// #1092 PR4b 【修正】`user?.is_anonymous !== false` から共通判定（lib/authGuest.ts）へ寄せた。
		// 旧式は is_anonymous が undefined のときもゲストへ倒れ、レビュータブの CTA は投稿導線なのに
		// ここではログイン導線が出る、という画面間の食い違いになる
		if (isGuestUser(user)) {
			// #1359 【設計】`next` は «戻り先» ではなく «行き先» として使う。
			// このボタンは非ゲストなら投稿フォームへ進む導線なので、ゲストの `next` も同じ先へ向ければ
			// ログイン後にそのまま投稿へ進める。店は restaurantId として URL に載るため、
			// 履歴を持たない着地（コールドロード / web の OAuth 全画面リダイレクト）でも成立する。
			// #1386 map から来た場合もここを通る。旧 map 実装は `next` を «地図タブ» にしていたが、
			// 店が URL に載った以上、投稿フォームまで戻せるこちらの方が忠実に復帰できる
			router.push({
				pathname: "/[locale]/auth/login",
				params: {
					locale,
					next: `/${locale}/review/restaurant/${restaurant.id}/review`,
				},
			});
		} else {
			// ReviewForm に遷移すると同時にメディア選択が行われる
			router.push({
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/review",
				params: { locale, restaurantId: restaurant.id },
			});
		}
	}, [lightImpact, logFrontendEvent, router, locale, restaurant, user]);

	// #1386 【設計】入札。旧 map 実装では `BidBlurModal`（z1300）だった。
	// 入札額の入力とその後の決済は «フローの一段» なのでルートへ移す（#1350 の振り分け表）
	const handleBidButtonPress = useCallback(() => {
		lightImpact();
		router.push({
			pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/bid",
			params: { locale, restaurantId: restaurant.id },
		});
	}, [lightImpact, router, locale, restaurant.id]);

	// #1386 旧 map 実装から移設（機能を落とさないため）
	const handleOpenGoogleMaps = useCallback(async () => {
		lightImpact();

		logFrontendEvent({
			event_name: "restaurant_google_maps_clicked",
			error_level: "log",
			payload: {
				restaurantId: restaurant.id,
				restaurantName: restaurant.name,
				googlePlaceId: restaurant.google_place_id,
			},
		});

		try {
			const { mapUrl, canOpen } = await getGoogleMapsLink(restaurant);
			// #1121 Web の別タブ起動は openExternalUrl へ寄せた。
			// canOpen（Linking.canOpenURL）はネイティブのハンドラ有無の判定なので Web では見ない
			if (Platform.OS !== "web" && !canOpen) {
				showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
				return;
			}
			await openExternalUrl(mapUrl);
		} catch (error) {
			showSnackbar(i18n.t("DishMediaContent.errors.mapOpenFailed"));
			logFrontendEvent({
				event_name: "restaurant_google_maps_open_failed",
				error_level: "error",
				payload: {
					restaurantId: restaurant.id,
					googlePlaceId: restaurant.google_place_id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
		}
	}, [lightImpact, logFrontendEvent, restaurant, showSnackbar]);

	// #1386 【設計】レビュー一覧の押下でフィードを開く。
	// 旧 map 実装はここで `DishMediaModal`（既定 z1100 = 親と同値）を重ねていた。
	// 旧レビュー側が直行していた `review-from-media` へは、フィードの
	// 「この料理にレビューを書く」から進む（ファイル冒頭のコメント参照）
	const handleDishMediaPress = useCallback(
		(index: number, dishMediaId: string) => {
			lightImpact();
			logFrontendEvent({
				event_name: "review_from_media_navigate",
				error_level: "log",
				payload: {
					restaurant_id: restaurant.id,
					dish_media_id: dishMediaId,
				},
			});
			router.push({
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/feed",
				params: { locale, restaurantId: restaurant.id, initialIndex: String(index) },
			});
		},
		[lightImpact, logFrontendEvent, router, locale, restaurant.id],
	);

	// Collapsible header
	const [headerHeight, setHeaderHeight] = useState(0);
	const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		setHeaderHeight(event.nativeEvent.layout.height);
	}, []);

	const renderHeader = useCallback(
		() => (
			<View onLayout={handleHeaderLayout}>
				<Card>
					<View style={styles.restaurantInfo}>
						<Image
							source={{
								uri: restaurant.imageUrls?.md,
								cacheKey: getCacheKeyForImage(restaurant.imageUrls?.md),
							}}
							style={styles.restaurantAvatar}
						/>
						<View style={styles.restaurantDetails}>
							<Text style={styles.restaurantName}>{restaurant.name}</Text>
							<View style={styles.ratingContainer}>
								<Stars rating={meta.averageRating} />
								<Text style={styles.ratingText}>{meta.averageRating}</Text>
								<Text style={styles.reviewCount}>({meta.reviewCount})</Text>
							</View>
							{/* #1386 旧 map 実装から移設 */}
							<PrimaryButton
								testID="restaurant-detail-google-maps-button"
								onPress={handleOpenGoogleMaps}
								label={i18n.t("Map.buttons.openInGoogle")}
								labelStyle={{ color: "#5EA2FF" }}
								colors={["#F0F8FF", "#F0F8FF"]}
								shadowColor="transparent"
								borderRadius={8}
							/>
						</View>
					</View>
				</Card>

				{/* #1386 旧 map 実装から移設。入札が動いている店だけに出る */}
				{meta.maxEndDate && (
					<View style={styles.bidAmountContainer}>
						<Text style={styles.bidAmountLabel}>{i18n.t("Map.labels.currentBidAmount")}</Text>
						<Text style={styles.bidAmount}>
							{i18n.t("Search.currencySuffix")}
							{(meta.totalCents ?? 0).toLocaleString()}
						</Text>
						<Text style={styles.remainingDays}>
							{i18n.t("Common.daysRemaining", {
								count: Math.max(
									0,
									Math.ceil((new Date(meta.maxEndDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
								),
							})}
						</Text>
					</View>
				)}

				<View style={styles.actionButtons}>
					{/* #644 【設計】自分の投稿ボタン「写真・動画を投稿」
					    ⚠️ testID は e2e（review-post / review-double-submit / ui-catalog-mutation）が見ている */}
					<PrimaryButton
						testID="restaurant-detail-post-photo-button"
						onPress={handleReviewButtonPress}
						label={i18n.t("Review.selectRestaurant.postPhotoVideo")}
						icon={<Camera size={20} color="#FFF" />}
						borderRadius={8}
						style={{ flex: 1 }}
					/>
					{/* #1386 旧 map 実装から移設 */}
					<PrimaryButton
						testID="restaurant-detail-place-bid-button"
						onPress={handleBidButtonPress}
						label={i18n.t("Map.buttons.placeBid")}
						icon={<DollarSign size={20} color="#FFF" />}
						borderRadius={8}
						style={{ flex: 1 }}
					/>
				</View>
			</View>
		),
		[handleHeaderLayout, restaurant, meta, handleReviewButtonPress, handleBidButtonPress, handleOpenGoogleMaps],
	);

	const renderTabBar = useCallback((props: TabBarProps<string>) => <RestaurantTabsBar {...props} />, []);

	return (
		<View style={{ height: frame.height }}>
			<Tabs.Container
				renderHeader={renderHeader}
				headerHeight={headerHeight}
				renderTabBar={renderTabBar}
				headerContainerStyle={{ shadowColor: "transparent", backgroundColor: "transparent" }}>
				{/*
					レビュータブ: RestaurantReviewsTab を使用。
					グリッド押下でフィード（feed ルート）へ進む
				*/}
				<Tabs.Tab name="reviews">
					<RestaurantReviewsTab restaurantId={restaurant.id} onItemPress={handleDishMediaPress} />
				</Tabs.Tab>
				{/*
					#1386 入札タブ: 旧 map 実装から移設。useCursorPagination で入札履歴を取得する
				*/}
				<Tabs.Tab name="bids">
					<RestaurantBidsTab restaurantId={restaurant.id} />
				</Tabs.Tab>
			</Tabs.Container>
		</View>
	);
}

const styles = StyleSheet.create({
	restaurantInfo: {
		flexDirection: "row",
		alignItems: "center",
		marginVertical: 4,
	},
	restaurantAvatar: {
		width: 60,
		height: 60,
		borderRadius: 20,
	},
	restaurantDetails: {
		flex: 1,
		marginLeft: 12,
	},
	restaurantName: {
		fontSize: 18,
		fontWeight: "bold",
		color: "#000",
		marginBottom: 4,
	},
	ratingContainer: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 4,
	},
	ratingText: {
		fontSize: 14,
		fontWeight: "600",
		color: "#000",
		marginRight: 4,
	},
	reviewCount: {
		fontSize: 12,
		color: "#666",
	},
	// #1386 旧 map 実装から移設（現在の入札額）
	bidAmountContainer: {
		backgroundColor: "#F0F8FF",
		padding: 16,
		borderRadius: 12,
		alignItems: "center",
		marginVertical: 12,
		marginHorizontal: 16,
	},
	bidAmountLabel: {
		fontSize: 12,
		color: "#666",
		marginBottom: 4,
	},
	bidAmount: {
		fontSize: 28,
		fontWeight: "bold",
		color: "#F05537",
		marginBottom: 4,
	},
	remainingDays: {
		fontSize: 14,
		color: "#666",
	},
	actionButtons: {
		flexDirection: "row",
		gap: 12,
		margin: 16,
	},
	tabContainer: {
		flexDirection: "row",
		marginHorizontal: 16,
		marginBottom: 16,
	},
	tab: {
		flex: 1,
		paddingVertical: 12,
		alignItems: "center",
	},
	activeTab: {
		borderBottomWidth: 2,
		borderBottomColor: "#F05537",
	},
	tabText: {
		fontSize: 16,
		color: "#666",
		fontWeight: "500",
	},
	activeTabText: {
		color: "#F05537",
		fontWeight: "600",
	},
});
