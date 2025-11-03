import React, { useEffect, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { Heart, Bookmark } from "lucide-react-native";
import { useHaptics } from "@/hooks/useHaptics";
import { useNotifications } from "@/hooks/useNotifications";
import { useMarkNotificationsRead } from "@/hooks/useMarkNotificationsRead";
import { useRouter } from "expo-router";
import type { NotificationItem } from "@shared/api/v1/res";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * 🔔 通知一覧画面
 *
 * - GET /v1/notifications を利用してキーセットページング
 * - 画面入場時に一括既読処理
 * - 通知タップ時に対象画面に遷移
 * - 多言語対応（Intl.ListFormat でアクター名を表示）
 */
export default function NotificationsScreen() {
	const router = useRouter();
	const { lightImpact } = useHaptics();
	const { isAuthenticated, user } = useAuth();
	const notifications = useNotifications();
	const { markAllAsRead } = useMarkNotificationsRead();

	// #通知機能 【設計】画面入場時に通知を取得し、既読処理を実行
	useEffect(() => {
		if (isAuthenticated && user && !user.is_anonymous) {
			notifications.loadInitial();
			markAllAsRead();
		}
	}, [isAuthenticated, user?.is_anonymous, notifications.loadInitial, markAllAsRead]);

	// #通知機能 【仕様】通知タップ時の遷移処理
	const handleNotificationPress = useCallback(
		(notification: NotificationItem) => {
			lightImpact();

			// #通知機能 【設計】target_table に基づいて遷移先を判定
			const { target_table } = notification.notification;
			const { target } = notification;

			if (target_table === "dish_media" && target) {
				// #通知機能 【仕様】dish_media の場合は FoodContentFeed へ遷移
				// TODO: 適切な food コンテンツ画面のルーティングパスを確認する必要がある
				// 暫定的に文字列として扱う
				router.push(`/food/${target.dish_media.id}` as `/food/${string}`);
			}
			// #通知機能 【設計】他の target_table は今後追加予定
		},
		[lightImpact, router],
	);

	// #通知機能 【仕様】通知アイテムのアイコンを取得
	const getNotificationIcon = (actionType: string) => {
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
	const getIconBackgroundColor = (actionType: string) => {
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

		return message || action_type;
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
					{item.target && (
						<View style={styles.rightContainer}>
							<Image source={{ uri: item.target.dish_media.thumbnailImageUrl }} style={styles.postThumbnail} />
						</View>
					)}
				</TouchableOpacity>
			);
		},
		[formatActorNames, getNotificationMessage, handleNotificationPress],
	);

	// #通知機能 【設計】匿名ユーザーまたは未認証ユーザーは空画面を表示
	if (!isAuthenticated || !user || user.is_anonymous) {
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
