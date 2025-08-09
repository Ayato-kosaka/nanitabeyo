import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, SafeAreaView, Dimensions } from "react-native";
import i18n from "@/lib/i18n";
import { LinearGradient } from "expo-linear-gradient";
import { Heart, MessageCircle, UserPlus, AtSign, Share, MoveHorizontal as MoreHorizontal } from "lucide-react-native";
import { NotificationItem } from "@/types";
import { notificationsData } from "@/data/notificationsData";
import { useHaptics } from "@/hooks/useHaptics";

const { width } = Dimensions.get("window");

export default function NotificationsScreen() {
	const [notifications, setNotifications] = useState<NotificationItem[]>(notificationsData);
	const { lightImpact } = useHaptics();

	const getNotificationIcon = (type: NotificationItem["type"]) => {
		const iconProps = { size: 13, color: "#FFFFFF" };

		switch (type) {
			case "like":
				return <Heart {...iconProps} fill="#FFFFFF" />;
			case "comment":
				return <MessageCircle {...iconProps} />;
			case "follow":
				return <UserPlus {...iconProps} />;
			case "mention":
				return <AtSign {...iconProps} />;
			case "share":
				return <Share {...iconProps} />;
			default:
				return <Heart {...iconProps} />;
		}
	};

	const getIconBackgroundColor = (type: NotificationItem["type"]) => {
		switch (type) {
			case "like":
				return "#FF3040";
			case "comment":
				return "#007AFF";
			case "follow":
				return "#34C759";
			case "mention":
				return "#FF9500";
			case "share":
				return "#5856D6";
			default:
				return "#FF3040";
		}
	};

	const handleNotificationPress = (notification: NotificationItem) => {
		lightImpact();
		// Mark as read
		setNotifications((prev) => prev.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)));

		// Navigate to relevant content
		console.log("Navigate to:", notification);
	};

	const renderNotificationItem = (notification: NotificationItem) => {
		const iconBgColor = getIconBackgroundColor(notification.type);

		return (
			<TouchableOpacity
				key={notification.id}
				style={styles.notificationItem}
				onPress={() => handleNotificationPress(notification)}
				activeOpacity={0.7}>
				{/* Left: Avatar with Action Icon */}
				<View style={styles.avatarContainer}>
					<Image source={{ uri: notification.user.avatar }} style={styles.avatar} />
					<View style={[styles.actionIcon, { backgroundColor: iconBgColor }]}>
						{getNotificationIcon(notification.type)}
					</View>
				</View>

				{/* Center: Message Content */}
				<View style={styles.messageContainer}>
					<Text style={styles.messageText} numberOfLines={2}>
						<Text style={styles.username}>{notification.user.username}</Text>
						<Text style={styles.message}> {notification.message}</Text>
					</Text>
					<Text style={styles.timestamp}>{i18n.t("Notifications.timeAgo", { time: notification.timestamp })}</Text>
				</View>

				{/* Right: Post Thumbnail or More Options */}
				<View style={styles.rightContainer}>
					{notification.postThumbnail ? (
						<Image source={{ uri: notification.postThumbnail }} style={styles.postThumbnail} />
					) : (
						<TouchableOpacity style={styles.moreButton}>
							<MoreHorizontal size={20} color="#666" />
						</TouchableOpacity>
					)}
				</View>

				{/* Unread Indicator */}
				{!notification.isRead && <View style={styles.unreadDot} />}
			</TouchableOpacity>
		);
	};

	const unreadCount = notifications.filter((n) => !n.isRead).length;

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
				<ScrollView
					style={styles.scrollView}
					showsVerticalScrollIndicator={false}
					contentContainerStyle={styles.scrollContent}>
					{notifications.map(renderNotificationItem)}
				</ScrollView>
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
		backgroundColor: "#F8F9FA",
		marginTop: 16,
		borderTopLeftRadius: 32,
		borderTopRightRadius: 32,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 24,
		elevation: 10,
	},
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingHorizontal: 16,
		paddingTop: 32,
		gap: 12,
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
	notificationContent: {
		flexDirection: "row",
		alignItems: "center",
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
	moreButton: {
		width: 50,
		height: 50,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 12,
		backgroundColor: "#F8F9FA",
	},
	unreadDot: {
		position: "absolute",
		top: 4,
		right: 4,
		width: 16,
		height: 16,
		borderRadius: 8,
		backgroundColor: "#5EA2FF",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.5,
		shadowRadius: 12,
		elevation: 8,
	},
});
