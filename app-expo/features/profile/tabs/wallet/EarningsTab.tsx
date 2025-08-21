import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ProfileHeader } from "../../components/ProfileHeader";
import { ProfileTabsBar } from "../../components/ProfileTabsBar";
import { WalletTabsBar } from "../../components/WalletTabsBar";
import { GridList } from "../../components/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import { useAuth } from "@/contexts/AuthProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { EarningItem, mockEarnings } from "../../constants";
import i18n from "@/lib/i18n";

export function EarningsTab() {
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

	const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(["paid", "pending"]);

	const earningStatuses = [
		{ id: "paid", label: i18n.t("Profile.statusLabels.paid"), color: "#4CAF50" },
		{ id: "pending", label: i18n.t("Profile.statusLabels.pending"), color: "#FF9800" },
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

	const toggleEarningStatus = (statusId: string) => {
		lightImpact();
		setSelectedEarningStatuses((prev) =>
			prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
		);
	};

	const filteredEarnings = mockEarnings.filter((earning) => selectedEarningStatuses.includes(earning.status));

	// Convert EarningItem to ImageCardItem format
	const convertToImageCardItem = (item: EarningItem) => ({
		id: item.id,
		imageUrl: item.imageUrl,
	});

	const renderEarningItem = ({ item }: { item: EarningItem }) => {
		return (
			<ImageCard
				item={convertToImageCardItem(item)}
				onPress={() => {
					lightImpact();
					logFrontendEvent({
						event_name: "earning_item_selected",
						error_level: "log",
						payload: { item },
					});
				}}>
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
							{item.status === "paid" ? i18n.t("Profile.statusLabels.paid") : i18n.t("Profile.statusLabels.pending")}
						</Text>
					</View>
				</View>
			</ImageCard>
		);
	};

	// Render empty state
	const renderEmptyState = () => {
		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noEarnings")}</Text>
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
			</>
		);
	};

	return (
		<GridList
			data={filteredEarnings}
			numColumns={3}
			renderItem={renderEarningItem}
			keyExtractor={(item) => item.id}
			ListEmptyComponent={renderEmptyState}
			ListHeaderComponent={renderHeader()}
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
	earningCardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		padding: 8,
	},
	earningCardAmount: {
		fontSize: 14,
		color: "#FFFFFF",
		fontWeight: "600",
		marginBottom: 4,
	},
	statusChip: {
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 8,
		alignSelf: "flex-start",
	},
	statusText: {
		fontSize: 10,
		color: "#FFFFFF",
		fontWeight: "600",
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
