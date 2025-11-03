import { Tabs } from "expo-router";
import { House as Home, MapPinned, Bell, User, Code, Search } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { View, Text, StyleSheet } from "react-native";
import { useNotificationUnreadCount } from "@/hooks/useNotificationUnreadCount";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";

const ICON_SIZE = 21; // ← 24 がデフォルト。ここを好きな値に

export default function TabLayout() {
	const { unreadCount, refresh } = useNotificationUnreadCount();

	// #通知機能 【設計】通知タブにフォーカスが当たるたびに未読数を更新
	useFocusEffect(
		useCallback(() => {
			refresh();
		}, [refresh]),
	);

	return (
		<Tabs
			initialRouteName="search"
			safeAreaInsets={{ bottom: 0, top: 0 }}
			screenOptions={{
				header: () => null,
				tabBarIconStyle: {
					display: "flex",
					flex: 1,
					justifyContent: "center",
				},
				tabBarStyle: {
					backgroundColor: "#fff",
					shadowColor: "#000",
					shadowOffset: { width: 0, height: -4 },
					shadowOpacity: 0.15,
					shadowRadius: 24,
					elevation: 12,
				},
				tabBarActiveTintColor: "#5EA2FF",
				tabBarInactiveTintColor: "#6B7280",
				tabBarShowLabel: false,
			}}>
			<Tabs.Screen
				name="home"
				options={{
					title: i18n.t("Tabs.home"),
					href: null,
					tabBarIcon: ({ size, color }) => <Home size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="search"
				options={{
					title: i18n.t("Tabs.search"),
					tabBarIcon: ({ size, color }) => <Search size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="map"
				options={{
					title: i18n.t("Tabs.map"),
					tabBarIcon: ({ size, color }) => <MapPinned size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="notifications"
				options={{
					title: i18n.t("Tabs.notifications"),
					tabBarIcon: ({ size, color }) => (
						<View>
							<Bell size={ICON_SIZE} color={color} />
							{unreadCount > 0 && (
								<View style={styles.badge}>
									<Text style={styles.badgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
								</View>
							)}
						</View>
					),
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: i18n.t("Tabs.profile"),
					tabBarIcon: ({ size, color }) => <User size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen name="posts" options={{ href: null }} />
		</Tabs>
	);
}

const styles = StyleSheet.create({
	badge: {
		position: "absolute",
		top: -4,
		right: -10,
		backgroundColor: "#FF3040",
		borderRadius: 10,
		minWidth: 18,
		height: 18,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 4,
	},
	badgeText: {
		color: "#FFFFFF",
		fontSize: 10,
		fontWeight: "700",
	},
});
