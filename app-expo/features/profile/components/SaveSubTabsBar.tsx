import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import i18n from "@/lib/i18n";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";

export function SaveSubTabsBar(props: TabBarProps) {
	const { tabNames, index, onTabPress } = props;
	const [currentIndex, setCurrentIndex] = React.useState(0);
	const lastRef = React.useRef<number>(-1);

	useAnimatedReaction(
		() => Math.round(index.value),
		(i) => {
			if (i !== lastRef.current) {
				lastRef.current = i;
				runOnJS(setCurrentIndex)(i);
			}
		},
		[],
	);

	const routes = React.useMemo(
		() =>
			tabNames.map((name) => ({
				key: name,
				title: i18n.t(`Profile.tabs.${name}`),
			})),
		[tabNames],
	);

	const jumpTo = (key: string) => {
		onTabPress(key);
	};

	return (
		<View style={styles.subTabsContainer}>
			{routes.map((route, routeIndex) => {
				const isActive = currentIndex === routeIndex;
				return (
					<TouchableOpacity
						key={route.key}
						style={[styles.subTab, isActive && styles.activeSubTab]}
						onPress={() => jumpTo(route.key)}>
						<Text style={[styles.subTabText, isActive && styles.activeSubTabText]}>{route.title}</Text>
					</TouchableOpacity>
				);
			})}
		</View>
	);
}

const styles = StyleSheet.create({
	subTabsContainer: {
		flexDirection: "row",
		marginHorizontal: 16,
		marginTop: 16,
		backgroundColor: "transparent",
	},
	subTab: {
		flex: 1,
		paddingVertical: 12,
		paddingHorizontal: 16,
		alignItems: "center",
		backgroundColor: "#F5F5F5",
		marginHorizontal: 4,
		borderRadius: 32,
	},
	activeSubTab: {
		backgroundColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
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
