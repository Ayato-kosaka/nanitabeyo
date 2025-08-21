import React from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { SaveTopicTab } from "./save/SaveTopicTab";
import { SavePostTab } from "./save/SavePostTab";

const Tab = createMaterialTopTabNavigator();

export function SaveTab() {
	return (
		<Tab.Navigator
			screenOptions={{
				swipeEnabled: true,
				lazy: true,
				tabBarStyle: { display: "none" }, // Hide default TabBar
			}}>
			<Tab.Screen name="SaveTopic" component={SaveTopicTab} />
			<Tab.Screen name="SavePost" component={SavePostTab} />
		</Tab.Navigator>
	);
}
