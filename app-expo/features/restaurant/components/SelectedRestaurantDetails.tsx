/*
このファイルの責務
- 店舗詳細（`app/[locale]/restaurant/[restaurantId].tsx` の中身）を描く。
- 「レビューを投稿」の 1 導線と、レビューの 1 タブを持つ。
  （#1386 で入札 / Google マップを持ち込んだが、#1411 #1418 で «出してはいけないもの» として畳んだ。下記参照）
- 遷移はすべて «ルート» への push で行う（この画面はオーバーレイを 1 つも持たない）。

#1386 【設計】店舗詳細は長らく «2 実装» あった。

| 旧実装 | 描かれ方 | 持っていた機能 |
| --- | --- | --- |
| `features/map/components/SelectedRestaurantDetails.tsx`（353 行・削除） | map.tsx の `RestaurantBlurModal`（z1100）の中 | 入札タブ / 入札ボタン / 現在の入札額 / Google マップ / レビュー一覧はフィードを重ねて表示 |
| `features/restaurant/components/SelectedRestaurantDetails.tsx`（このファイル） | `/restaurant/[restaurantId]` ルート | 投稿ボタン / レビュー一覧は既存メディアへのレビュー投稿へ push |

同じ「店の詳細」を 2 つ持つと、片方だけ直る（#1092 の is_anonymous 判定がまさにそれで、
2 ファイルへ同じ修正を入れている）。ルート側を残して map 側を畳み、いったん **両方の機能の和**にした。
ただし «和» にしたこと自体が誤りだった機能があり、#1411 #1418 で以下は畳み直している:

- 入札タブ（`RestaurantBidsTab`）/ 入札ボタン / 現在の入札額（`meta.maxEndDate`）→ #1411 で撤去
- Google マップで開く → #1411 で撤去
- レビュー一覧の «フィード表示» → #1418 で直行へ戻した

レビュー一覧の押下先は #1386 で «feed を挟む» へ変えたが、**#1418 で直行へ戻した**
（下の `handleDishMediaPress` を参照）。`feed` ルート自体は残っているが
（#1375 の移設で `app/[locale]/restaurant/[restaurantId]/feed.tsx`）、アプリ内からは開かない（直リンクのみ）。

⚠️ この画面に BlurModal / 手動 zIndex を戻さないこと。`Portal.Host` は `<Stack>` を包んでいる
（`app/[locale]/_layout.tsx`）ので portal レイヤは常にナビゲータより «上» にある。オーバーレイを
開いたまま push すると遷移先が下に潜って見えず触れない（#1364 で実測）。この画面が
オーバーレイを 1 つも持たないことは `__tests__/loginEntryPoints.test.tsx` が
（react-native-paper の `<Portal>` が描かれるか否かで）固定している。
*/
/*
#1411 【バグ】入札の導線は **公開アプリに出してはいけない**。

#1386 で店詳細の 2 実装（map 側 353 行 / レビュー側）を統合したとき、map 側にあった
入札ボタン・入札タブ・現在の入札額を «機能を落とさない» つもりで持ち込んだ。しかし
**map タブは `href: null`（app/[locale]/(tabs)/_layout.tsx）でタブバーに出ない** ため
（そのタブ自体 #1419 で削除された）、
map 側の店詳細は本番から到達不能で、入札の導線は事実上出ていなかった。
統合先のレビュー側は到達可能なので、これを «復活» させてしまっていた。

独立レビューは「map 側の機能が落ちていないか」を 353 行ぶん突き合わせたが、
逆方向（**そもそも出てはいけないものを持ち込んでいないか**）は誰も見ていなかった。

入札そのものは決済が未実装で、`bid.tsx` の送信は 2 秒待つダミーである。
導線を出す判断は決済が入ってからにする。
*/

import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent, Platform } from "react-native";
import { MapPin } from "lucide-react-native";
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
import { useSafeAreaFrame } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { getCacheKeyForImage } from "@/lib/image";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { getGoogleMapsLink } from "@/lib/googlePlaces";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { RestaurantEntry } from "@/stores/useRestaurantStore";
import { useLocale } from "@/hooks/useLocale";
import { useRouter } from "expo-router";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";

function RestaurantTabsBar({ tabNames, index, onTabPress }: TabBarProps<string>) {
	const styles = useThemedStyles(createStyles);
	const currentIndex = useSharedValueState(index);
	return (
		<View style={styles.tabContainer}>
			{tabNames.map((name, i) => {
				const isActive = currentIndex === i;
				// #1418 タブは 1 本に戻り、押下先も «その料理のレビューを書く» に戻ったので、
				// 文言も旧レビュー側（#1375 の移設で `Restaurant.everybodyPostsTitle`）へ戻す。
				// #1386 で入札タブと対にするため map 側の «レビュー» へ寄せていた
				/*
				#1629【オーナー実機報告】「お店の詳細押すとレビューするフローになる」。

				この文言は **キー名（everybodyPosts）とも、上の申し送りとも食い違っていた**。
				値だけが «レビューする料理を選択» のまま残っており、店舗詳細を開いた人には
				画面全体が «レビューを書け» と読める（唯一のボタンも «写真・動画を投稿»）。
				セクションの見出しなので «みんなの投稿» に戻す。

				その後オーナー確定で、押下先も «その投稿を見る»（feed）へ変えた（下の設計コメント）。
				*/
				const label = i18n.t("Restaurant.everybodyPostsTitle");
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
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const router = useRouter();
	const { locale } = useLocale();
	const frame = useSafeAreaFrame(); // Safe Area を除いたフレームの高さ
	const { showSnackbar } = useSnackbar();
	const { restaurant, meta } = restaurantEntry;

	/*
	#1629【オーナー確定】**「写真・動画を投稿」は、この画面から外した。**

	投稿は «食べたを記録» のフロー（my-dishes → 記録 → お店を選ぶ）に 1 本化されている。
	店舗詳細にも同じことを始めるボタンを置いていたため、**画面に出ているものが
	店の情報 0 件・レビューを書く導線 2 件**になり、店舗詳細を開いた人に
	「レビューするフローに飛ばされた」と読まれていた（オーナー実機報告）。

	代わりに «Google マップで開く» を戻す。#1411 が入札の撤去と一緒に消したが、
	これは店の情報（場所・営業時間・電話）へ辿り着く導線であって入札とは無関係で、
	撤去する理由が申し送りに書かれていなかった。
	*/
	const handleOpenGoogleMaps = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "restaurant_google_maps_clicked",
			error_level: "log",
			payload: { restaurant_id: restaurant.id, google_place_id: restaurant.google_place_id },
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
					restaurant_id: restaurant.id,
					google_place_id: restaurant.google_place_id,
					error: error instanceof Error ? error.message : "Unknown error",
				},
			});
		}
	}, [lightImpact, logFrontendEvent, restaurant, showSnackbar]);

	/*
	#1629【オーナー確定】**一覧を押したら «その投稿を見る»（フィード）へ行く。**

	#1418 はここを `review-from-media`（= その料理のレビューを書く画面）への直行にしていた。
	当時この画面は «レビュー投稿導線» だったのでそれで筋が通っていたが、いまは
	«店舗詳細» である。店の投稿一覧を押した人が求めているのは «その投稿を見ること» で、
	いきなり自分がレビューを書く画面が出るのは（オーナー実機報告のとおり）驚きでしかない。

	行き先の `feed` ルートは #1386 が作ったまま残っており（アプリ内から開く導線だけが
	#1418 で外れていた）、レビュータブと **同じストアキー**（`mapReviewsKey`）を使うので
	取得は 1 回も増えない。開始位置は index で渡す。

	⚠️ レビューを書く導線が消えるわけではない。フィードの中に «この料理にレビューを書く» が
	   ある（`ActionButtons`）。#1418 が心配していた «ゲストが文字だけのレビューへ到達できない»
	   点だけは、あちらが `!isGuestUser(user)` で出し分けているため残る。
	   ゲストのレビュー投稿は #1359 のログイン導線の話であって、この画面の分岐で解くものではない。
	*/
	const handleDishMediaPress = useCallback(
		(index: number, dishMediaId: string) => {
			lightImpact();
			logFrontendEvent({
				event_name: "restaurant_detail_feed_navigate",
				error_level: "log",
				payload: {
					restaurant_id: restaurant.id,
					dish_media_id: dishMediaId,
					index,
				},
			});
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]/feed",
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
							{/* #1667 【バグ】レビュー 0 件を rating=0（★ 空 5 つ）で描くと «最低評価» と
							    見分けが付かない。
							    【オーナー確定 2026-09-03】0 件のときは **何も出さない**。
							    「未評価」というラベルも出さない（無いものを言葉で埋めない）。
							    1 件以上のときの見た目は変えない（API の averageRating/reviewCount は non-null のまま） */}
							{meta.reviewCount > 0 && (
								<View style={styles.ratingContainer}>
									<Stars rating={meta.averageRating} />
									<Text testID="restaurant-detail-rating-value" style={styles.ratingText}>
										{meta.averageRating}
									</Text>
									<Text testID="restaurant-detail-review-count" style={styles.reviewCount}>
										({meta.reviewCount})
									</Text>
								</View>
							)}
							{/* #1629【オーナー確定】「写真・動画を投稿」を外し、«Google マップで開く» を戻した。
							    投稿は «食べたを記録» のフローに 1 本化されている（上の設計コメント）。
							    ⚠️ testID は e2e（restaurantDetailRoutes / RestaurantDetailPage 等）が見ている */}
							<PrimaryButton
								testID="restaurant-detail-google-maps-button"
								onPress={handleOpenGoogleMaps}
								label={i18n.t("Restaurant.detail.openInGoogleMaps")}
								icon={<MapPin size={20} color={colors.brand} />}
								labelStyle={{ color: colors.brand }}
								colors={[colors.brandTint, colors.brandTint]}
								shadowColor="transparent"
								borderRadius={8}
							/>
						</View>
					</View>
				</Card>
			</View>
		),
		[handleHeaderLayout, restaurant, meta, handleOpenGoogleMaps, colors, styles],
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
					投稿タブ: RestaurantReviewsTab を使用。
					グリッド押下で «その投稿を見る»（feed ルート）へ入る（#1629）
				*/}
				<Tabs.Tab name="reviews">
					<RestaurantReviewsTab restaurantId={restaurant.id} onItemPress={handleDishMediaPress} />
				</Tabs.Tab>
			</Tabs.Container>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
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
		color: c.textStrong,
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
		color: c.textStrong,
		marginRight: 4,
	},
	reviewCount: {
		fontSize: 12,
		color: c.textMuted,
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
		borderBottomColor: c.brand,
	},
	tabText: {
		fontSize: 16,
		color: c.textMuted,
		fontWeight: "500",
	},
	activeTabText: {
		color: c.brand,
		fontWeight: "600",
	},
});
