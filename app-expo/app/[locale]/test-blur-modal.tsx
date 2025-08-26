import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Edit3 } from "lucide-react-native";
import { useBlurModal } from "@/hooks/useBlurModal";
import { ProfileEditForm } from "@/components/forms/ProfileEditForm";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";

/**
 * Demo screen to test the BlurModal fix for Japanese text input.
 * This demonstrates the render-prop pattern that prevents IME composition issues.
 */
export default function BlurModalTestScreen() {
	const [profileBio, setProfileBio] = useState("こんにちは、これはテストです。");
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ 
		intensity: 100 
	});

	const handleSaveProfile = (newBio: string) => {
		setProfileBio(newBio);
		closeEditModal();
		console.log("Saved bio:", newBio);
	};

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<View style={styles.content}>
				<Text style={styles.title}>BlurModal Japanese Input Test</Text>
				
				<View style={styles.bioSection}>
					<Text style={styles.bioLabel}>Current Bio:</Text>
					<Text style={styles.bioText}>{profileBio}</Text>
				</View>

				<PrimaryButton
					onPress={openEditModal}
					label="Edit Profile (Test Japanese Input)"
					icon={<Edit3 size={16} color="#FFFFFF" />}
				/>

				<View style={styles.instructions}>
					<Text style={styles.instructionsTitle}>Test Instructions:</Text>
					<Text style={styles.instructionsText}>
						1. Tap "Edit Profile" button{"\n"}
						2. Try typing Japanese text like "とうきょう"{"\n"}
						3. Press spacebar to convert to "東京"{"\n"}
						4. The conversion should work properly without character commitment
					</Text>
				</View>
			</View>

			{/* BlurModal with render-prop pattern to prevent IME issues */}
			<BlurModal>
				{({ close }) => (
					<ProfileEditForm
						initialValue={profileBio}
						onSubmit={handleSaveProfile}
						onCancel={close}
						label="Bio (Japanese Input Test)"
						placeholder="Try typing Japanese text here..."
					/>
				)}
			</BlurModal>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	content: {
		flex: 1,
		padding: 24,
		justifyContent: "center",
	},
	title: {
		fontSize: 24,
		fontWeight: "700",
		color: "#1A1A1A",
		textAlign: "center",
		marginBottom: 32,
	},
	bioSection: {
		backgroundColor: "#FFFFFF",
		borderRadius: 16,
		padding: 20,
		marginBottom: 32,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
		elevation: 4,
	},
	bioLabel: {
		fontSize: 16,
		fontWeight: "600",
		color: "#666",
		marginBottom: 8,
	},
	bioText: {
		fontSize: 18,
		color: "#1A1A1A",
		lineHeight: 24,
	},
	instructions: {
		backgroundColor: "#E3F2FD",
		borderRadius: 16,
		padding: 20,
		marginTop: 32,
	},
	instructionsTitle: {
		fontSize: 16,
		fontWeight: "600",
		color: "#1565C0",
		marginBottom: 12,
	},
	instructionsText: {
		fontSize: 14,
		color: "#1976D2",
		lineHeight: 20,
	},
});