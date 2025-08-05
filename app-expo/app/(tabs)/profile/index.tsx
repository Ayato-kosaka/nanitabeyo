import React, { useState } from "react";
import {
	View,
	Text,
	StyleSheet,
	ScrollView,
	TouchableOpacity,
	Image,
	Dimensions,
	FlatList,
	TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
	ArrowLeft,
	Settings,
	Share,
	Pencil as Edit3,
	Heart,
	MessageCircle,
	Lock,
	Grid3x3 as Grid3X3,
	Bookmark,
	X,
	Wallet,
	DollarSign,
} from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { UserProfile, UserPost } from "@/types";
import { userProfile, otherUserProfile, userPosts, savedPosts, likedPosts } from "@/data/profileData";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { useBlurModal } from "@/hooks/useBlurModal";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ImageCardGrid } from "@/components/ImageCardGrid";
import { BidItem, EarningItem, mockBids, mockEarnings } from "@/features/profile/constants";
import Stars from "@/components/Stars";

const { width } = Dimensions.get("window");
const Tab = createMaterialTopTabNavigator();

type TabType = "posts" | "saved" | "liked" | "wallet";

function DepositsScreen() {
	const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["active", "completed", "refunded"]);

	const depositStatuses = [
		{ id: "active", label: "アクティブ", color: "#4CAF50" },
		{ id: "completed", label: "完了", color: "#2196F3" },
		{ id: "refunded", label: "返金済み", color: "#FF9800" },
	];

	const toggleStatus = (statusId: string) => {
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
					<Text style={styles.depositAmount}>¥{item.bidAmount.toLocaleString()}</Text>
				</View>
				<View style={[styles.statusChip, { backgroundColor: getStatusColor(item.status) }]}>
					<Text style={styles.statusText}>{getStatusText(item.status)}</Text>
				</View>
			</View>
			<Text style={styles.depositDays}>残り{item.remainingDays}日</Text>
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
				return "アクティブ";
			case "completed":
				return "完了";
			case "refunded":
				return "返金済み";
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
				/>
			) : (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>選択したステータスの入札がありません</Text>
					</View>
				</View>
			)}
		</View>
	);
}

function EarningsScreen() {
	const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(["paid", "pending"]);

	const earningStatuses = [
		{ id: "paid", label: "支払済み", color: "#4CAF50" },
		{ id: "pending", label: "保留中", color: "#FF9800" },
	];

	const toggleEarningStatus = (statusId: string) => {
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
							<Text style={styles.earningCardAmount}>¥{item.earnings.toLocaleString()}</Text>
							<View
								style={[
									styles.statusChip,
									{
										backgroundColor: item.status === "paid" ? "#4CAF50" : "#FF9800",
									},
								]}>
								<Text style={styles.statusText}>{item.status === "paid" ? "支払済み" : "保留中"}</Text>
							</View>
						</View>
					)}
				/>
			) : (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>選択したステータスの収益がありません</Text>
					</View>
				</View>
			)}
		</View>
	);
}

function WalletTabs() {
	return (
		<Tab.Navigator
			screenOptions={{
				tabBarActiveTintColor: "#5EA2FF",
				tabBarInactiveTintColor: "#666",
				tabBarStyle: {
					marginHorizontal: 16,
					marginTop: 16,
					backgroundColor: "transparent",
					shadowColor: "transparent",
					elevation: 0,
				},
				tabBarIndicatorStyle: {
					height: "100%",
					backgroundColor: "white",
					borderRadius: 32,
					shadowColor: "#000",
					shadowOffset: { width: 0, height: 0 },
					shadowOpacity: 0.1,
					shadowRadius: 16,
					elevation: 4,
				},
				tabBarItemStyle: {
					flexDirection: "row",
					paddingHorizontal: 16,
				},
				sceneStyle: {
					backgroundColor: "transparent",
				},
				// tabBarPressColor: 'transparent',
			}}>
			<Tab.Screen
				name="Deposits"
				component={DepositsScreen}
				options={{
					tabBarLabel: "入札",
					tabBarIcon: ({ color }) => <Wallet size={20} color={color} />,
				}}
			/>
			<Tab.Screen
				name="Earnings"
				component={EarningsScreen}
				options={{
					tabBarLabel: "収益",
					tabBarIcon: ({ color }) => <DollarSign size={20} color={color} />,
				}}
			/>
		</Tab.Navigator>
	);
}

export default function ProfileScreen() {
	const { userId } = useLocalSearchParams();
	const [selectedTab, setSelectedTab] = useState<TabType>("posts");
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const [editedBio, setEditedBio] = useState("");
	const [isFollowing, setIsFollowing] = useState(false);

	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	React.useEffect(() => {
		if (profile && !isOwnProfile) {
			setIsFollowing(profile.isFollowing || false);
		}
	}, [profile, isOwnProfile]);

	// Add wallet tab for own profile
	const availableTabs: TabType[] = isOwnProfile ? ["posts", "saved", "liked", "wallet"] : ["posts"];

	const formatNumber = (num: number): string => {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
		}
		if (num >= 1000) {
			return (num / 1000).toFixed(1).replace(/\.0$/, "") + "K";
		}
		return num.toString();
	};

	const getCurrentPosts = (): UserPost[] => {
		switch (selectedTab) {
			case "posts":
				return userPosts;
			case "saved":
				return savedPosts;
			case "wallet":
				return [];
			case "liked":
				return likedPosts;
			default:
				return userPosts;
		}
	};

	const handleFollow = () => {
		setIsFollowing(!isFollowing);
	};

	const handleEditProfile = () => {
		setEditedBio(profile.bio);
		openEditModal();
	};

	const handleSaveProfile = () => {
		// In a real app, this would update the profile via API
		console.log("Saving profile with bio:", editedBio);
		closeEditModal();
	};

	const handleShareProfile = () => {
		console.log("Sharing profile:", profile.username);
	};

	const handlePostPress = (index: number) => {
		router.push(`/(tabs)/profile/food?startIndex=${index}`);
	};

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

	const shouldShowTab = (tab: TabType): boolean => {
		if (isOwnProfile) return true;
		// For other users, only show posts tab
		return tab === "posts";
	};

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header */}
			<View style={styles.header}>
				{!isOwnProfile && (
					<TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
						<ArrowLeft size={24} color="#1A1A1A" />
					</TouchableOpacity>
				)}
				<Text style={styles.headerTitle}>{profile.username}</Text>
				<View style={{ flexDirection: "row", gap: 8 }}>
					<TouchableOpacity style={styles.shareButton} onPress={handleShareProfile}>
						<Share size={24} color="#666" />
					</TouchableOpacity>
					<TouchableOpacity style={styles.settingButton}>
						<Settings size={24} color="#666" />
					</TouchableOpacity>
				</View>
			</View>

			<ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
				{/* Profile Info */}
				<Card>
					{/* Avatar and Stats */}
					<View style={styles.profileHeader}>
						<Image source={{ uri: profile.avatar }} style={styles.avatar} />

						<View style={styles.statsContainer}>
							<View style={styles.statColumn}>
								<Text style={styles.statNumber}>{formatNumber(profile.followingCount)}</Text>
								<Text style={styles.statLabel}>フォロー中</Text>
							</View>
							<View style={styles.statColumn}>
								<Text style={styles.statNumber}>{formatNumber(profile.followersCount)}</Text>
								<Text style={styles.statLabel}>フォロワー</Text>
							</View>
							<View style={styles.statColumn}>
								<Text style={styles.statNumber}>{formatNumber(profile.totalLikes)}</Text>
								<Text style={styles.statLabel}>いいね</Text>
							</View>
						</View>
					</View>

					{/* Display Name */}
					<Text style={styles.displayName}>{profile.displayName}</Text>

					{/* Bio */}
					<Text style={styles.bio}>{profile.bio}</Text>

					{/* Action Buttons */}
					<View style={styles.actionButtons}>
						{isOwnProfile ? (
							<>
								<PrimaryButton
									style={{ flex: 1 }}
									onPress={handleEditProfile}
									label="プロフィールを編集"
									icon={<Edit3 size={16} color="#FFFFFF" />}
								/>
							</>
						) : (
							<>
								<TouchableOpacity
									style={[styles.followButton, isFollowing && styles.followingButton]}
									onPress={handleFollow}>
									<Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
										{isFollowing ? "フォロー中" : "フォロー"}
									</Text>
								</TouchableOpacity>
								<TouchableOpacity style={styles.messageButton}>
									<MessageCircle size={16} color="#FFFFFF" />
									<Text style={styles.messageButtonText}>メッセージ</Text>
								</TouchableOpacity>
							</>
						)}
					</View>
				</Card>

				{/* Content Tabs */}
				<View style={styles.tabsContainer}>
					{availableTabs.map((tab) => (
						<TouchableOpacity
							key={tab}
							style={[styles.tab, selectedTab === tab && styles.activeTab]}
							onPress={() => setSelectedTab(tab)}>
							{renderTabIcon(tab)}
						</TouchableOpacity>
					))}
				</View>

				{/* Posts Grid */}
				<View style={[styles.postsContainer, { marginTop: 0 }]}>
					{selectedTab === "wallet" ? (
						<WalletTabs />
					) : selectedTab === "saved" && !isOwnProfile ? (
						<View style={styles.privateContainer}>
							<View style={styles.privateCard}>
								<Lock size={48} color="#6B7280" />
								<Text style={styles.privateText}>この内容は非公開です</Text>
							</View>
						</View>
					) : (
						<ImageCardGrid
							data={getCurrentPosts()}
							containerStyle={{ marginVertical: 16 }}
							renderOverlay={(item) => (
								<View style={styles.reviewCardOverlay}>
									<Text style={styles.reviewCardTitle}>{item.dishName}</Text>
									<View style={styles.reviewCardRating}>
										<Stars rating={item.likes / 10000} />
										<Text style={styles.reviewCardRatingText}>({item.reviewCount})</Text>
									</View>
								</View>
							)}
						/>
					)}
				</View>
			</ScrollView>

			{/* Edit Profile Modal */}
			<BlurModal animationType="slide" presentationStyle="pageSheet">
				<Card>
					<Text style={styles.editLabel}>自己紹介</Text>
					<TextInput
						style={styles.editInput}
						value={editedBio}
						onChangeText={setEditedBio}
						multiline
						numberOfLines={4}
						placeholder="自己紹介を入力してください..."
						placeholderTextColor="#666"
					/>
				</Card>
				<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSaveProfile} label="保存" />
			</BlurModal>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
	},
	backButton: {
		padding: 4,
		borderRadius: 12,
		backgroundColor: "rgba(255, 255, 255, 0.1)",
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		letterSpacing: -0.5,
	},
	settingButton: {
		padding: 4,
	},
	shareButton: {
		padding: 4,
	},
	content: {
		flex: 1,
	},
	profileHeader: {
		flexDirection: "row",
		alignItems: "center",
		marginBottom: 16,
	},
	avatar: {
		width: 80,
		height: 80,
		borderRadius: 20,
		marginRight: 20,
		borderWidth: 3,
		borderColor: "#FFFFFF",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
	},
	statsContainer: {
		flex: 1,
		flexDirection: "row",
		justifyContent: "space-around",
	},
	statColumn: {
		alignItems: "center",
	},
	statNumber: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 2,
		letterSpacing: -0.3,
	},
	statLabel: {
		fontSize: 13,
		color: "#6B7280",
		fontWeight: "500",
	},
	displayName: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	bio: {
		fontSize: 15,
		color: "#6B7280",
		lineHeight: 20,
		marginBottom: 16,
		fontWeight: "400",
	},
	actionButtons: {
		flexDirection: "row",
		gap: 8,
	},
	followButton: {
		flex: 1,
		backgroundColor: "#5EA2FF",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 16,
		alignItems: "center",
		shadowColor: "#5EA2FF",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.3,
		shadowRadius: 8,
		elevation: 6,
	},
	followingButton: {
		backgroundColor: "#6B7280",
	},
	followButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#FFFFFF",
		letterSpacing: 0.2,
	},
	followingButtonText: {
		color: "#FFFFFF",
	},
	messageButton: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#6B7280",
		paddingVertical: 10,
		paddingHorizontal: 16,
		borderRadius: 16,
		gap: 6,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	messageButtonText: {
		fontSize: 15,
		fontWeight: "600",
		color: "#FFFFFF",
		letterSpacing: 0.2,
	},
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
	postsContainer: {
		flex: 1,
		minHeight: 400,
		marginTop: 16,
	},
	privateContainer: {
		flex: 1,
		paddingHorizontal: 16,
	},
	privateCard: {
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
	privateText: {
		fontSize: 17,
		color: "#6B7280",
		marginTop: 16,
		fontWeight: "500",
		textAlign: "center",
	},
	reviewCardOverlay: {
		position: "absolute",
		bottom: 8,
		left: 8,
		right: 8,
		flexDirection: "column",
		justifyContent: "space-between",
	},
	reviewCardTitle: {
		fontSize: 12,
		fontWeight: "600",
		color: "#FFF",
		marginBottom: 4,
	},
	reviewCardRating: {
		flexDirection: "row",
		alignItems: "center",
	},
	reviewCardRatingText: {
		fontSize: 10,
		color: "#FFF",
		marginLeft: 4,
	},
	editLabel: {
		fontSize: 17,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
		letterSpacing: -0.3,
	},
	editInput: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#1A1A1A",
		textAlignVertical: "top",
		minHeight: 100,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
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
	earningCard: {
		flex: 1,
		aspectRatio: 9 / 16,
		borderRadius: 16,
		margin: 4,
		overflow: "hidden",
		position: "relative",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 4 },
		shadowOpacity: 0.15,
		shadowRadius: 8,
		elevation: 6,
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
