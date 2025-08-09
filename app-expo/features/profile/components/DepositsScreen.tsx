import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, FlatList } from "react-native";
import { BidItem, mockBids } from "@/features/profile/constants";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

/**
 * DepositsScreen コンポーネント
 * プロフィール画面のウォレットタブ内の入札(デポジット)一覧を表示する
 */
export function DepositsScreen() {
	const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["active", "completed", "refunded"]);
	const { lightImpact } = useHaptics();

	const depositStatuses = [
		{ id: "active", label: i18n.t("Profile.statusLabels.active"), color: "#4CAF50" },
		{ id: "completed", label: i18n.t("Profile.statusLabels.completed"), color: "#2196F3" },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: "#FF9800" },
	];

	const toggleStatus = (statusId: string) => {
		lightImpact();
		setSelectedStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const filteredBids = mockBids.filter((bid) => selectedStatuses.includes(bid.status));

	const renderBidItem = ({ item }: { item: BidItem }) => (
		<View style={styles.depositCard}>
			<View style={styles.depositHeader}>
				<Image
					source={{ uri: item.restaurantImageUrl }}
					style={styles.depositAvatar}
					onError={() => console.log("Failed to load restaurant image")}
				/>
				<View style={styles.depositInfo}>
					<Text style={styles.depositRestaurantName}>{item.restaurantName}</Text>
					<Text style={styles.depositAmount}>
						{i18n.t("Search.currencySuffix")}
						{item.bidAmount.toLocaleString()}
					</Text>
				</View>
				<View style={[styles.statusChip, { backgroundColor: getStatusColor(item.status) }]}>
					<Text style={styles.statusText}>{getStatusText(item.status)}</Text>
				</View>
			</View>
			<Text style={styles.depositDays}>{i18n.t("Common.daysRemaining", { count: item.remainingDays })}</Text>
		</View>
	);

	const getStatusColor = (status: string) => {
		switch (status) {
			case "active":
				return "#4CAF50";
			case "completed":
				return "#2196F3";
			case "refunded":
				return "#FF9800";
			default:
				return "#666";
		}
	};

	const getStatusText = (status: string) => {
		switch (status) {
			case "active":
				return i18n.t("Profile.statusLabels.active");
			case "completed":
				return i18n.t("Profile.statusLabels.completed");
			case "refunded":
				return i18n.t("Profile.statusLabels.refunded");
			default:
				return status;
		}
	};

	return (
		<View style={styles.tabContent}>
			{/* Status Filter Chips */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{depositStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[
							styles.statusFilterChip,
							selectedStatuses.includes(status.id) && {
								backgroundColor: status.color,
							},
						]}
						onPress={() => toggleStatus(status.id)}>
						<Text
							style={[
								styles.statusFilterChipText,
								selectedStatuses.includes(status.id) && styles.statusFilterChipTextActive,
							]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>

			{/* Filtered Results */}
			{filteredBids.length > 0 ? (
				<FlatList
					data={filteredBids}
					renderItem={renderBidItem}
					keyExtractor={(item) => item.id}
					contentContainerStyle={styles.depositsList}
					showsVerticalScrollIndicator={false}
					scrollEnabled={false}
				/>
			) : (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDeposits")}</Text>
					</View>
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	tabContent: {
		flex: 1,
	},
	depositsList: {
		padding: 16,
	},
	depositCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 16,
		padding: 16,
		marginBottom: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	depositHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 8,
	},
	depositAvatar: {
		width: 40,
		height: 40,
		borderRadius: 20,
		marginRight: 12,
		borderWidth: 2,
		borderColor: "#FFFFFF",
	},
	depositInfo: {
		flex: 1,
	},
	depositRestaurantName: {
		fontSize: 14,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 2,
		letterSpacing: -0.3,
	},
	depositAmount: {
		fontSize: 16,
		fontWeight: "700",
		color: "#5EA2FF",
		letterSpacing: -0.3,
	},
	depositDays: {
		fontSize: 15,
		color: "#6B7280",
		fontWeight: "500",
	},
	statusChip: {
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	statusText: {
		fontSize: 13,
		color: "#FFFFFF",
		fontWeight: "600",
	},
	statusFilterContainer: {
		flexGrow: 0,
		paddingTop: 8,
		paddingHorizontal: 16,
	},
	statusFilterContent: {
		gap: 8,
	},
	statusFilterChip: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 16,
		backgroundColor: "#EDEFF1",
		marginHorizontal: 4,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	statusFilterChipText: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	statusFilterChipTextActive: {
		color: "#FFF",
		fontWeight: "600",
	},
	emptyStateContainer: {
		flex: 1,
		padding: 16,
	},
	emptyStateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	emptyStateText: {
		fontSize: 17,
		color: "#6B7280",
		textAlign: "center",
		fontWeight: "500",
	},
});
