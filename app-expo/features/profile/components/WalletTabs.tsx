import React from "react";
import { Wallet, DollarSign } from "lucide-react-native";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { DepositsScreen } from "./DepositsScreen";
import { EarningsScreen } from "./EarningsScreen";
import i18n from "@/lib/i18n";

const Tab = createMaterialTopTabNavigator();

/**
 * WalletTabs コンポーネント
 * プロフィール画面のウォレットタブ内でデポジットと収益のタブナビゲーションを提供する
 */
export function WalletTabs() {
	return (
		<Tab.Navigator
			screenOptions={{
				tabBarActiveTintColor: "#5EA2FF",
				tabBarInactiveTintColor: "#666",
				tabBarStyle: {
					marginHorizontal: 16,
					marginTop: 16,
					backgroundColor: "transparent",
					shadowColor: "transparent",
					elevation: 0,
				},
				tabBarIndicatorStyle: {
					height: "100%",
					backgroundColor: "white",
					borderRadius: 32,
					shadowColor: "#000",
					shadowOffset: { width: 0, height: 0 },
					shadowOpacity: 0.1,
					shadowRadius: 16,
					elevation: 4,
				},
				tabBarItemStyle: {
					flexDirection: "row",
					paddingHorizontal: 16,
				},
				sceneStyle: {
					backgroundColor: "transparent",
				},
				// tabBarPressColor: 'transparent',
			}}>
			<Tab.Screen
				name="Deposits"
				component={DepositsScreen}
				options={{
					tabBarLabel: i18n.t("Profile.tabs.deposits"),
					tabBarIcon: ({ color }) => <Wallet size={20} color={color} />,
				}}
			/>
			<Tab.Screen
				name="Earnings"
				component={EarningsScreen}
				options={{
					tabBarLabel: i18n.t("Profile.tabs.earnings"),
					tabBarIcon: ({ color }) => <DollarSign size={20} color={color} />,
				}}
			/>
		</Tab.Navigator>
	);
}
