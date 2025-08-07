import { Tabs } from "expo-router";
import { House as Home, MapPinned, Bell, User, Code, Search } from "lucide-react-native";
import i18n from "@/lib/i18n";

const ICON_SIZE = 21; // ← 24 がデフォルト。ここを好きな値に

export default function TabLayout() {
	return (
		<Tabs
			initialRouteName="search"
			screenOptions={{
				headerShown: false,
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
				name="(home)"
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
					tabBarIcon: ({ size, color }) => <Bell size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: i18n.t("Tabs.profile"),
					tabBarIcon: ({ size, color }) => <User size={ICON_SIZE} color={color} />,
				}}
			/>
		</Tabs>
	);
}
