import React, { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { UserProfile, UserPost } from "@/types";
import { userProfile, otherUserProfile, userPosts, savedPosts, likedPosts } from "@/data/profileData";

type TabType = "posts" | "saved" | "liked" | "wallet";

/**
 * useProfileData hook
 * プロフィール画面のデータ管理を行う
 */
export function useProfileData() {
	const { userId } = useLocalSearchParams();
	const [selectedTab, setSelectedTab] = useState<TabType>("posts");
	const [isFollowing, setIsFollowing] = useState(false);
	const [editedBio, setEditedBio] = useState("");

	// Determine if this is the current user's profile or another user's
	const isOwnProfile = !userId || userId === userProfile.id;
	const profile = isOwnProfile ? userProfile : otherUserProfile;

	// Add wallet tab for own profile
	const availableTabs: TabType[] = isOwnProfile ? ["posts", "saved", "liked", "wallet"] : ["posts"];

	React.useEffect(() => {
		if (profile && !isOwnProfile) {
			setIsFollowing(profile.isFollowing || false);
		}
	}, [profile, isOwnProfile]);

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

	return {
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
	};
}
