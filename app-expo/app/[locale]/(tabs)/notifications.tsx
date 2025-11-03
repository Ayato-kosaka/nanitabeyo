import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, FlatList, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import i18n from "@/lib/i18n";
import { Heart, BookmarkCheck } from "lucide-react-native";
import { useHaptics } from "@/hooks/useHaptics";
import { useCursorPagination } from "@/hooks/useCursorPagination";
import { useNotificationsAPI } from "@/hooks/useNotificationsAPI";
import type { NotificationItem } from "@shared/api/v1/res";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthProvider";
import FoodContentFeed from "@/components/FoodContentFeed";

export default function NotificationsScreen() {
	const { fetchNotifications, markAllAsRead, getUnreadCount } = useNotificationsAPI();
	const { lightImpact } = useHaptics();
	const router = useRouter();
	const { isAuthenticated, user } = useAuth();
	const [unreadCount, setUnreadCount] = useState(0);
	const [selectedDishMediaId, setSelectedDishMediaId] = useState<string | null>(null);

	// #通知機能 【設計】useCursorPagination で無限スクロール実装
	const {
		items: notifications,
		loadInitial,
		loadMore,
		refresh,
		isLoadingInitial,
		isLoadingMore,
		hasNextPage,
		error,
	} = useCursorPagination<{ limit?: number }, NotificationItem>(async ({ cursor }) => {
		const response = await fetchNotifications({ cursor: cursor ?? undefined, limit: 30 });
		return {
			data: response.items,
			nextCursor: response.nextCursor,
		};
	});

	// #通知機能 【設計】画面入場時に未読数を取得し、一括既読を実行
	useEffect(() => {
		if (!isAuthenticated || !user || user.is_anonymous) return;

		const initializeNotifications = async () => {
			try {
				// 未読数を取得
				const { unread } = await getUnreadCount();
				setUnreadCount(unread);

				// 通知一覧を読み込み
				await loadInitial();

				// #通知機能 【設計】未読が存在する場合のみ既読処理を実行
				if (unread > 0) {
					await markAllAsRead();
					setUnreadCount(0);
				}
			} catch (err) {
				console.error("Failed to initialize notifications:", err);
			}
		};

		initializeNotifications();
	}, [isAuthenticated, user?.id]);

	// #通知機能 【設計】通知アイコンの取得（action_type に基づく）
	const getNotificationIcon = (actionType: string) => {
		const iconProps = { size: 13, color: "#FFFFFF" };

		switch (actionType) {
			case "like":
				return <Heart {...iconProps} fill="#FFFFFF" />;
			case "save":
				return <BookmarkCheck {...iconProps} />;
			default:
				return <Heart {...iconProps} />;
		}
	};

	const getIconBackgroundColor = (actionType: string) => {
		switch (actionType) {
			case "like":
				return "#FF3040";
			case "save":
				return "#5EA2FF";
			default:
				return "#FF3040";
		}
	};

	// #通知機能 【設計】通知押下時の遷移処理（dish_media の場合は FoodContentFeed で表示）
	const handleNotificationPress = useCallback(
		(notification: NotificationItem) => {
			lightImpact();

			// target_table に基づいて遷移
			if (notification.notification.target_table === "dish_media" && notification.target) {
				// FoodContentFeed で表示
				setSelectedDishMediaId(notification.target.dish_media.id);
			}
		},
		[lightImpact],
	);

	const renderNotificationItem = ({ item }: { item: NotificationItem }) => {
		const iconBgColor = getIconBackgroundColor(item.notification.action_type);
		// #通知機能 【設計】通知メッセージは i18n_key で多言語化（notification.{target_table}.{action_type}）
		const messageKey = `notification.${item.notification.target_table}.${item.notification.action_type}`;
		const message = i18n.t(messageKey);

		// #通知機能 【設計】通知ユーザー名は actors[0].display_name を表示
		const actorName = item.actors[0]?.display_name || "Unknown";
		const actorAvatar = item.actors[0]?.avatar || "";

		// 作成日時を相対時間に変換
		const createdAt = new Date(item.notification.created_at);
		const now = new Date();
		const diffMs = now.getTime() - createdAt.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		let timeAgo = "";
		if (diffMins < 60) {
			timeAgo = `${diffMins}m`;
		} else if (diffHours < 24) {
			timeAgo = `${diffHours}h`;
		} else {
			timeAgo = `${diffDays}d`;
		}

		return (
			<TouchableOpacity
				style={styles.notificationItem}
				onPress={() => handleNotificationPress(item)}
				activeOpacity={0.7}>
				{/* Left: Avatar with Action Icon */}
				<View style={styles.avatarContainer}>
					<Image source={{ uri: actorAvatar }} style={styles.avatar} />
					<View style={[styles.actionIcon, { backgroundColor: iconBgColor }]}>
						{getNotificationIcon(item.notification.action_type)}
					</View>
				</View>

				{/* Center: Message Content */}
				<View style={styles.messageContainer}>
					<Text style={styles.messageText} numberOfLines={2}>
						<Text style={styles.username}>{actorName}</Text>
						<Text style={styles.message}> {message}</Text>
					</Text>
					<Text style={styles.timestamp}>{timeAgo}</Text>
				</View>

				{/* Right: Post Thumbnail */}
				<View style={styles.rightContainer}>
					{item.target?.dish_media.thumbnailImageUrl && (
						<Image source={{ uri: item.target.dish_media.thumbnailImageUrl }} style={styles.postThumbnail} />
					)}
				</View>
			</TouchableOpacity>
		);
	};

	const renderFooter = () => {
		if (!isLoadingMore) return null;
		return (
			<View style={styles.footer}>
				<ActivityIndicator size="small" color="#5EA2FF" />
			</View>
		);
	};

	const handleLoadMore = () => {
		if (hasNextPage && !isLoadingMore) {
			loadMore();
		}
	};

	// #通知機能 【設計】dish_media を FoodContentFeed で表示
	if (selectedDishMediaId) {
		const dishMediaItems = notifications
			.filter((item) => item.target && item.notification.target_table === "dish_media")
			.map((item) => item.target!);
		const initialIndex = dishMediaItems.findIndex((item) => item.dish_media.id === selectedDishMediaId);

		return (
			<FoodContentFeed
				items={dishMediaItems}
				initialIndex={initialIndex}
				onIndexChange={(index) => {
					// インデックス変更時の処理（必要に応じて）
				}}
				source="notifications"
			/>
		);
	}

	// 認証されていない場合
	if (!isAuthenticated || !user || user.is_anonymous) {
		return (
			<SafeAreaView style={styles.container}>
				<View style={styles.header}>
					<Text style={styles.headerTitle}>{i18n.t("Notifications.title")}</Text>
				</View>
				<View style={styles.emptyContainer}>
					<Text style={styles.emptyText}>{i18n.t("Notifications.loginRequired")}</Text>
				</View>
			</SafeAreaView>
		);
	}

	// 初期ロード中
	if (isLoadingInitial) {
		return (
			<SafeAreaView style={styles.container}>
				<View style={styles.header}>
					<Text style={styles.headerTitle}>{i18n.t("Notifications.title")}</Text>
				</View>
				<View style={styles.loadingContainer}>
					<ActivityIndicator size="large" color="#5EA2FF" />
				</View>
			</SafeAreaView>
		);
	}

	// エラー表示
	if (error) {
		return (
			<SafeAreaView style={styles.container}>
				<View style={styles.header}>
					<Text style={styles.headerTitle}>{i18n.t("Notifications.title")}</Text>
				</View>
				<View style={styles.emptyContainer}>
					<Text style={styles.emptyText}>{i18n.t("Notifications.error")}</Text>
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
						data={notifications}
						renderItem={renderNotificationItem}
						keyExtractor={(item) => item.notification.id}
						contentContainerStyle={styles.scrollContent}
						onEndReached={handleLoadMore}
						onEndReachedThreshold={0.5}
						ListFooterComponent={renderFooter}
						ListEmptyComponent={
							<View style={styles.emptyContainer}>
								<Text style={styles.emptyText}>{i18n.t("Notifications.empty")}</Text>
							</View>
						}
						refreshing={false}
						onRefresh={refresh}
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
		paddingTop: 64,
	},
	scrollContent: {
		paddingHorizontal: 16,
		paddingBottom: 16,
	},
	notificationItem: {
		flexDirection: "row",
		alignItems: "center",
		borderBottomWidth: 1,
		borderBottomColor: "#E5E7EB",
		backgroundColor: "#FFFFFF",
		paddingVertical: 8,
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
	footer: {
		paddingVertical: 16,
		alignItems: "center",
	},
	loadingContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
	},
	emptyContainer: {
		flex: 1,
		justifyContent: "center",
		alignItems: "center",
		paddingVertical: 48,
	},
	emptyText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
});
