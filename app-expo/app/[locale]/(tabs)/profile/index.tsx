import React from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Card } from "@/components/Card";
import { ProfileHeader } from "@/features/profile/components/ProfileHeader";
import { ProfileStats } from "@/features/profile/components/ProfileStats";
import { ProfileInfo } from "@/features/profile/components/ProfileInfo";
import { ActionButtons } from "@/features/profile/components/ActionButtons";
import { ContentTabs } from "@/features/profile/components/ContentTabs";
import { PostsContent } from "@/features/profile/components/PostsContent";
import { EditProfileModal } from "@/features/profile/components/EditProfileModal";
import { useProfileData } from "@/features/profile/hooks/useProfileData";
import { useProfileActions } from "@/features/profile/hooks/useProfileActions";
import { formatNumber } from "@/features/profile/utils/formatNumber";

/**
 * ProfileScreen コンポーネント
 * ユーザープロフィール画面のメインコンポーネント
 * 自分のプロフィールと他のユーザーのプロフィール表示に対応
 */
export default function ProfileScreen() {
	// プロフィールデータの管理
	const {
		profile,
		isOwnProfile,
		selectedTab,
		setSelectedTab,
		isFollowing,
		setIsFollowing,
		editedBio,
		setEditedBio,
		availableTabs,
		getCurrentPosts,
	} = useProfileData();

	// プロフィールアクションの管理
	const { BlurModal, handleFollow, handleEditProfile, handleSaveProfile, handleShareProfile, handleTabSelect } =
		useProfileActions({
			profile,
			isFollowing,
			setIsFollowing,
			setEditedBio,
			setSelectedTab,
		});

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			{/* Header */}
			<ProfileHeader profile={profile} isOwnProfile={isOwnProfile} onShareProfile={handleShareProfile} />

			<ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
				{/* Profile Info */}
				<Card>
					{/* Avatar and Stats */}
					<ProfileStats profile={profile} formatNumber={formatNumber} />

					{/* Display Name and Bio */}
					<ProfileInfo profile={profile} />

					{/* Action Buttons */}
					<ActionButtons
						isOwnProfile={isOwnProfile}
						isFollowing={isFollowing}
						onEditProfile={handleEditProfile}
						onFollow={handleFollow}
					/>
				</Card>

				{/* Content Tabs */}
				<ContentTabs selectedTab={selectedTab} availableTabs={availableTabs} onTabSelect={handleTabSelect} />

				{/* Posts Grid */}
				<View style={[styles.postsContainer, { marginTop: 0 }]}>
					<PostsContent selectedTab={selectedTab} posts={getCurrentPosts()} isOwnProfile={isOwnProfile} />
				</View>
			</ScrollView>

			{/* Edit Profile Modal */}
			<EditProfileModal
				BlurModal={BlurModal}
				editedBio={editedBio}
				setEditedBio={setEditedBio}
				onSaveProfile={handleSaveProfile}
			/>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	content: {
		flex: 1,
	},
	postsContainer: {
		flex: 1,
		minHeight: 400,
		marginTop: 16,
	},
});
