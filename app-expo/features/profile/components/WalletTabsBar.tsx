import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Wallet, DollarSign } from "lucide-react-native";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useHaptics } from "@/hooks/useHaptics";
import i18n from "@/lib/i18n";

type WalletTabType = "deposits" | "earnings";

export function WalletTabsBar() {
	const navigation = useNavigation();
	const { lightImpact } = useHaptics();

	// Get current route index from navigation state
	const currentIndex = useNavigationState((state) => state.index);

	const handleTabPress = (tab: WalletTabType, index: number) => {
		lightImpact();

		// Convert tab name to screen name for navigation
		const screenNames = {
			deposits: "Deposits",
			earnings: "Earnings",
		};

		const screenName = screenNames[tab];
		if (screenName) {
			navigation.navigate(screenName as never);
		}
	};

	const tabs: { id: WalletTabType; label: string; icon: React.ComponentType<any> }[] = [
		{ id: "deposits", label: i18n.t("Profile.tabs.deposits"), icon: Wallet },
		{ id: "earnings", label: i18n.t("Profile.tabs.earnings"), icon: DollarSign },
	];

	return (
		<View style={styles.container}>
			{tabs.map((tab, index) => {
				const isActive = currentIndex === index;
				const IconComponent = tab.icon;
				return (
					<TouchableOpacity
						key={tab.id}
						style={[styles.tab, isActive && styles.activeTab]}
						onPress={() => handleTabPress(tab.id, index)}>
						<IconComponent size={20} color={isActive ? "#5EA2FF" : "#666"} />
						<Text style={[styles.tabText, isActive && styles.activeTabText]}>{tab.label}</Text>
					</TouchableOpacity>
				);
			})}
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flexDirection: "row",
		marginHorizontal: 16,
		marginTop: 16,
		backgroundColor: "transparent",
		shadowColor: "transparent",
		elevation: 0,
	},
	tab: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 16,
		paddingVertical: 12,
		gap: 8,
	},
	activeTab: {
		backgroundColor: "white",
		borderRadius: 32,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.1,
		shadowRadius: 16,
		elevation: 4,
	},
	tabText: {
		fontSize: 14,
		color: "#666",
		fontWeight: "500",
	},
	activeTabText: {
		color: "#5EA2FF",
		fontWeight: "600",
	},
});
