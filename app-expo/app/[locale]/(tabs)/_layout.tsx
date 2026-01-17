import { Tabs } from "expo-router";
import { MapPinned, Bell, User, Search, Pencil } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";

const ICON_SIZE = 21;

export default function TabLayout() {
	const { user } = useAuth();
	const insets = useSafeAreaInsets();

	return (
		<Tabs
			initialRouteName="search"
			safeAreaInsets={{ bottom: insets.bottom, top: 0 }}
			screenOptions={{
				header: () => null,
				tabBarShowLabel: true,
				tabBarLabelStyle: {
					fontSize: 11,
				},
				tabBarIconStyle: {
					width: ICON_SIZE,
					height: ICON_SIZE,
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
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<Search size={ICON_SIZE} color={color} />
						</View>
					),
				}}
			/>
			<Tabs.Screen
				name="map"
				options={{
					title: i18n.t("Tabs.map"),
					tabBarLabel: i18n.t("Tabs.labels.map"),
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<MapPinned size={ICON_SIZE} color={color} />
						</View>
					),
				}}
			/>
			<Tabs.Screen
				name="review"
				options={{
					title: i18n.t("Tabs.review"),
					tabBarLabel: i18n.t("Tabs.labels.review"),
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<Pencil size={ICON_SIZE} color={color} />
						</View>
					),
				}}
			/>
			<Tabs.Screen
				name="notifications"
				options={{
					title: i18n.t("Tabs.notifications"),
					tabBarLabel: i18n.t("Tabs.labels.notifications"),
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<Bell size={ICON_SIZE} color={color} />
						</View>
					),
					href: user?.is_anonymous ? null : undefined,
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: i18n.t("Tabs.profile"),
					tabBarLabel: i18n.t("Tabs.labels.profile"),
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<User size={ICON_SIZE} color={color} />
						</View>
					),
				}}
			/>
			<Tabs.Screen name="posts" options={{ href: null }} />
		</Tabs>
	);
}
