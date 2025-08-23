import React, { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Tabs } from "@/components/collapsible-tabs";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabsBar, ProfileTabsBarProps } from "../components/ProfileTabsBar";
import { ReviewTab } from "../tabs/ReviewTab";
import { LikeTab } from "../tabs/LikeTab";
import { SaveTab } from "../tabs/SaveTab";
import { WalletTab } from "../tabs/WalletTab";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { mockBids, mockEarnings } from "../constants";
import type { TabBarProps } from "react-native-collapsible-tab-view";

type TabType = "reviews" | "saved" | "liked" | "wallet";

interface ProfileTabsLayoutProps {
	// Add props as needed for data fetching and state management
}

export function ProfileTabsLayout({}: ProfileTabsLayoutProps) {
	const { userId } = useLocalSearchParams();
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);
	const [editedBio, setEditedBio] = useState("");

	// Determine if this is own profile
	const isOwnProfile = !userId || userId === "me";
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	// Mock data - in real implementation, this would come from props or hooks
	const profileData = {
		userDishMediaEntries: [],
		likedDishMediaEntries: [],
		savedTopics: [],
		savedDishMediaEntries: [],
	};

	// Available tabs based on profile ownership
	const availableTabs: TabType[] = useMemo(() => {
		const tabs: TabType[] = ["reviews"];
		if (isOwnProfile) {
			tabs.push("saved", "liked", "wallet");
		}
		return tabs;
	}, [isOwnProfile]);

	// Event handlers
	const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
		const { height } = event.nativeEvent.layout;
		setHeaderHeight(height);
	}, []);

	const handleBack = useCallback(() => {
		router.back();
	}, []);

	const handleShareProfile = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "profile_shared",
			error_level: "log",
			payload: {
				userId: profile.id,
				username: profile.username,
			},
		});
	}, [lightImpact, logFrontendEvent, profile]);

	const handleFollow = useCallback(() => {
		mediumImpact();
		const newFollowState = !isFollowing;
		setIsFollowing(newFollowState);

		logFrontendEvent({
			event_name: newFollowState ? "user_followed" : "user_unfollowed",
			error_level: "log",
			payload: {
				targetUserId: profile.id,
				targetUsername: profile.username,
				followersCount: profile.followersCount,
			},
		});
	}, [mediumImpact, isFollowing, logFrontendEvent, profile]);

	const handleEditProfile = useCallback(() => {
		lightImpact();
		setEditedBio(profile.bio);

		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: { currentBioLength: profile.bio.length },
		});
	}, [lightImpact, profile.bio, logFrontendEvent]);

	const handleTabChange = useCallback(
		(index: number) => {
			const tabName = availableTabs[index];
			logFrontendEvent({
				event_name: "profile_tab_changed",
				error_level: "log",
				payload: {
					tabName,
					userId: profile.id,
				},
			});
		},
		[availableTabs, logFrontendEvent, profile.id],
	);

	// Render header component
	const renderHeader = useCallback(() => {
		return (
			<ProfileHeader
				profile={profile}
				isOwnProfile={isOwnProfile}
				isFollowing={isFollowing}
				onLayout={handleHeaderLayout}
				onBack={handleBack}
				onShare={handleShareProfile}
				onSettings={() => {}} // TODO: Implement settings handler
				onEditProfile={handleEditProfile}
				onFollow={handleFollow}
				onMessage={() => {}} // TODO: Implement message handler
			/>
		);
	}, [
		profile,
		isOwnProfile,
		isFollowing,
		handleHeaderLayout,
		handleBack,
		handleShareProfile,
		handleEditProfile,
		handleFollow,
	]);

	// Render tab bar component
	const renderTabBar = useCallback(
		(props: TabBarProps<string>) => {
			return <ProfileTabsBar {...props} availableTabs={availableTabs} />;
		},
		[availableTabs],
	);

	return (
		<View style={styles.container}>
			<Tabs.Container
				headerHeight={headerHeight}
				renderHeader={renderHeader}
				renderTabBar={renderTabBar}
				onIndexChange={handleTabChange}
				pagerProps={{ scrollEnabled: true }}>
				<Tabs.Tab name="reviews">
					<ReviewTab
						data={profileData.userDishMediaEntries || []}
						onItemPress={(item, index) => {
							// TODO: Handle review item press
						}}
					/>
				</Tabs.Tab>

				<Tabs.Tab name="saved">
					<SaveTab
						savedTopics={profileData.savedTopics || []}
						savedPosts={profileData.savedDishMediaEntries || []}
						isOwnProfile={isOwnProfile}
						onTopicPress={(item, index) => {
							// TODO: Handle topic press
						}}
						onPostPress={(item, index) => {
							// TODO: Handle post press
						}}
					/>
				</Tabs.Tab>

				<Tabs.Tab name="liked">
					<LikeTab
						data={profileData.likedDishMediaEntries || []}
						onItemPress={(item, index) => {
							// TODO: Handle liked item press
						}}
					/>
				</Tabs.Tab>

				<Tabs.Tab name="wallet">
					<WalletTab
						deposits={mockBids}
						earnings={mockEarnings}
						onDepositPress={(item, index) => {
							// TODO: Handle deposit press
						}}
						onEarningPress={(item, index) => {
							// TODO: Handle earning press
						}}
					/>
				</Tabs.Tab>
			</Tabs.Container>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
