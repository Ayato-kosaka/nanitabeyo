import React, { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, LayoutChangeEvent } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Tabs } from "@/components/collapsible-tabs";
import { ProfileHeader } from "../components/ProfileHeader";
import { ProfileTabsBar } from "../components/ProfileTabsBar";
import { ReviewTab } from "../tabs/ReviewTab";
import { LikeTab } from "../tabs/LikeTab";
import { SavedPostsTab } from "../tabs/SavedPostsTab";
import { SavedTopicsTab } from "../tabs/SavedTopicsTab";
import { DepositsTab } from "../tabs/wallet/DepositsTab";
import { EarningsTab } from "../tabs/wallet/EarningsTab";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { mockBids, mockEarnings } from "../constants";
import { ProfileEditForm } from "../components/ProfileEditForm";
import { FeedbackForm } from "../components/FeedbackForm";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { GroupName, RouteName } from "../components/ProfileTabsBar";

export function ProfileTabsLayout() {
	const { userId } = useLocalSearchParams();
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const {
		BlurModal: FeedbackModal,
		open: openFeedbackModal,
		close: closeFeedbackModal,
	} = useBlurModal({ intensity: 100 });

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);
	const [editedBio, setEditedBio] = useState("");

	const isOwnProfile = !userId || userId === "me";
	const profile = isOwnProfile ? userProfile : otherUserProfile;
	const isGuest = profile.username === "guest";

	const availableTabs: GroupName[] = useMemo(() => {
		const tabs: GroupName[] = [];
		if (!isGuest) {
			tabs.push("reviews");
		}
		if (isOwnProfile) {
			tabs.push("saved", "liked");
			if (!isGuest) {
				tabs.push("wallet");
			}
		}
		return tabs;
	}, [isOwnProfile]);

	const tabRoutes: RouteName[] = useMemo(() => {
		const routes: RouteName[] = ["reviews"];
		if (isOwnProfile) {
			routes.push("saved-posts", "saved-topics", "liked", "wallet-deposit", "wallet-earning");
		}
		return routes;
	}, [isOwnProfile]);

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
			payload: { userId: profile.id, username: profile.username },
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
		openEditModal();
		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: { currentBioLength: profile.bio.length },
		});
	}, [lightImpact, profile.bio, openEditModal, logFrontendEvent]);

	const handleSaveProfile = useCallback(() => {
		mediumImpact();
		closeEditModal();
		logFrontendEvent({
			event_name: "profile_edit_saved",
			error_level: "log",
			payload: { oldBioLength: profile.bio.length, newBioLength: editedBio.length },
		});
	}, [mediumImpact, closeEditModal, logFrontendEvent, profile.bio.length, editedBio.length]);

	const handleFeedback = useCallback(() => {
		lightImpact();
		openFeedbackModal();
		logFrontendEvent({
			event_name: "feedback_modal_opened",
			error_level: "log",
			payload: { userId: profile.id },
		});
	}, [lightImpact, openFeedbackModal, logFrontendEvent, profile.id]);

	const handleFeedbackSubmit = useCallback(
		(data: { type: "request" | "bug"; title: string; message: string; issueNumber: number; issueUrl: string }) => {
			closeFeedbackModal();
			// Additional success handling could be added here if needed
		},
		[closeFeedbackModal],
	);

	const handleFeedbackCancel = useCallback(() => {
		closeFeedbackModal();
	}, [closeFeedbackModal]);

	const handleTabChange = useCallback(
		(index: number) => {
			const tabName = tabRoutes[index];
			logFrontendEvent({
				event_name: "profile_tab_changed",
				error_level: "log",
				payload: { tabName, userId: profile.id },
			});
		},
		[tabRoutes, logFrontendEvent, profile.id],
	);

	const renderHeader = useCallback(() => {
		return (
			<ProfileHeader
				profile={profile}
				isOwnProfile={isOwnProfile}
				isGuest={isGuest}
				isFollowing={isFollowing}
				onLayout={handleHeaderLayout}
				onBack={handleBack}
				onShare={handleShareProfile}
				onSettings={() => {}}
				onEditProfile={handleEditProfile}
				onFollow={handleFollow}
				onMessage={() => {}}
				onFeedback={handleFeedback}
			/>
		);
	}, [
		profile,
		isOwnProfile,
		isGuest,
		isFollowing,
		handleHeaderLayout,
		handleBack,
		handleShareProfile,
		handleEditProfile,
		handleFollow,
		handleFeedback,
	]);

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
				pagerProps={{ scrollEnabled: true }}
				headerContainerStyle={{ shadowColor: "transparent" }}
				containerStyle={{ backgroundColor: "white" }}>
				{!isGuest ? (
					<Tabs.Tab name="reviews">
						<ReviewTab />
					</Tabs.Tab>
				) : null}
				{isOwnProfile ? (
					<Tabs.Tab name="saved-posts">
						<SavedPostsTab isOwnProfile={isOwnProfile} />
					</Tabs.Tab>
				) : null}
				{isOwnProfile ? (
					<Tabs.Tab name="saved-topics">
						<SavedTopicsTab isOwnProfile={isOwnProfile} />
					</Tabs.Tab>
				) : null}
				{isOwnProfile ? (
					<Tabs.Tab name="liked">
						<LikeTab />
					</Tabs.Tab>
				) : null}
				{isOwnProfile && !isGuest ? (
					<Tabs.Tab name="wallet-deposit">
						<DepositsTab
							data={mockBids}
							onItemPress={(item, index) => {
								lightImpact();
								logFrontendEvent({
									event_name: "deposit_item_selected",
									error_level: "log",
									payload: { depositId: item.id, index },
								});
							}}
						/>
					</Tabs.Tab>
				) : null}
				{isOwnProfile && !isGuest ? (
					<Tabs.Tab name="wallet-earning">
						<EarningsTab
							data={mockEarnings}
							onItemPress={(item, index) => {
								lightImpact();
								logFrontendEvent({
									event_name: "earning_item_selected",
									error_level: "log",
									payload: { earningId: item.id, index },
								});
							}}
						/>
					</Tabs.Tab>
				) : null}
			</Tabs.Container>

			<BlurModal>
				{({ close }) => (
					<ProfileEditForm
						initialValue={profile.bio}
						onSubmit={(value) => {
							setEditedBio(value);
							handleSaveProfile();
							close();
						}}
						onCancel={close}
					/>
				)}
			</BlurModal>

			<FeedbackModal>
				{({ close }) => (
					<FeedbackForm
						onSubmit={(data) => {
							handleFeedbackSubmit(data);
							close();
						}}
						onCancel={close}
						profileId={profile.id}
					/>
				)}
			</FeedbackModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
