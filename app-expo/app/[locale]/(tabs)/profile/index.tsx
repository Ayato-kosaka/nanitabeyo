import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, Settings, Share } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { useBlurModal } from "@/hooks/useBlurModal";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ReviewTab } from "@/features/profile/tabs/ReviewTab";
import { LikeTab } from "@/features/profile/tabs/LikeTab";
import { SaveTab } from "@/features/profile/tabs/SaveTab";
import { WalletTab } from "@/features/profile/tabs/WalletTab";
import i18n from "@/lib/i18n";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useAuth } from "@/contexts/AuthProvider";

const TopTab = createMaterialTopTabNavigator();

export default function ProfileScreen() {
	const { user } = useAuth();
	const { userId } = useLocalSearchParams<{ userId?: string }>();
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const [editedBio, setEditedBio] = useState("");
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	const handleShareProfile = () => {
		lightImpact();
		console.log("Sharing profile:", profile.username);

		logFrontendEvent({
			event_name: "profile_shared",
			error_level: "log",
			payload: {
				profileUserId: profile.id,
				profileUsername: profile.username,
				isOwnProfile,
			},
		});
	};

	const handleSaveProfile = () => {
		// In a real app, this would update the profile via API
		closeEditModal();

		logFrontendEvent({
			event_name: "profile_edit_saved",
			error_level: "log",
			payload: {
				oldBioLength: profile.bio.length,
				newBioLength: editedBio.length,
			},
		});
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

			<TopTab.Navigator
				screenOptions={{
					swipeEnabled: true,
					lazy: true,
					tabBarStyle: { display: "none" }, // Hide default TabBar
				}}>
				<TopTab.Screen name="Review" component={ReviewTab} />
				{isOwnProfile && (
					<>
						<TopTab.Screen name="Save" component={SaveTab} />
						<TopTab.Screen name="Like" component={LikeTab} />
						<TopTab.Screen name="Wallet" component={WalletTab} />
					</>
				)}
			</TopTab.Navigator>

			{/* Edit Profile Modal */}
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
	editLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 12,
	},
	editInput: {
		borderWidth: 1,
		borderColor: "#E5E7EB",
		borderRadius: 12,
		padding: 16,
		fontSize: 16,
		color: "#1A1A1A",
		textAlignVertical: "top",
	},
});
