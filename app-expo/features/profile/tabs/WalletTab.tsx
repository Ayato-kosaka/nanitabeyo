import React from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { DepositsTab } from "./wallet/DepositsTab";
import { EarningsTab } from "./wallet/EarningsTab";

const Tab = createMaterialTopTabNavigator();

export function WalletTab() {
	return (
		<Tab.Navigator
			screenOptions={{
				swipeEnabled: true,
				lazy: true,
				tabBarStyle: { display: "none" }, // Hide default TabBar
			}}>
			<Tab.Screen name="Deposits" component={DepositsTab} />
			<Tab.Screen name="Earnings" component={EarningsTab} />
		</Tab.Navigator>
	);
}
