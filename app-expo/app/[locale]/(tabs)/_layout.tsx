import { Tabs } from "expo-router";
import { Bell, User, Search, UtensilsCrossed } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useAuth } from "@/contexts/AuthProvider";
import { isGuestUser } from "@/lib/authGuest";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View } from "react-native";
import { FixedColors } from "@/constants/Palette";
import { useAppTheme } from "@/contexts/ThemeProvider";

const ICON_SIZE = 21;

export default function TabLayout() {
	const { user } = useAuth();
	const insets = useSafeAreaInsets();
	// #1509 タブバーは全画面に常駐する下地なので、基盤と同じ PR でテーマ対応する
	const { colors } = useAppTheme();

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
					// #1509 ライトでは `#fff`（= `surface` の `#FFFFFF`）と同一色。表記だけを揃えており見た目は変わらない
					backgroundColor: colors.surface,
					paddingTop: 4,
					shadowColor: FixedColors.shadow,
					shadowOffset: { width: 0, height: -4 },
					shadowOpacity: 0.15,
					shadowRadius: 24,
					elevation: 12,
				},
				tabBarActiveTintColor: colors.brand,
				tabBarInactiveTintColor: colors.textSecondary,
			}}>
			<Tabs.Screen
				name="search"
				options={{
					title: i18n.t("Tabs.search"),
					tabBarLabel: i18n.t("Tabs.labels.search"),
					// E2E テスト用: Web では data-testid として出力される
					tabBarButtonTestID: "tab-search",
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<Search size={ICON_SIZE} color={color} />
						</View>
					),
				}}
			/>
			<Tabs.Screen
				name="my-dishes"
				options={{
					title: i18n.t("Tabs.myDishes"),
					tabBarLabel: i18n.t("Tabs.labels.myDishes"),
					tabBarButtonTestID: "tab-my-dishes",
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<UtensilsCrossed size={ICON_SIZE} color={color} />
						</View>
					),
				}}
			/>
			<Tabs.Screen
				name="notifications"
				options={{
					title: i18n.t("Tabs.notifications"),
					tabBarLabel: i18n.t("Tabs.labels.notifications"),
					tabBarButtonTestID: "tab-notifications",
					tabBarIcon: ({ color }) => (
						<View style={{ marginVertical: 4 }}>
							<Bell size={ICON_SIZE} color={color} />
						</View>
					),
					// #1092 【設計】auth 未確定(user === null)を「ゲスト」と同じ扱いに寄せる。
					// `user?.is_anonymous` の truthy 判定だと未確定は falsy になり、通知タブが
					// **出てから消える**（タブ本数が変わりタブバー全体が再レイアウトする）。
					// #1419 でマップタブを削除したので、いまの本数は
					// search / my-dishes / notifications / profile の **4 本**、ゲストでは 3 本になる。
					// 出てから消えるより、出ない→出るの方が害が小さい。web の SSG は
					// user === null の状態を出力するので、その観点でもこちらが安全。
					//
					// #1092 PR4b 【修正】判定を `user?.is_anonymous !== false` から `isGuestUser()` へ寄せた。
					// 旧式は `is_anonymous` が undefined（型の上では optional）のときもゲストへ倒れるため、
					// **ログイン済みなのに通知タブが出ない**が起こりうる。判定の中身と理由は lib/authGuest.ts。
					href: isGuestUser(user) ? null : undefined,
				}}
			/>
			<Tabs.Screen
				name="profile"
				options={{
					title: i18n.t("Tabs.profile"),
					tabBarLabel: i18n.t("Tabs.labels.profile"),
					tabBarButtonTestID: "tab-profile",
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
