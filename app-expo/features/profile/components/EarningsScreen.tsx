import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { EarningItem, mockEarnings } from "@/features/profile/constants";
import { ImageCardGrid } from "@/components/ImageCardGrid";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";

/**
 * EarningsScreen コンポーネント
 * プロフィール画面のウォレットタブ内の収益一覧を表示する
 */
export function EarningsScreen() {
	const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(["paid", "pending"]);
	const { lightImpact } = useHaptics();

	const earningStatuses = [
		{ id: "paid", label: i18n.t("Profile.statusLabels.paid"), color: "#4CAF50" },
		{ id: "pending", label: i18n.t("Profile.statusLabels.pending"), color: "#FF9800" },
	];

	const toggleEarningStatus = (statusId: string) => {
		lightImpact();
		setSelectedEarningStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const filteredEarnings = mockEarnings.filter((earning) => selectedEarningStatuses.includes(earning.status));

	return (
		<View style={styles.tabContent}>
			{/* Status Filter Chips */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={styles.statusFilterContainer}
				contentContainerStyle={styles.statusFilterContent}>
				{earningStatuses.map((status) => (
					<TouchableOpacity
						key={status.id}
						style={[
							styles.statusFilterChip,
							selectedEarningStatuses.includes(status.id) && {
								backgroundColor: status.color,
							},
						]}
						onPress={() => toggleEarningStatus(status.id)}>
						<Text
							style={[
								styles.statusFilterChipText,
								selectedEarningStatuses.includes(status.id) && styles.statusFilterChipTextActive,
							]}>
							{status.label}
						</Text>
					</TouchableOpacity>
				))}
			</ScrollView>

			{/* Filtered Results */}
			{filteredEarnings.length > 0 ? (
				<ImageCardGrid
					data={filteredEarnings}
					containerStyle={{ marginVertical: 16 }}
					renderOverlay={(item) => (
						<View style={styles.earningCardOverlay}>
							<Text style={styles.earningCardAmount}>
								{i18n.t("Search.currencySuffix")}
								{item.earnings.toLocaleString()}
							</Text>
							<View
								style={[
									styles.statusChip,
									{
										backgroundColor: item.status === "paid" ? "#4CAF50" : "#FF9800",
									},
								]}>
								<Text style={styles.statusText}>
									{item.status === "paid"
										? i18n.t("Profile.statusLabels.paid")
										: i18n.t("Profile.statusLabels.pending")}
								</Text>
							</View>
						</View>
					)}
				/>
			) : (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noEarnings")}</Text>
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
	earningCardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		padding: 8,
	},
	earningCardAmount: {
		fontSize: 15,
		fontWeight: "700",
		color: "#FFF",
		letterSpacing: -0.2,
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
