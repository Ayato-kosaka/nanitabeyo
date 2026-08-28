import React, { useCallback } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, Text, StyleSheet, FlatList, RefreshControl, TouchableOpacity } from "react-native";
// #1130 【修正】react-native の SafeAreaView は iOS 専用（Android では素の View に等しく inset を
// 一切足さない）ため、Android だけヘッダーがステータスバーへ食い込んでいた。
// ブロック済み料理一覧（profile/blocked-dish-categories.tsx）や検索・プロフィールのタブ直下画面と同じく
// react-native-safe-area-context の SafeAreaView を使う。
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { Heart, Bookmark, Vote } from "lucide-react-native";
import { useHaptics } from "@/hooks/useHaptics";
import { useNotifications } from "@/features/notifications/hooks/useNotifications";
import { useMarkNotificationsRead } from "@/features/notifications/hooks/useMarkNotificationsRead";
import { useRouter } from "expo-router";
import type { NotificationItem, NotificationResponse } from "@shared/api/v1/res";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useFocusEffect } from "expo-router";
import { useNotificationUnreadCount } from "@/features/notifications/hooks/useNotificationUnreadCount";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import { useScreenTrace } from "@/hooks/useScreenTrace";
import { getCacheKeyForImage } from "@/lib/image";
import { dateStringToTimestamp } from "@/lib/frontend-utils";
import { DeletedMediaTombstone } from "@/components/DeletedMediaTombstone";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { FixedColors, type Palette } from "@/constants/Palette";

/**
 * 🔔 通知一覧画面
 *
 * - GET /v1/notifications を利用してキーセットページング
 * - 画面入場時に一括既読処理
 * - 未読数バッジ表示
 * - 通知タップ時に対象画面に遷移
 * - 多言語対応（Intl.ListFormat でアクター名を表示）
 */
export default function NotificationsScreen() {
	// #1016 【設計】主要画面(通知タブ)にFirebase Performance Monitoringの画面トレースを計装する。
	useScreenTrace("Notifications");
	/*
	#1513 【設計】この画面をテーマ追従にした理由。

	墓標（DeletedMediaTombstone）は面を `divider`、文字を `textSecondary` で描くテーマ追従の
	部品である。この画面だけ地が白直書きのままだと、**ダークで «白いシートの上に黒い墓標»**
	という 1 か所だけ配色が反転した絵になる（実測: エビデンス撮影で確認）。
	墓標側を «この画面ではライト固定» に細工する手もあるが、それは画面が嘘をついている
	状態を部品側で吸収することになり、後でこの画面をトークン化したときに取り残される。
	地の方を直すのが正しいので、ここで直す。

	⚠️ これに伴い #1549（assert-no-hardcoded-colors）の EXCLUSIONS から
	   `app/[locale]/(tabs)/notifications/index.tsx` の行を消してある。
	   解消済みの行を残すとゲートが落ちる仕様のため、両者は同時に入る必要がある。
	*/
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const router = useRouter();
	const { lightImpact } = useHaptics();
	const { user } = useAuth();
	const notifications = useNotifications();
	// #1375 依存に入れるのは **関数だけ**。`notifications` はレンダーのたびに別オブジェクトになるので、
	// これを `useFocusEffect` の依存へ入れると通知 API を無限に叩き続ける（useCursorPagination 参照）
	const { refresh: refreshNotifications } = notifications;
	const { markAllAsRead } = useMarkNotificationsRead();
	const { unreadCount, refresh: notificationUnreadCountRefresh } = useNotificationUnreadCount();
	const { locale } = useLocale();

	// #通知機能 【設計】画面入場時に通知を取得し、未読数をリフレッシュして全件既読にする
	const inFlightRef = React.useRef(false);
	useFocusEffect(
		React.useCallback(() => {
			// #1092 PR4b `!user || user.is_anonymous` から共通判定（lib/authGuest.ts）へ寄せた。
			// 判定内容は同じだが、通知タブの表示可否（app/[locale]/(tabs)/_layout.tsx）と
			// 同じ式であることをコードで保証しておく
			if (isGuestUser(user)) return;
			if (inFlightRef.current) return;
			inFlightRef.current = true;
			(async () => {
				try {
					await refreshNotifications();
					await notificationUnreadCountRefresh(); // 未読数リフレッシュが先
					await markAllAsRead(); // その後に全件既読
				} finally {
					// 少し遅らせて解放すると同一フレームの多重起動を吸収しやすい
					setTimeout(() => (inFlightRef.current = false), 0);
				}
			})();
			return () => {};
		}, [user?.id, refreshNotifications, markAllAsRead, notificationUnreadCountRefresh]),
	);

	// #通知機能 【仕様】通知タップ時の遷移処理
	const handleNotificationPress = useCallback(
		(notification: NotificationItem) => {
			lightImpact();

			// #通知機能 【設計】target_table に基づいて遷移先を判定
			const { target_table } = notification.notification;

			if (target_table === "dish_media" && notification.dishMediaEntries !== undefined) {
				// #通知機能 【仕様】dish_media の場合は DishMediaFeed へ遷移
				const { upsertDishMediaEntries, updateMediaIdsByKey } = useDishMediaEntriesStore.getState();
				const currentDishMedia = notification.dishMediaEntries;
				upsertDishMediaEntries([currentDishMedia]);
				const mediaId = String(currentDishMedia.dish_media.id);
				updateMediaIdsByKey("notification", () => [mediaId]);
				router.push({
					pathname: "/[locale]/(tabs)/notifications/feed",
					params: { locale, idType: "dish_media" },
				});
			} else if (target_table === "dish_reviews" && notification.dishMediaEntries !== undefined) {
				// #通知機能 【仕様】dish_reviews の場合は DishMediaFeed へ遷移
				const { upsertDishMediaEntries, updateReviewIdsByKey } = useDishMediaEntriesStore.getState();
				const currentDishMedia = notification.dishMediaEntries;
				upsertDishMediaEntries([currentDishMedia]);
				const reviewId = String(notification.notification.target_id);
				updateReviewIdsByKey("notification", () => [reviewId]);
				router.push({
					pathname: "/[locale]/(tabs)/notifications/feed",
					params: { locale, idType: "dish_reviews" },
				});
			} else if (
				target_table === "dish_category_group_vote_sessions" &&
				notification.dishCategoryGroupVoteSession !== undefined
			) {
				// #1506 GRP-04 【仕様】投票通知は結果画面（shareToken）へ遷移
				router.push({
					pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]",
					params: { locale, shareToken: notification.dishCategoryGroupVoteSession.shareToken },
				});
			}
			// #通知機能 【設計】他の target_table は今後追加予定
		},
		[lightImpact, router, locale],
	);

	// #通知機能 【仕様】通知アイテムのアイコンを取得
	const getNotificationIcon = (actionType: NotificationResponse["action_type"]) => {
		// #1513 この字は «塗り潰したバッジの上» に載るので、テーマで振ってはいけない
		const iconProps = { size: 13, color: FixedColors.onFilled };

		switch (actionType) {
			case "like":
				return <Heart {...iconProps} fill={FixedColors.onFilled} />;
			case "save":
				return <Bookmark {...iconProps} fill={FixedColors.onFilled} />;
			case "vote":
				return <Vote {...iconProps} />;
			default:
				return <Heart {...iconProps} />;
		}
	};

	// #通知機能 【仕様】通知アイテムのアイコン背景色を取得
	// #1513 アクション色は «種別の識別子» なのでテーマで振らない（FixedColors の JSDoc 参照）
	const getIconBackgroundColor = (actionType: NotificationResponse["action_type"]) => {
		switch (actionType) {
			case "like":
				return FixedColors.notificationLike;
			case "save":
				return FixedColors.notificationSave;
			case "vote":
				return FixedColors.notificationVote;
			default:
				return FixedColors.notificationLike;
		}
	};

	// #通知機能 【仕様】アクター名を多言語対応で表示（Intl.ListFormat）
	const formatActorNames = useCallback((actors: NotificationItem["actors"]) => {
		// #1557 【設計】匿名ユーザー（users 行が無い actor）は API の actors から落ちるため
		// 空配列になる。ProfileHeader のゲスト表示と同じ文言（Profile.guestDisplayName）で表示する
		if (actors.length === 0) return i18n.t("Profile.guestDisplayName");
		const names = actors.map((a: NotificationItem["actors"][number]) => a.display_name || "Unknown");
		const locale = i18n.locale;

		// #通知機能 【設計】Intl.ListFormat で ja → "A、B、C" / en → "A, B, and C" を作る
		if (Intl.ListFormat) {
			const formatter = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
			return formatter.format(names);
		}
		// Fallback: カンマ区切り
		return names.join(", ");
	}, []);

	// #通知機能 【仕様】通知メッセージを多言語対応で取得
	const getNotificationMessage = useCallback((notification: NotificationItem) => {
		const { target_table, action_type } = notification.notification;

		// #通知機能 【設計】i18n key: notification.{target_table}.{action_type}
		const key = `Notifications.notification.${target_table}.${action_type}`;
		const message = i18n.t(key);

		return message || "";
	}, []);

	// #通知機能 【仕様】通知アイテムをレンダリング
	const renderNotificationItem = useCallback(
		({ item }: { item: NotificationItem }) => {
			const iconBgColor = getIconBackgroundColor(item.notification.action_type);
			const actorNames = formatActorNames(item.actors);
			const message = getNotificationMessage(item);
			// #1557 【バグ】匿名 actor だと actors は空配列になり、`[0].avatarUrls` の直参照が
			// TypeError で画面全体を落としていた。actor 不在はゲストとして扱う
			const firstActor = item.actors?.[0];
			const avatar = firstActor?.avatarUrls?.sm || "https://via.placeholder.com/50";

			/*
			#1513 【設計】通知の対象（dish_media / dish_reviews）が削除済みなら、行は残して
			サムネイルの位置に墓標「削除されました」を出す。

			通知の行そのものを消してはいけない。「〇〇さんがいいねしました」は起きた事実であり、
			あとから写真を消したことで **通知が届いた記憶ごと消える** と、利用者からは通知の
			取りこぼしと区別が付かない。API 側は `includeDeleted: true` で削除済みも返し、
			`mediaUrl` / `thumbnailImageUrl` は null にしてある（notifications.service.ts）。

			⚠️ 押せなくすること。`handleNotificationPress` の遷移先（全画面フィード）には
			   実体が無く、押すと中身の無いフィードが開いてしまう。
			*/
			const isTargetDeleted = item.dishMediaEntries?.dish_media.deleted_at != null;

			return (
				<TouchableOpacity
					// #1506 GRP-04 【テスト】行とアイコンに action_type 込みの testID を付ける。
					// 通知 id は E2E から予測できないので id は載せず、**種別で引ける**ことを優先した
					// （e2e-web は .first()、Detox は atIndex(0) で先頭行＝最新の通知を掴む）。
					// これが無いと「vote 通知が一覧に出た」「押すと結果画面へ行く」を外から観測できない
					// （screens/NotificationsScreen.ts が「内容の検証が要るなら都度足すこと」と書いている通り）。
					testID={`notification-item-${item.notification.action_type}`}
					style={styles.notificationItem}
					onPress={isTargetDeleted ? undefined : () => handleNotificationPress(item)}
					disabled={isTargetDeleted}
					activeOpacity={0.7}>
					{/* Left: Avatar with Action Icon */}
					<View style={styles.avatarContainer}>
						{firstActor ? (
							<Image source={{ uri: avatar, cacheKey: getCacheKeyForImage(avatar) }} style={styles.avatar} />
						) : (
							// #1557 【設計】ゲストのアバターは ProfileHeader のゲスト表示と同じアプリアイコン
							<Image source={require("@/assets/images/icon.webp")} style={styles.avatar} />
						)}
						<View
							testID={`notification-icon-${item.notification.action_type}`}
							style={[styles.actionIcon, { backgroundColor: iconBgColor }]}>
							{getNotificationIcon(item.notification.action_type)}
						</View>
					</View>

					{/* Center: Message Content */}
					<View style={styles.messageContainer}>
						<Text style={styles.messageText} numberOfLines={2}>
							<Text style={styles.username}>{actorNames}</Text>
							<Text style={styles.message}> {message}</Text>
						</Text>
						{/* #450 【設計】DishReviewsSection と同様に dateStringToTimestamp で相対時間表示（xx秒前 / xx分前等） */}
						<Text style={styles.timestamp}>{dateStringToTimestamp(item.notification.created_at)}</Text>
					</View>

					{/* Right: Post Thumbnail */}
					{isTargetDeleted ? (
						/*
						#1513 サムネイルと同じ 50x50 / 角丸 12 の «枠» を先に作り、その中を墓標に埋めさせる。
						寸法を変えると行の高さが通知ごとに変わって一覧がガタつく。

						⚠️ 墓標へ直接 `style={{width:50,height:50}}` を渡してはいけない。墓標の既定は
						   `flex: 1` で、**web では CSS の `flex` 短縮形が効いて `flex-basis: 0%` になる**
						   ため、縦が主軸のこの枠では height が潰れて «平たい丸バッジ» になる
						   （エビデンス 1 周目で実測。`flex: 0` を足しても CSS では `0 1 0%` なので直らない）。
						   枠を外側の View で持てば、墓標は既定の flex:1 のままその枠を埋める。
						*/
						<View style={styles.deletedThumbnail}>
							<DeletedMediaTombstone
								variant="pin"
								testID={`notification-deleted-${item.notification.id}`}
							/>
						</View>
					) : (
						item.dishMediaEntries &&
						item.dishMediaEntries.dish_media.thumbnailImageUrl && (
							<View style={styles.rightContainer}>
								<Image
									source={{
										uri: item.dishMediaEntries.dish_media.thumbnailImageUrl,
										cacheKey: getCacheKeyForImage(item.dishMediaEntries.dish_media.thumbnailImageUrl),
									}}
									style={styles.postThumbnail}
								/>
							</View>
						)
					)}
				</TouchableOpacity>
			);
		},
		/*
		⚠️ `styles` を必ず入れること。web は hydration 前がライト固定で、その後ダークへ
		   解決し直される（hooks/useColorScheme.web.ts）。この配列から styles が漏れると
		   **行だけライトのまま白く残り、シートと地だけダークになる**（実測）。
		*/
		[styles, formatActorNames, getNotificationMessage, handleNotificationPress],
	);

	// #通知機能 【設計】匿名ユーザーまたは未認証ユーザーは空画面を表示
	// #1092 PR4b 判定は共通化（lib/authGuest.ts）。タブの表示可否と同じ式にしておく
	if (isGuestUser(user)) {
		return (
			<SafeAreaView style={styles.container} edges={["top"]}>
				<View style={styles.header}>
					{/* #1503 【テスト】ログイン済みの分岐と **同じ testID** を付けること。
					    直リンクスモーク（e2e-web tests/smoke/deep-link.spec.ts）と Detox の
					    SafeArea 実測（e2e-mobile tests/mutation/notifications-safe-area.test.ts）は
					    どちらもこの testID を «お知らせ画面が描画された印» にしている。
					    どちらのセッションも匿名なので、実際に評価されるのは **こちらの分岐**である。
					    testID がこちらに無いと «画面は出ているのにテストからは見えない» 状態になる */}
					<Text testID="notifications-header-title" style={styles.headerTitle}>
						{i18n.t("Notifications.title")}
					</Text>
				</View>
				<View style={styles.emptyContainer}>
					<Text style={styles.emptyText}>{i18n.t("Notifications.empty")}</Text>
				</View>
			</SafeAreaView>
		);
	}

	return (
		// #1130 edges は "top" のみ。下端はタブバー側（app/[locale]/(tabs)/_layout.tsx の
		// `safeAreaInsets`）が面倒を見ているので、ここで bottom を足すと二重に余白が入る。
		<SafeAreaView style={styles.container} edges={["top"]}>
			{/* Header */}
			<View style={styles.header}>
				{/* #1130 【テスト】ヘッダーの上端 y 座標を Detox から実測するための testID。
				    SafeArea へ食い込んでいないことは描画ツリー（__tests__/notificationsSafeArea.test.tsx）
				    では判定できず、実座標を読む必要があるため。見た目には影響しない */}
				<Text testID="notifications-header-title" style={styles.headerTitle}>
					{i18n.t("Notifications.title")}
				</Text>
				{unreadCount > 0 && (
					<View style={styles.unreadBadge}>
						<Text style={styles.unreadBadgeText}>{unreadCount}</Text>
					</View>
				)}
			</View>

			{/* Notifications List */}
			<View style={styles.notificationContainer}>
				<View style={styles.sheet}>
					{/* 初回ロードはリストをレンダリングせずローディング表示を出す */}
					{notifications.isLoadingInitial && notifications.items.length === 0 ? (
						<View style={styles.loadingContainer}>
							<LoadingIndicator size="large" />
						</View>
					) : (
						<FlatList
							data={notifications.items}
							renderItem={renderNotificationItem}
							keyExtractor={(item) => item.notification.id}
							onEndReached={notifications.loadMore}
							onEndReachedThreshold={0.5}
							// #1629 `refreshing` / `onRefresh` を直接渡すと RN が色を持たない RefreshControl を
							// 作り、ダークの地に OS 既定の暗いスピナーが出て見えない。GridList と同じ渡し方に揃える
							refreshControl={
								<RefreshControl
									refreshing={notifications.isLoadingInitial}
									onRefresh={notifications.refresh}
									colors={[colors.brand]}
									tintColor={colors.brand}
								/>
							}
							// 初回ロードが終わった後に表示する「空」表示
							ListEmptyComponent={
								<View style={styles.emptyContainer}>
									<Text style={styles.emptyText}>{i18n.t("Notifications.empty")}</Text>
								</View>
							}
							// フッターローダーは items が存在する場合にのみ表示する
							ListFooterComponent={
								notifications.isLoadingMore && notifications.items.length > 0 ? (
									<View style={styles.loadingContainer}>
										<LoadingIndicator size="small" />
										<Text style={styles.loadingText}>{i18n.t("Notifications.loadingMore")}</Text>
									</View>
								) : null
							}
							contentContainerStyle={styles.scrollContent}
						/>
					)}
				</View>
			</View>
		</SafeAreaView>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			backgroundColor: colors.background,
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "flex-start",
			paddingHorizontal: 16,
			paddingVertical: 16,
		},
		headerTitle: {
			fontSize: 20,
			fontWeight: "700",
			color: colors.textPrimary,
			letterSpacing: -0.5,
		},
		unreadBadge: {
			position: "absolute",
			right: 16,
			backgroundColor: colors.brand,
			borderRadius: 16,
			paddingHorizontal: 8,
			paddingVertical: 4,
			minWidth: 24,
			alignItems: "center",
			shadowColor: colors.brand,
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.3,
			shadowRadius: 8,
			elevation: 6,
		},
		unreadBadgeText: {
			fontSize: 13,
			fontWeight: "700",
			color: FixedColors.onFilled,
		},
		notificationContainer: {
			flex: 1,
			marginTop: 16,
			borderTopLeftRadius: 32,
			borderTopRightRadius: 32,
			shadowColor: FixedColors.shadow,
			shadowOffset: { width: 0, height: 0 },
			shadowOpacity: 0.1,
			shadowRadius: 24,
			elevation: 10,
		},
		sheet: {
			flex: 1,
			backgroundColor: colors.surface,
			borderTopLeftRadius: 32,
			borderTopRightRadius: 32,
			overflow: "hidden",
			paddingTop: 24,
		},
		scrollContent: {
			paddingHorizontal: 16,
			paddingBottom: 32,
		},
		notificationItem: {
			flexDirection: "row",
			alignItems: "center",
			borderBottomWidth: 1,
			borderBottomColor: colors.divider,
			backgroundColor: colors.surface,
			paddingVertical: 12,
			position: "relative",
		},
		avatarContainer: {
			position: "relative",
			marginRight: 12,
		},
		avatar: {
			width: 50,
			height: 50,
			borderRadius: 25,
			borderWidth: 1,
			borderColor: colors.surface,
		},
		actionIcon: {
			position: "absolute",
			bottom: -2,
			right: -2,
			width: 20,
			height: 20,
			borderRadius: 10,
			alignItems: "center",
			justifyContent: "center",
			borderWidth: 1,
			borderColor: colors.surface,
		},
		messageContainer: {
			flex: 1,
			marginRight: 12,
		},
		messageText: {
			fontSize: 15,
			lineHeight: 20,
			marginBottom: 4,
		},
		username: {
			fontWeight: "700",
			color: colors.textPrimary,
			letterSpacing: -0.2,
		},
		message: {
			color: colors.textSecondary,
			fontWeight: "400",
		},
		timestamp: {
			fontSize: 13,
			color: colors.textSecondary,
			fontWeight: "500",
		},
		rightContainer: {
			alignItems: "center",
			justifyContent: "center",
		},
		postThumbnail: {
			width: 50,
			height: 50,
			borderRadius: 12,
		},
		deletedThumbnail: {
			width: 50,
			height: 50,
			borderRadius: 12,
			// 角丸から墓標の面がはみ出さないように切る（中身は flex:1 で枠いっぱいに広がる）
			overflow: "hidden",
		},
		emptyContainer: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			paddingHorizontal: 32,
		},
		emptyText: {
			fontSize: 16,
			color: colors.textSecondary,
			textAlign: "center",
		},
		loadingContainer: {
			paddingVertical: 20,
			alignItems: "center",
		},
		loadingText: {
			marginTop: 8,
			fontSize: 14,
			color: colors.textSecondary,
		},
	});
