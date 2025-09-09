import React, { useState, useCallback, useMemo } from "react";
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
import { CreateAccountModal as CreateAccountModalComponent } from "../components/CreateAccountModal";
import { OtpModal } from "../components/OtpModal";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/hooks/useBlurModal";
import { useAuth } from "@/contexts/AuthProvider";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { mockBids, mockEarnings } from "../constants";
import { ProfileEditForm } from "../components/ProfileEditForm";
import { FeedbackForm } from "../components/FeedbackForm";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { GroupName, RouteName } from "../components/ProfileTabsBar";
import type { Provider } from "@supabase/supabase-js";
import i18n from "@/lib/i18n";

export function ProfileTabsLayout() {
	const { userId } = useLocalSearchParams();
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { signInWithOAuth, signInWithOtp, verifyOtp, linkIdentity, createUserProfile, user } = useAuth();
	
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const {
		BlurModal: FeedbackModal,
		open: openFeedbackModal,
		close: closeFeedbackModal,
	} = useBlurModal({ intensity: 100 });
	const {
		BlurModal: LoginModal,
		open: openLoginModal,
		close: closeLoginModal,
	} = useBlurModal({ intensity: 100 });
	const {
		BlurModal: CreateAccountModal,
		open: openCreateAccountModal,
		close: closeCreateAccountModal,
	} = useBlurModal({ intensity: 100 });
	const {
		BlurModal: OtpModalComponent,
		open: openOtpModal,
		close: closeOtpModal,
	} = useBlurModal({ intensity: 100 });

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);
	const [editedBio, setEditedBio] = useState("");
	const [otpPhone, setOtpPhone] = useState("");
	const [pendingDisplayName, setPendingDisplayName] = useState("");

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

	const handleLogin = useCallback(() => {
		lightImpact();
		openLoginModal();
		logFrontendEvent({
			event_name: "login_modal_opened",
			error_level: "log",
			payload: { userId: profile.id },
		});
	}, [lightImpact, openLoginModal, logFrontendEvent, profile.id]);

	const handleCreateAccount = useCallback(() => {
		lightImpact();
		openCreateAccountModal();
		logFrontendEvent({
			event_name: "create_account_modal_opened",
			error_level: "log",
			payload: { userId: profile.id },
		});
	}, [lightImpact, openCreateAccountModal, logFrontendEvent, profile.id]);

	const handleLoginSubmit = useCallback(async (data: { phone: string }) => {
		try {
			await signInWithOtp(data.phone);
			setOtpPhone(data.phone);
			closeLoginModal();
			openOtpModal();
			
			logFrontendEvent({
				event_name: "otp_sent",
				error_level: "log",
				payload: { phone: data.phone, flow: "login" },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "otp_send_error",
				error_level: "error",
				payload: { phone: data.phone, error: (error as Error).message },
			});
			throw error;
		}
	}, [signInWithOtp, closeLoginModal, openOtpModal, logFrontendEvent]);

	const handleCreateAccountSubmit = useCallback(async (data: { name: string; phone: string }) => {
		try {
			await signInWithOtp(data.phone);
			setOtpPhone(data.phone);
			setPendingDisplayName(data.name);
			closeCreateAccountModal();
			openOtpModal();

			logFrontendEvent({
				event_name: "otp_sent",
				error_level: "log",
				payload: { phone: data.phone, flow: "create" },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "otp_send_error",
				error_level: "error",
				payload: { phone: data.phone, error: (error as Error).message },
			});
			throw error;
		}
	}, [signInWithOtp, closeCreateAccountModal, openOtpModal, logFrontendEvent]);

	const handleOtpVerify = useCallback(async (otp: string) => {
		try {
			await verifyOtp(otpPhone, otp);
			
			// Create user profile if display name was provided
			if (pendingDisplayName) {
				await createUserProfile(pendingDisplayName);
			}
			
			closeOtpModal();
			setOtpPhone("");
			setPendingDisplayName("");

			logFrontendEvent({
				event_name: "authentication_success",
				error_level: "log",
				payload: { phone: otpPhone, method: "sms" },
			});

			Alert.alert(i18n.t("Common.success"), "Successfully logged in!");
		} catch (error) {
			logFrontendEvent({
				event_name: "otp_verify_error",
				error_level: "error",
				payload: { phone: otpPhone, error: (error as Error).message },
			});
			throw error;
		}
	}, [verifyOtp, otpPhone, pendingDisplayName, createUserProfile, closeOtpModal, logFrontendEvent]);

	const handleOtpResend = useCallback(async () => {
		try {
			await signInWithOtp(otpPhone);
			
			logFrontendEvent({
				event_name: "otp_resent",
				error_level: "log",
				payload: { phone: otpPhone },
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "otp_resend_error",
				error_level: "error",
				payload: { phone: otpPhone, error: (error as Error).message },
			});
			throw error;
		}
	}, [signInWithOtp, otpPhone, logFrontendEvent]);

	const handleOAuthSignIn = useCallback(async (provider: Provider) => {
		try {
			// Check if user is anonymous and try to link identity first
			const isAnonymous = user?.is_anonymous;
			
			if (isAnonymous) {
				await linkIdentity(provider);
			} else {
				await signInWithOAuth(provider);
			}

			logFrontendEvent({
				event_name: "oauth_signin_success",
				error_level: "log",
				payload: { provider, isUpgrade: isAnonymous },
			});
		} catch (error) {
			// If linking fails, try regular OAuth sign in
			if (user?.is_anonymous) {
				try {
					await signInWithOAuth(provider);
					logFrontendEvent({
						event_name: "oauth_signin_fallback_success",
						error_level: "log",
						payload: { provider },
					});
				} catch (fallbackError) {
					logFrontendEvent({
						event_name: "oauth_signin_error",
						error_level: "error",
						payload: { provider, error: (fallbackError as Error).message },
					});
					throw fallbackError;
				}
			} else {
				logFrontendEvent({
					event_name: "oauth_signin_error",
					error_level: "error",
					payload: { provider, error: (error as Error).message },
				});
				throw error;
			}
		}
	}, [user, linkIdentity, signInWithOAuth, logFrontendEvent]);

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
				onLogin={handleLogin}
				onCreateAccount={handleCreateAccount}
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
		handleCreateAccount,
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

			<LoginModal>
				{({ close }) => (
					<LoginbackModal
						onClose={close}
						onSubmit={handleLoginSubmit}
						onOAuthSignIn={handleOAuthSignIn}
					/>
				)}
			</LoginModal>

			<CreateAccountModal>
				{({ close }) => (
					<CreateAccountModalComponent
						onClose={close}
						onSubmit={handleCreateAccountSubmit}
						onOAuthSignIn={handleOAuthSignIn}
					/>
				)}
			</CreateAccountModal>

			<OtpModalComponent>
				{({ close }) => (
					<OtpModal
						onClose={close}
						onVerify={handleOtpVerify}
						onResend={handleOtpResend}
						phone={otpPhone}
					/>
				)}
			</OtpModalComponent>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
});
