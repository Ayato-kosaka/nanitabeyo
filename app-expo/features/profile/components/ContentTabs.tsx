import React from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";
import { Grid3x3 as Grid3X3, Bookmark, Wallet, Heart } from "lucide-react-native";

type TabType = "posts" | "saved" | "liked" | "wallet";

interface ContentTabsProps {
	selectedTab: TabType;
	availableTabs: TabType[];
	onTabSelect: (tab: TabType) => void;
}

/**
 * ContentTabs コンポーネント
 * プロフィール画面のコンテンツタブ（投稿、保存済み、いいね、ウォレット）を表示する
 */
export function ContentTabs({ selectedTab, availableTabs, onTabSelect }: ContentTabsProps) {
	const renderTabIcon = (tab: TabType) => {
		const isActive = selectedTab === tab;
		const iconColor = isActive ? "#5EA2FF" : "#666";

		switch (tab) {
			case "posts":
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
					style={[styles.tab, selectedTab === tab && styles.activeTab]}
					onPress={() => onTabSelect(tab)}>
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
