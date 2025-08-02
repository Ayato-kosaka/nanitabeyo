import { Tabs } from "expo-router";
import { House as Home, MapPinned, Bell, User, Code, Search } from "lucide-react-native";

const ICON_SIZE = 21; // ← 24 がデフォルト。ここを好きな値に

export default function TabLayout() {
	return (
		<Tabs
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
					title: "ホーム",
					href: null,
					tabBarIcon: ({ size, color }) => <Home size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="search"
				options={{
					title: "検索",
					tabBarIcon: ({ size, color }) => <Search size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="map"
				options={{
					title: "マップ",
					tabBarIcon: ({ size, color }) => <MapPinned size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="notifications"
				options={{
					title: "通知",
					tabBarIcon: ({ size, color }) => <Bell size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: "プロフィール",
					tabBarIcon: ({ size, color }) => <User size={ICON_SIZE} color={color} />,
				}}
			/>
		</Tabs>
	);
}
