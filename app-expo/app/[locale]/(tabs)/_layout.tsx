import { Tabs } from "expo-router";
import { MapPinned, Bell, User, Search, Pencil } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ICON_SIZE = 21; // ← 24 がデフォルト。ここを好きな値に

export default function TabLayout() {
	const { user } = useAuth();
	const insets = useSafeAreaInsets();
	return (
		<Tabs
			initialRouteName="search"
			safeAreaInsets={{ bottom: insets.bottom, top: 0 }}
			screenOptions={{
				header: () => null,
				tabBarIconStyle: {
					display: "flex",
					flex: 1,
					justifyContent: "center",
				},
				tabBarShowLabel: true,
				tabBarLabelStyle: {
					fontSize: 11,
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
			}}>
			<Tabs.Screen
				name="search"
				options={{
					title: i18n.t("Tabs.search"),
					tabBarLabel: i18n.t("Tabs.labels.search"),
					tabBarIcon: ({ size, color }) => <Search size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="map"
				options={{
					title: i18n.t("Tabs.map"),
					tabBarLabel: i18n.t("Tabs.labels.map"),
					tabBarIcon: ({ size, color }) => <MapPinned size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="review"
				options={{
					title: i18n.t("Tabs.review"),
					tabBarLabel: i18n.t("Tabs.labels.review"),
					tabBarIcon: ({ size, color }) => <Pencil size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen
				name="notifications"
				options={{
					title: i18n.t("Tabs.notifications"),
					tabBarLabel: i18n.t("Tabs.labels.notifications"),
					tabBarIcon: ({ size, color }) => <Bell size={ICON_SIZE} color={color} />,
					href: user?.is_anonymous ? null : undefined,
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: i18n.t("Tabs.profile"),
					tabBarLabel: i18n.t("Tabs.labels.profile"),
					tabBarIcon: ({ size, color }) => <User size={ICON_SIZE} color={color} />,
				}}
			/>
			<Tabs.Screen name="posts" options={{ href: null }} />
		</Tabs>
	);
}
