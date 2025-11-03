import React, { useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { Heart, Bookmark } from "lucide-react-native";
import { useHaptics } from "@/hooks/useHaptics";
import { useNotifications } from "@/features/notifications/hooks/useNotifications";
import { useMarkNotificationsRead } from "@/features/notifications/hooks/useMarkNotificationsRead";
import { useRouter } from "expo-router";
import type { DishMediaEntry, NotificationItem, NotificationResponse } from "@shared/api/v1/res";
import { useAuth } from "@/contexts/AuthProvider";
import { useFocusEffect } from "expo-router";
import { useNotificationUnreadCount } from "@/features/notifications/hooks/useNotificationUnreadCount";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";

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
	const router = useRouter();
	const { lightImpact } = useHaptics();
	const { user } = useAuth();
	const notifications = useNotifications();
	const { markAllAsRead } = useMarkNotificationsRead();
	const { unreadCount, refresh: notificationUnreadCountRefresh } = useNotificationUnreadCount();
	const { setDishePromises } = useDishMediaEntriesStore();
	const locale = useLocale();

	// #通知機能 【設計】画面入場時に通知を取得し、未読数をリフレッシュして全件既読にする
	const inFlightRef = React.useRef(false);
	useFocusEffect(
		React.useCallback(() => {
			if (!user || user.is_anonymous) return;
			if (inFlightRef.current) return;
			inFlightRef.current = true;
			(async () => {
				try {
					await notifications.refresh();
					await notificationUnreadCountRefresh(); // 未読数リフレッシュが先
					await markAllAsRead(); // その後に全件既読
				} finally {
					// 少し遅らせて解放すると同一フレームの多重起動を吸収しやすい
					setTimeout(() => (inFlightRef.current = false), 0);
				}
			})();
			return () => {};
			// 依存関係はあえて省略。これらの関数は安定している（各フック内で useCallback されている）ため。
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [user?.id]),
	);

	// #通知機能 【仕様】通知タップ時の遷移処理
	const handleNotificationPress = useCallback(
		(notification: NotificationItem) => {
			lightImpact();

			// #通知機能 【設計】target_table に基づいて遷移先を判定
			const { target_table } = notification.notification;

			if (target_table === "dish_media" && notification.dishMediaEntiries !== undefined) {
				// #通知機能 【仕様】dish_media の場合は FoodContentFeed へ遷移
				const dishMediaEntries = notifications.items
					.map((n) => n.dishMediaEntiries)
					.filter((t): t is DishMediaEntry => !!t);
				const index = dishMediaEntries.findIndex(
					(d) => d.dish_media.id === notification.dishMediaEntiries?.dish_media.id,
				);
				setDishePromises("profile", Promise.resolve(dishMediaEntries));
				router.push({
					pathname: "/[locale]/(tabs)/notifications/food",
					params: { locale, startIndex: index },
				});
			}
			// #通知機能 【設計】他の target_table は今後追加予定
		},
		[lightImpact, router, notifications.items, setDishePromises, locale],
	);

	// #通知機能 【仕様】通知アイテムのアイコンを取得
	const getNotificationIcon = (actionType: NotificationResponse["action_type"]) => {
		const iconProps = { size: 13, color: "#FFFFFF" };

		switch (actionType) {
			case "like":
				return <Heart {...iconProps} fill="#FFFFFF" />;
			case "save":
				return <Bookmark {...iconProps} fill="#FFFFFF" />;
			default:
				return <Heart {...iconProps} />;
		}
	};

	// #通知機能 【仕様】通知アイテムのアイコン背景色を取得
	const getIconBackgroundColor = (actionType: NotificationResponse["action_type"]) => {
		switch (actionType) {
			case "like":
				return "#FF3040";
			case "save":
				return "#5856D6";
			default:
				return "#FF3040";
		}
	};

	// #通知機能 【仕様】アクター名を多言語対応で表示（Intl.ListFormat）
	const formatActorNames = useCallback((actors: NotificationItem["actors"]) => {
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
			const avatar = item.actors[0]?.avatar || "https://via.placeholder.com/50";

			return (
				<TouchableOpacity
					style={styles.notificationItem}
					onPress={() => handleNotificationPress(item)}
					activeOpacity={0.7}>
					{/* Left: Avatar with Action Icon */}
					<View style={styles.avatarContainer}>
						<Image source={{ uri: avatar }} style={styles.avatar} />
						<View style={[styles.actionIcon, { backgroundColor: iconBgColor }]}>
							{getNotificationIcon(item.notification.action_type)}
						</View>
					</View>

					{/* Center: Message Content */}
					<View style={styles.messageContainer}>
						<Text style={styles.messageText} numberOfLines={2}>
							<Text style={styles.username}>{actorNames}</Text>
							<Text style={styles.message}> {message}</Text>
						</Text>
						<Text style={styles.timestamp}>{new Date(item.notification.created_at).toLocaleDateString()}</Text>
					</View>

					{/* Right: Post Thumbnail */}
					{item.dishMediaEntiries && (
						<View style={styles.rightContainer}>
							<Image
								source={{ uri: item.dishMediaEntiries.dish_media.thumbnailImageUrl }}
								style={styles.postThumbnail}
							/>
						</View>
					)}
				</TouchableOpacity>
			);
		},
		[formatActorNames, getNotificationMessage, handleNotificationPress],
	);

	// #通知機能 【設計】匿名ユーザーまたは未認証ユーザーは空画面を表示
	if (!user || user.is_anonymous) {
		return (
			<SafeAreaView style={styles.container}>
				<View style={styles.header}>
					<Text style={styles.headerTitle}>{i18n.t("Notifications.title")}</Text>
				</View>
				<View style={styles.emptyContainer}>
					<Text style={styles.emptyText}>{i18n.t("Notifications.empty")}</Text>
				</View>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView style={styles.container}>
			{/* Header */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>{i18n.t("Notifications.title")}</Text>
				{unreadCount > 0 && (
					<View style={styles.unreadBadge}>
						<Text style={styles.unreadBadgeText}>{unreadCount}</Text>
					</View>
				)}
			</View>

			{/* Notifications List */}
			<View style={styles.notificationContainer}>
				<View style={styles.sheet}>
					<FlatList
						data={notifications.items}
						renderItem={renderNotificationItem}
						keyExtractor={(item) => item.notification.id}
						onEndReached={notifications.loadMore}
						onEndReachedThreshold={0.5}
						refreshing={notifications.isLoadingInitial}
						onRefresh={notifications.refresh}
						ListEmptyComponent={
							notifications.isLoadingInitial ? (
								<View style={styles.loadingContainer}>
									<ActivityIndicator size="large" color="#5EA2FF" />
								</View>
							) : (
								<View style={styles.emptyContainer}>
									<Text style={styles.emptyText}>{i18n.t("Notifications.empty")}</Text>
								</View>
							)
						}
						ListFooterComponent={
							notifications.isLoadingMore ? (
								<View style={styles.loadingContainer}>
									<ActivityIndicator size="small" color="#5EA2FF" />
									<Text style={styles.loadingText}>{i18n.t("Notifications.loadingMore")}</Text>
								</View>
							) : null
						}
						contentContainerStyle={styles.scrollContent}
					/>
				</View>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#fff",
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
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	unreadBadge: {
		position: "absolute",
		right: 16,
		backgroundColor: "#5EA2FF",
		borderRadius: 16,
		paddingHorizontal: 8,
		paddingVertical: 4,
		minWidth: 24,
		alignItems: "center",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 6,
	},
	unreadBadgeText: {
		fontSize: 13,
		fontWeight: "700",
		color: "#FFFFFF",
	},
	notificationContainer: {
		flex: 1,
		marginTop: 16,
		borderTopLeftRadius: 32,
		borderTopRightRadius: 32,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 10,
	},
	sheet: {
		flex: 1,
		backgroundColor: "#FFFFFF",
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
		borderBottomColor: "#E5E7EB",
		backgroundColor: "#FFFFFF",
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
		borderColor: "#FFFFFF",
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
		borderColor: "#FFFFFF",
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
		color: "#1A1A1A",
		letterSpacing: -0.2,
	},
	message: {
		color: "#6B7280",
		fontWeight: "400",
	},
	timestamp: {
		fontSize: 13,
		color: "#6B7280",
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
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingHorizontal: 32,
	},
	emptyText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
	loadingContainer: {
		paddingVertical: 20,
		alignItems: "center",
	},
	loadingText: {
		marginTop: 8,
		fontSize: 14,
		color: "#6B7280",
	},
});
