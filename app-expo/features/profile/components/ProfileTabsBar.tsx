import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Grid3x3 as Grid3X3, Bookmark, Wallet, Heart } from "lucide-react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import { useAnimatedReaction, runOnJS } from "react-native-reanimated";

type TabType = "reviews" | "saved" | "liked" | "wallet";

export interface ProfileTabsBarProps extends TabBarProps<string> {
	availableTabs: TabType[];
}

export function ProfileTabsBar(props: ProfileTabsBarProps) {
	const { tabNames, index, onTabPress, availableTabs } = props;
	const [currentIndex, setCurrentIndex] = React.useState(0);

	useAnimatedReaction(
		() => Math.round(index.value),
		(i) => {
			// 同じ値での無駄な setState を抑止
			runOnJS(setCurrentIndex)(i);
		},
		[],
	);

	const activeKey = tabNames[currentIndex] ?? tabNames[0];

	const jumpTo = (key: string) => {
		onTabPress(key);
	};

	const renderTabIcon = (tab: TabType) => {
		const isActive = activeKey === tab;
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
					style={[styles.tab, activeKey === tab && styles.activeTab]}
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
