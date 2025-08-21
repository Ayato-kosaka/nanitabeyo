import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, FlatList } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ProfileHeader } from "../../components/ProfileHeader";
import { ProfileTabsBar } from "../../components/ProfileTabsBar";
import { WalletTabsBar } from "../../components/WalletTabsBar";
import { GridList } from "../../components/GridList";
import { useAuth } from "@/contexts/AuthProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { BidItem, mockBids } from "../../constants";
import i18n from "@/lib/i18n";

export function DepositsTab() {
	const { user } = useAuth();
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { BlurModal, open: openEditModal } = useBlurModal({ intensity: 100 });

	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	// Add wallet tab for own profile
	const availableTabs = isOwnProfile ? ["reviews", "saved", "liked", "wallet"] : ["reviews"];

	const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["active", "completed", "refunded"]);

	const depositStatuses = [
		{ id: "active", label: i18n.t("Profile.statusLabels.active"), color: "#4CAF50" },
		{ id: "completed", label: i18n.t("Profile.statusLabels.completed"), color: "#2196F3" },
		{ id: "refunded", label: i18n.t("Profile.statusLabels.refunded"), color: "#FF9800" },
	];

	// Event handlers
	const handleEditProfile = () => {
		lightImpact();
		openEditModal();
		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: { currentBioLength: profile.bio.length },
		});
	};

	const handleFollow = () => {
		mediumImpact();
		logFrontendEvent({
			event_name: "user_followed",
			error_level: "log",
			payload: {
				targetUserId: profile.id,
				targetUsername: profile.username,
				followersCount: profile.followersCount,
			},
		});
	};

	const toggleStatus = (statusId: string) => {
		lightImpact();
		setSelectedStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const filteredBids = mockBids.filter((bid) => selectedStatuses.includes(bid.status));

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

	// Render empty state
	const renderEmptyState = () => {
		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noDeposits")}</Text>
				</View>
			</View>
		);
	};

	// Create header with filter chips
	const renderHeader = () => {
		return (
			<>
				<ProfileHeader
					profile={profile}
					isOwnProfile={isOwnProfile}
					isFollowing={false}
					onEditProfile={handleEditProfile}
					onFollow={handleFollow}
				/>
				<ProfileTabsBar availableTabs={availableTabs as any} isOwnProfile={isOwnProfile} />
				<WalletTabsBar />
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
			</>
		);
	};

	return (
		<GridList
			data={filteredBids}
			numColumns={1}
			renderItem={renderBidItem}
			keyExtractor={(item) => item.id}
			ListEmptyComponent={renderEmptyState}
			ListHeaderComponent={renderHeader()}
			contentContainerStyle={styles.depositsList}
		/>
	);
}

const styles = StyleSheet.create({
	statusFilterContainer: {
		marginHorizontal: 16,
		marginTop: 16,
	},
	statusFilterContent: {
		paddingRight: 16,
	},
	statusFilterChip: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 20,
		backgroundColor: "#F5F5F5",
		marginRight: 8,
		borderWidth: 1,
		borderColor: "#E0E0E0",
	},
	statusFilterChipText: {
		fontSize: 14,
		color: "#666",
		fontWeight: "500",
	},
	statusFilterChipTextActive: {
		color: "#FFFFFF",
		fontWeight: "600",
	},
	depositsList: {
		paddingHorizontal: 16,
		paddingTop: 16,
	},
	depositCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 16,
		padding: 16,
		marginBottom: 12,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
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
	},
	depositInfo: {
		flex: 1,
	},
	depositRestaurantName: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 2,
	},
	depositAmount: {
		fontSize: 14,
		color: "#5EA2FF",
		fontWeight: "500",
	},
	statusChip: {
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 12,
	},
	statusText: {
		fontSize: 12,
		color: "#FFFFFF",
		fontWeight: "600",
	},
	depositDays: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "400",
	},
	emptyStateContainer: {
		flex: 1,
		paddingHorizontal: 16,
		paddingTop: 32,
	},
	emptyStateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 4,
	},
	emptyStateText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
		fontWeight: "500",
		lineHeight: 24,
	},
});
