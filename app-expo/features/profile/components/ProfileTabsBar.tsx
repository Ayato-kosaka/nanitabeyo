import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { Utensils, Bookmark, Wallet, Heart } from "lucide-react-native";
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

function getGroupByRoute(route: RouteName): GroupName | undefined {
	return (Object.entries(GROUP_ROUTES) as [GroupName, RouteName[]][]).find(([, routes]) => routes.includes(route))?.[0];
}

export function ProfileTabsBar({ tabNames, index, onTabPress, availableTabs }: ProfileTabsBarProps) {
	const currentIndex = useSharedValueState(index);
	const activeRoute = tabNames[currentIndex] ?? tabNames[0];

	const lastRouteByGroupRef = React.useRef<Record<GroupName, RouteName>>({
		reviews: "reviews",
		saved: "saved-posts",
		liked: "liked",
		wallet: "wallet-deposit",
	});
	const pendingPressedRouteRef = React.useRef<RouteName | null>(null);

	React.useEffect(() => {
		const route = activeRoute as RouteName;
		const group = getGroupByRoute(route);
		if (!group) {
			return;
		}

		const pendingPressedRoute = pendingPressedRouteRef.current;
		if (pendingPressedRoute) {
			if (route === pendingPressedRoute) {
				lastRouteByGroupRef.current[group] = route;
				pendingPressedRouteRef.current = null;
			}
			return;
		}

		lastRouteByGroupRef.current[group] = route;
	}, [activeRoute]);

	const activeGroup = getGroupByRoute(activeRoute as RouteName);

	const pressRoute = React.useCallback(
		(route: RouteName) => {
			const group = getGroupByRoute(route);
			if (group) {
				lastRouteByGroupRef.current[group] = route;
			}
			pendingPressedRouteRef.current = route === activeRoute ? null : route;
			onTabPress(route);
		},
		[activeRoute, onTabPress],
	);

	const handleGroupPress = (group: GroupName) => {
		pressRoute(lastRouteByGroupRef.current[group]);
	};

	const renderIcon = (group: GroupName, isActive: boolean) => {
		const color = isActive ? "#F05537" : "#666";
		switch (group) {
			case "reviews":
				return <Utensils size={20} color={color} />;
			case "saved":
				return <Bookmark size={20} color={color} fill={isActive ? color : "transparent"} />;
			case "wallet":
				return <Wallet size={20} color={color} fill={isActive ? color : "transparent"} />;
			case "liked":
				return <Heart size={20} color={color} fill={isActive ? color : "transparent"} />;
		}
	};

	// #946 【仕様】上段グループタブはアイコンのみで「保存」等の概念がUIに現れず、
	// 空状態文言("保存"で見返せます等)と用語が食い違って見えていた。
	// レビューで可視テキストラベルの追加はタブ段のレイアウトを崩すと指摘されたため、
	// 見た目はアイコンのみのまま、accessibilityLabel のみで概念をスクリーンリーダーに伝える。
	const groupLabel = (group: GroupName) => i18n.t(`Profile.tabGroups.${group}`);

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
								onPress={() => pressRoute(route)}>
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
							onPress={() => handleGroupPress(group)}
							accessibilityRole="tab"
							accessibilityState={{ selected: isActive }}
							accessibilityLabel={groupLabel(group)}
							testID={`profile-tab-group-${group}`}>
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
		borderBottomColor: "#F05537",
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
		color: "#F05537",
		fontWeight: "600",
	},
});
