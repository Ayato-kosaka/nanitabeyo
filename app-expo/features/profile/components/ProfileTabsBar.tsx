import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Grid3x3 as Grid3X3, Bookmark, Wallet, Heart } from "lucide-react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import i18n from "@/lib/i18n";
import { useSharedValueState } from "@/hooks/useSharedValueState";

export type RouteName = "reviews" | "saved-posts" | "saved-topics" | "liked" | "wallet-deposit" | "wallet-earning";

export type GroupName = "reviews" | "saved" | "liked" | "wallet";

const GROUP_ROUTES: Record<GroupName, RouteName[]> = {
	reviews: ["reviews"],
	saved: ["saved-posts", "saved-topics"],
	liked: ["liked"],
	wallet: ["wallet-deposit", "wallet-earning"],
};

export interface ProfileTabsBarProps extends TabBarProps<string> {
	availableTabs: GroupName[];
}

export function ProfileTabsBar({ tabNames, index, onTabPress, availableTabs }: ProfileTabsBarProps) {
	const currentIndex = useSharedValueState(index);
	const activeRoute = tabNames[currentIndex] ?? tabNames[0];

	const [lastRouteByGroup] = React.useState<Record<GroupName, RouteName>>({
		reviews: "reviews",
		saved: "saved-posts",
		liked: "liked",
		wallet: "wallet-deposit",
	});

	React.useEffect(() => {
		const entry = (Object.entries(GROUP_ROUTES) as [GroupName, RouteName[]][]).find(([, routes]) =>
			routes.includes(activeRoute as RouteName),
		);
		if (entry) {
			lastRouteByGroup[entry[0]] = activeRoute as RouteName;
		}
	}, [activeRoute, lastRouteByGroup]);

	const activeGroup = (Object.entries(GROUP_ROUTES) as [GroupName, RouteName[]][]).find(([, routes]) =>
		routes.includes(activeRoute as RouteName),
	)?.[0] as GroupName;

	const handleGroupPress = (group: GroupName) => {
		const target = lastRouteByGroup[group];
		onTabPress(target);
	};

	const renderIcon = (group: GroupName, isActive: boolean) => {
		const color = isActive ? "#5EA2FF" : "#666";
		switch (group) {
			case "reviews":
				return <Grid3X3 size={20} color={color} />;
			case "saved":
				return <Bookmark size={20} color={color} fill={isActive ? color : "transparent"} />;
			case "wallet":
				return <Wallet size={20} color={color} fill={isActive ? color : "transparent"} />;
			case "liked":
				return <Heart size={20} color={color} fill={isActive ? color : "transparent"} />;
		}
	};

	const renderSubTabs = () => {
		if (activeGroup === "saved" || activeGroup === "wallet") {
			const routes = GROUP_ROUTES[activeGroup];
			return (
				<View style={styles.subTabsContainer}>
					{routes.map((route) => {
						const isActive = activeRoute === route;
						return (
							<TouchableOpacity
								key={route}
								style={[styles.subTab, isActive && styles.activeSubTab]}
								onPress={() => onTabPress(route)}>
								<Text style={[styles.subTabText, isActive && styles.activeSubTabText]}>
									{i18n.t(`Profile.tabs.${route}`)}
								</Text>
							</TouchableOpacity>
						);
					})}
				</View>
			);
		}
		return null;
	};

	return (
		<View pointerEvents="box-none">
			<View style={styles.tabsContainer} pointerEvents="box-none">
				{availableTabs.map((group) => {
					const isActive = activeGroup === group;
					return (
						<TouchableOpacity
							key={group}
							style={[styles.tab, isActive && styles.activeTab]}
							onPress={() => handleGroupPress(group)}>
							{renderIcon(group, isActive)}
						</TouchableOpacity>
					);
				})}
			</View>
			{renderSubTabs()}
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
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 8,
	},
	activeTab: {
		borderBottomWidth: 2,
		borderBottomColor: "#5EA2FF",
	},
	subTabsContainer: {
		flexDirection: "row",
		marginHorizontal: 16,
		backgroundColor: "transparent",
	},
	subTab: {
		flex: 1,
		paddingVertical: 12,
		paddingHorizontal: 16,
		alignItems: "center",
	},
	activeSubTab: {},
	subTabText: {
		fontSize: 14,
		fontWeight: "500",
		color: "#6B7280",
	},
	activeSubTabText: {
		color: "#5EA2FF",
		fontWeight: "600",
	},
});
