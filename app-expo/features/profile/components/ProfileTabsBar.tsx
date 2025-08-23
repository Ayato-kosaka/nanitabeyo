import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Grid3x3 as Grid3X3, Bookmark, Wallet, Heart } from "lucide-react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";

type TabType = "reviews" | "saved" | "liked" | "wallet";

export interface ProfileTabsBarProps extends TabBarProps<string> {
	availableTabs: TabType[];
}

export function ProfileTabsBar(props: ProfileTabsBarProps) {
	const { tabNames, index, onTabPress, availableTabs } = props;

	// Convert collapsible tab view props to our expected format
	const state = {
		index: index.value || 0,
		routes: tabNames.map((name) => ({ key: name })),
	};

	const jumpTo = (key: string) => {
		onTabPress(key);
	};

	const renderTabIcon = (tab: TabType) => {
		const isActive = state.routes[state.index]?.key === tab;
		const iconColor = isActive ? "#5EA2FF" : "#666";

		switch (tab) {
			case "reviews":
				return <Grid3X3 size={20} color={iconColor} />;
			case "saved":
				return <Bookmark size={20} color={iconColor} fill={isActive ? iconColor : "transparent"} />;
			case "wallet":
				return <Wallet size={20} color={iconColor} fill={isActive ? iconColor : "transparent"} />;
			case "liked":
				return <Heart size={20} color={iconColor} fill={isActive ? iconColor : "transparent"} />;
		}
	};

	return (
		<View style={styles.tabsContainer}>
			{availableTabs.map((tab) => (
				<TouchableOpacity
					key={tab}
					style={[styles.tab, state.routes[state.index]?.key === tab && styles.activeTab]}
					onPress={() => jumpTo(tab)}>
					{renderTabIcon(tab)}
				</TouchableOpacity>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	tabsContainer: {
		flexDirection: "row",
		marginHorizontal: 16,
		marginTop: 16,
		backgroundColor: "#FFFFFF",
	},
	tab: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 8,
		gap: 6,
	},
	activeTab: {
		borderBottomWidth: 2,
		borderBottomColor: "#5EA2FF",
	},
});
