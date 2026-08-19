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

- 現在の入札額 / 残り日数の表示（`meta.maxEndDate` があるときだけ出る）
- Google マップで開く（#1121 の openExternalUrl 経由）

レビュー一覧の押下先は #1386 で «feed を挟む» へ変えたが、**#1418 で直行へ戻した**
（下の `handleDishMediaPress` を参照）。`feed` ルート自体は残っているが、
アプリ内からは開かない（直リンクのみ）。

⚠️ この画面に BlurModal / 手動 zIndex を戻さないこと。`Portal.Host` は `<Stack>` を包んでいる
（`app/[locale]/_layout.tsx`）ので portal レイヤは常にナビゲータより «上» にある。オーバーレイを
開いたまま push すると遷移先が下に潜って見えず触れない（#1364 で実測）。この画面が
オーバーレイを 1 つも持たないことは `__tests__/mapRestaurantRoute.test.tsx` が固定している。
*/
/*
#1411 【バグ】入札の導線は **公開アプリに出してはいけない**。

#1386 で店詳細の 2 実装（map 側 353 行 / レビュー側）を統合したとき、map 側にあった
入札ボタン・入札タブ・現在の入札額を «機能を落とさない» つもりで持ち込んだ。しかし
**map タブは `href: null`（app/[locale]/(tabs)/_layout.tsx）でタブバーに出ない** ため、
map 側の店詳細は本番から到達不能で、入札の導線は事実上出ていなかった。
統合先のレビュー側は到達可能なので、これを «復活» させてしまっていた。

独立レビューは「map 側の機能が落ちていないか」を 353 行ぶん突き合わせたが、
逆方向（**そもそも出てはいけないものを持ち込んでいないか**）は誰も見ていなかった。

入札そのものは決済が未実装で、`bid.tsx` の送信は 2 秒待つダミーである。
導線を出す判断は決済が入ってからにする。
*/

import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Platform } from "react-native";
import { Camera } from "lucide-react-native";
import { Card } from "@/components/Card";
import Stars from "@/components/Stars";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { RestaurantReviewsTab } from "@/features/map/components/tabs/RestaurantReviewsTab";
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
				// #1418 タブは 1 本に戻り、押下先も «その料理のレビューを書く» に戻ったので、
				// 文言も旧レビュー側（Review.everybodyPostsTitle）へ戻す。
				// #1386 で入札タブと対にするため map 側の «レビュー» へ寄せていた
				const label = i18n.t("Review.everybodyPostsTitle");
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

	/*
	#1418 【バグ】レビュー一覧の押下は `review-from-media` へ **直行**すること。

	#1386 で map 側（`DishMediaModal` を重ねる）へ寄せて `feed` を挟んだが、それは
	«押下 1 回» を «押下 2 回» にする劣化だった。しかも feed の「この料理にレビューを書く」は
	`!isGuestUser(user)` で出ないので、**ゲストは «他人の投稿に文字だけのレビューを書く» へ
	到達する手段を完全に失っていた**（旧レビュー側の直行にゲスト判定は無い）。

	map 側は `href: null` で到達不能だったので、寄せる先として «正しい» 実装ではない。
	feed ルート自体は残すが、アプリ内の導線からは外す（#1414 の B-3）。
	*/
	const handleDishMediaPress = useCallback(
		(_index: number, dishMediaId: string) => {
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
				pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
				params: { locale, restaurantId: restaurant.id, dishMediaId },
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
				</View>
			</View>
		),
		[handleHeaderLayout, restaurant, meta, handleReviewButtonPress, handleOpenGoogleMaps],
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
					グリッド押下で «その料理へのレビュー投稿»（review-from-media ルート）へ直行する（#1418）
				*/}
				<Tabs.Tab name="reviews">
					<RestaurantReviewsTab restaurantId={restaurant.id} onItemPress={handleDishMediaPress} />
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
