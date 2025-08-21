import React from "react";
import { View, TouchableOpacity, StyleSheet } from "react-native";
import { Grid3x3 as Grid3X3, Bookmark, Heart, Wallet } from "lucide-react-native";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";

type TabType = "reviews" | "saved" | "liked" | "wallet";

interface ProfileTabsBarProps {
	availableTabs: TabType[];
	isOwnProfile: boolean;
}

export function ProfileTabsBar({ availableTabs, isOwnProfile }: ProfileTabsBarProps) {
	const navigation = useNavigation();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// Get current route index from navigation state
	const currentIndex = useNavigationState((state) => state.index);

	const handleTabPress = (tab: TabType, index: number) => {
		lightImpact();

		// Convert tab name to screen name for navigation
		const screenNames = {
			reviews: "Review",
			saved: "Save",
			liked: "Like",
			wallet: "Wallet",
		};

		const screenName = screenNames[tab];
		if (screenName) {
			navigation.navigate(screenName as never);
		}

		logFrontendEvent({
			event_name: "profile_tab_selected",
			error_level: "log",
			payload: {
				selectedTab: tab,
				isOwnProfile,
				tabIndex: index,
			},
		});
	};

	const renderTabIcon = (tab: TabType, index: number) => {
		const isActive = currentIndex === index;
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
			{availableTabs.map((tab, index) => (
				<TouchableOpacity
					key={tab}
					style={[styles.tab, currentIndex === index && styles.activeTab]}
					onPress={() => handleTabPress(tab, index)}>
					{renderTabIcon(tab, index)}
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
