import React, { useState, useCallback, useMemo, useEffect } from "react";
import { View, StyleSheet, LayoutChangeEvent, Alert } from "react-native";
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
import { LoginbackModal } from "../components/LoginbackModal";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { mockBids, mockEarnings } from "../constants";
import { getAvatarUrl, ProfileEditForm } from "../components/ProfileEditForm";
import { FeedbackForm } from "../components/FeedbackForm";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { GroupName, RouteName } from "../components/ProfileTabsBar";
import { useAuth } from "@/contexts/AuthProvider";
import { Image } from "expo-image";
import { userProfile } from "@/data/profileData";
import { useAPICall } from "@/hooks/useAPICall";
import type { GetUserProfileResponse } from "@shared/api/v1/res";

export function ProfileTabsLayout() {
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { user } = useAuth();

	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const {
		BlurModal: FeedbackModal,
		open: openFeedbackModal,
		close: closeFeedbackModal,
	} = useBlurModal({ intensity: 100 });
	const { BlurModal: LoginModal, open: openLoginModal, close: closeLoginModal } = useBlurModal({ intensity: 100 });

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);
	const [profile, setProfile] = useState<GetUserProfileResponse | null>(null);

	const isOwnProfile = useMemo(() => !userId || userId === "me", [userId]);
	const isGuest = useMemo(() => user?.is_anonymous !== false, [user?.is_anonymous]);

	useEffect(() => {
		const loadOwnProfile = async () => {
			if (isGuest) {
				setProfile(userProfile);
				return;
			}
			try {
				const data = await callBackend<{}, GetUserProfileResponse>(`v1/users/${userId ?? user?.id}`, {
					method: "GET",
					requestPayload: {},
				});
				const avatarUrl = getAvatarUrl(data);
				avatarUrl && (await Image.prefetch(avatarUrl));
				setProfile(data);
			} catch (error: any) {
				logFrontendEvent({
					event_name: "load_own_profile_error",
					error_level: "error",
					payload: { error: error.message, userId: userId ?? user?.id, isOwnProfile, isGuest },
				});
			}
		};
		loadOwnProfile();
	}, [callBackend, isGuest, isOwnProfile, logFrontendEvent, user?.id, userId]);

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
		if (!profile) return;
		lightImpact();
		logFrontendEvent({
			event_name: "profile_shared",
			error_level: "log",
			payload: { userId: profile.id, username: profile.username },
		});
	}, [lightImpact, logFrontendEvent, profile]);

	const handleFollow = useCallback(() => {
		if (!profile) return;
		mediumImpact();
		const newFollowState = !isFollowing;
		setIsFollowing(newFollowState);
		logFrontendEvent({
			event_name: newFollowState ? "user_followed" : "user_unfollowed",
			error_level: "log",
			payload: {
				targetUserId: profile.id,
				targetUsername: profile.username,
			},
		});
	}, [mediumImpact, isFollowing, logFrontendEvent, profile]);

	const handleEditProfile = useCallback(() => {
		lightImpact();
		openEditModal();
		logFrontendEvent({
			event_name: "profile_edit_started",
			error_level: "log",
			payload: {},
		});
	}, [lightImpact, openEditModal, logFrontendEvent]);

	const handleFeedback = useCallback(() => {
		lightImpact();
		openFeedbackModal();
		logFrontendEvent({
			event_name: "feedback_modal_opened",
			error_level: "log",
			payload: { userId: user?.id },
		});
	}, [lightImpact, openFeedbackModal, logFrontendEvent, user?.id]);

	const handleFeedbackSubmit = useCallback(
		(data: { type: "request" | "bug"; title: string; message: string; issueNumber: number; issueUrl: string }) => {
			closeFeedbackModal();
			// Additional success handling could be added here if needed
		},
		[closeFeedbackModal],
	);

	const handleLogin = useCallback(() => {
		lightImpact();
		openLoginModal();
		logFrontendEvent({
			event_name: "login_modal_opened",
			error_level: "log",
			payload: { userId: user?.id },
		});
	}, [lightImpact, openLoginModal, logFrontendEvent, user?.id]);

	const handleTabChange = useCallback(
		(index: number) => {
			const tabName = tabRoutes[index];
			logFrontendEvent({
				event_name: "profile_tab_changed",
				error_level: "log",
				payload: { tabName, userId: user?.id },
			});
		},
		[tabRoutes, logFrontendEvent, user?.id],
	);

	const renderHeader = useCallback(() => {
		if (!profile) {
			return null;
		}
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
				onLogin={handleLogin}
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
		handleLogin,
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

			{profile && (
				<BlurModal>
					{({ close }) => (
						<ProfileEditForm initialValues={profile} setProfile={setProfile} close={close} onCancel={close} />
					)}
				</BlurModal>
			)}

			<FeedbackModal>
				{({ close }) => (
					<FeedbackForm
						onSubmit={(data) => {
							handleFeedbackSubmit(data);
							close();
						}}
						onCancel={close}
					/>
				)}
			</FeedbackModal>

			<LoginModal>{({ close }) => <LoginbackModal onClose={close} />}</LoginModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
