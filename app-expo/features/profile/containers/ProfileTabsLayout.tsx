import React, { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, LayoutChangeEvent, Text, TextInput, TouchableOpacity, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
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
import { useAPICall } from "@/hooks/useAPICall";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { mockBids, mockEarnings } from "../constants";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import type { GroupName, RouteName } from "../components/ProfileTabsBar";
import type { CreateFeedbackDto } from "@shared/api/v1/dto";

export function ProfileTabsLayout() {
	const { userId } = useLocalSearchParams();
	const { mediumImpact, lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { callBackend } = useAPICall();
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const {
		BlurModal: FeedbackModal,
		open: openFeedbackModal,
		close: closeFeedbackModal,
	} = useBlurModal({ intensity: 100 });

	const [headerHeight, setHeaderHeight] = useState(0);
	const [isFollowing, setIsFollowing] = useState(false);
	const [editedBio, setEditedBio] = useState("");
	const [feedbackType, setFeedbackType] = useState<"request" | "bug">("request");
	const [feedbackTitle, setFeedbackTitle] = useState("");
	const [feedbackMessage, setFeedbackMessage] = useState("");
	const [titleError, setTitleError] = useState("");
	const [messageError, setMessageError] = useState("");
	const [submitError, setSubmitError] = useState("");

	const isOwnProfile = !userId || userId === "me";
	const profile = isOwnProfile ? userProfile : otherUserProfile;
	const isGuest = profile.username === "guest";

	const availableTabs: GroupName[] = useMemo(() => {
		const tabs: GroupName[] = ["reviews"];
		if (isOwnProfile) {
			tabs.push("saved", "liked", "wallet");
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
		setFeedbackType("request");
		setFeedbackTitle("");
		setFeedbackMessage("");
		setTitleError("");
		setMessageError("");
		setSubmitError("");
		openFeedbackModal();
		logFrontendEvent({
			event_name: "feedback_modal_opened",
			error_level: "log",
			payload: { userId: profile.id },
		});
	}, [lightImpact, openFeedbackModal, logFrontendEvent, profile.id]);

	const handleSubmitFeedback = useCallback(async () => {
		// Clear previous errors
		setTitleError("");
		setMessageError("");
		setSubmitError("");

		// Validate title
		if (feedbackTitle.length < 5 || feedbackTitle.length > 80) {
			setTitleError(i18n.t("Feedback.errors.titleLength"));
			return;
		}

		// Validate message
		if (feedbackMessage.length < 10 || feedbackMessage.length > 2000) {
			setMessageError(i18n.t("Feedback.errors.messageLength"));
			return;
		}

		try {
			mediumImpact();

			// Get device information
			const deviceInfo = Constants.deviceName || "Unknown Device";
			const osInfo =
				Platform.OS === "ios"
					? `iOS ${Constants.platform?.ios?.systemVersion || "Unknown"}`
					: Platform.OS === "android"
						? `Android ${Platform.Version}`
						: Platform.OS;

			// Call API to submit feedback
			const response = await callBackend<CreateFeedbackDto, { issueNumber: number; issueUrl: string }>(
				"v1/feedback/issue",
				{
					method: "POST",
					requestPayload: {
						type: feedbackType,
						title: feedbackTitle,
						message: feedbackMessage,
						os: osInfo,
						device: deviceInfo,
					},
				},
			);

			closeFeedbackModal();

			logFrontendEvent({
				event_name: "feedback_submitted_success",
				error_level: "log",
				payload: {
					type: feedbackType,
					titleLength: feedbackTitle.length,
					messageLength: feedbackMessage.length,
					issueNumber: response.issueNumber,
				},
			});
		} catch (error) {
			logFrontendEvent({
				event_name: "feedback_submitted_error",
				error_level: "error",
				payload: {
					type: feedbackType,
					titleLength: feedbackTitle.length,
					messageLength: feedbackMessage.length,
					error: (error as Error).message,
				},
			});
			setSubmitError(i18n.t("Feedback.errors.submitFailed"));
		}
	}, [feedbackType, feedbackTitle, feedbackMessage, mediumImpact, closeFeedbackModal, logFrontendEvent, callBackend]);

	const handleTitleChange = useCallback(
		(text: string) => {
			setFeedbackTitle(text);
			if (titleError) {
				setTitleError("");
			}
		},
		[titleError],
	);

	const handleMessageChange = useCallback(
		(text: string) => {
			setFeedbackMessage(text);
			if (messageError) {
				setMessageError("");
			}
		},
		[messageError],
	);

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
				<Tabs.Tab name="reviews">
					<ReviewTab />
				</Tabs.Tab>
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
				{isOwnProfile ? (
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
				{isOwnProfile ? (
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
				<Card>
					<Text style={styles.editLabel}>{i18n.t("Profile.labels.bio")}</Text>
					<TextInput
						style={styles.editInput}
						value={editedBio}
						onChangeText={setEditedBio}
						multiline
						numberOfLines={4}
						placeholder={i18n.t("Profile.placeholders.enterBio")}
						placeholderTextColor="#666"
					/>
				</Card>
				<PrimaryButton style={{ marginHorizontal: 16 }} onPress={handleSaveProfile} label={i18n.t("Common.save")} />
			</BlurModal>

			<FeedbackModal>
				<Card style={{ gap: 16 }}>
					<Text style={styles.feedbackTitle}>{i18n.t("Feedback.title")}</Text>

					{/* Submit Error Display */}
					{submitError ? (
						<View style={styles.errorContainer}>
							<Text style={styles.errorText}>{submitError}</Text>
						</View>
					) : null}

					{/* Type Selection */}
					<View>
						<Text style={styles.feedbackLabel}>{i18n.t("Feedback.labels.type")}</Text>
						<View style={styles.radioGroup}>
							<TouchableOpacity style={styles.radioOption} onPress={() => setFeedbackType("request")}>
								<View style={[styles.radioCircle, feedbackType === "request" && styles.radioSelected]} />
								<Text style={styles.radioLabel}>{i18n.t("Feedback.types.request")}</Text>
							</TouchableOpacity>
							<TouchableOpacity style={styles.radioOption} onPress={() => setFeedbackType("bug")}>
								<View style={[styles.radioCircle, feedbackType === "bug" && styles.radioSelected]} />
								<Text style={styles.radioLabel}>{i18n.t("Feedback.types.bug")}</Text>
							</TouchableOpacity>
						</View>
					</View>

					{/* Title Input */}
					<View>
						<Text style={styles.feedbackLabel}>{i18n.t("Feedback.labels.title")}</Text>
						<TextInput
							style={[styles.feedbackInput, titleError && styles.feedbackInputError]}
							value={feedbackTitle}
							onChangeText={handleTitleChange}
							placeholder={i18n.t("Feedback.placeholders.title")}
							placeholderTextColor="#666"
							maxLength={80}
						/>
						<Text style={styles.characterCount}>{feedbackTitle.length}/80</Text>
						{titleError ? <Text style={styles.errorText}>{titleError}</Text> : null}
					</View>

					{/* Message Input */}
					<View>
						<Text style={styles.feedbackLabel}>{i18n.t("Feedback.labels.message")}</Text>
						<TextInput
							style={[styles.feedbackInput, styles.feedbackTextArea, messageError && styles.feedbackInputError]}
							value={feedbackMessage}
							onChangeText={handleMessageChange}
							placeholder={i18n.t("Feedback.placeholders.message")}
							placeholderTextColor="#666"
							multiline
							numberOfLines={6}
							maxLength={2000}
							textAlignVertical="top"
						/>
						<Text style={styles.characterCount}>{feedbackMessage.length}/2000</Text>
						{messageError ? <Text style={styles.errorText}>{messageError}</Text> : null}
					</View>
				</Card>
				<PrimaryButton
					style={{ marginHorizontal: 16 }}
					onPress={handleSubmitFeedback}
					label={i18n.t("Feedback.buttons.submit")}
				/>
			</FeedbackModal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
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
	feedbackTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		letterSpacing: -0.3,
	},
	feedbackLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	radioGroup: {
		flexDirection: "row",
		gap: 24,
	},
	radioOption: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	radioCircle: {
		width: 20,
		height: 20,
		borderRadius: 10,
		borderWidth: 2,
		borderColor: "#D1D5DB",
	},
	radioSelected: {
		backgroundColor: "#5EA2FF",
		borderColor: "#5EA2FF",
	},
	radioLabel: {
		fontSize: 16,
		color: "#374151",
	},
	feedbackInput: {
		backgroundColor: "#F8F9FA",
		borderRadius: 12,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#1A1A1A",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
		elevation: 1,
	},
	feedbackTextArea: {
		minHeight: 120,
		textAlignVertical: "top",
	},
	characterCount: {
		fontSize: 12,
		color: "#6B7280",
		textAlign: "right",
		marginTop: 4,
	},
	errorContainer: {
		backgroundColor: "#FEF2F2",
		borderRadius: 8,
		padding: 12,
		borderLeftWidth: 4,
		borderLeftColor: "#DC2626",
	},
	errorText: {
		fontSize: 14,
		color: "#DC2626",
		fontWeight: "500",
		marginTop: 4,
	},
	feedbackInputError: {
		borderWidth: 1,
		borderColor: "#DC2626",
		backgroundColor: "#FEF2F2",
	},
});
