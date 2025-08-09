import { useBlurModal } from "@/hooks/useBlurModal";
import { useHaptics } from "@/hooks/useHaptics";
import { UserProfile } from "@/types";

type TabType = "posts" | "saved" | "liked" | "wallet";

interface UseProfileActionsProps {
	profile: UserProfile;
	isFollowing: boolean;
	setIsFollowing: (following: boolean) => void;
	setEditedBio: (bio: string) => void;
	setSelectedTab: (tab: TabType) => void;
}

/**
 * useProfileActions hook
 * プロフィール画面のアクション処理を管理する
 */
export function useProfileActions({
	profile,
	isFollowing,
	setIsFollowing,
	setEditedBio,
	setSelectedTab,
}: UseProfileActionsProps) {
	const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({ intensity: 100 });
	const { lightImpact, mediumImpact } = useHaptics();

	const handleFollow = () => {
		mediumImpact();
		setIsFollowing(!isFollowing);
	};

	const handleEditProfile = () => {
		lightImpact();
		setEditedBio(profile.bio);
		openEditModal();
	};

	const handleSaveProfile = () => {
		mediumImpact();
		// In a real app, this would update the profile via API
		console.log("Saving profile with bio:", profile.bio);
		closeEditModal();
	};

	const handleShareProfile = () => {
		lightImpact();
		console.log("Sharing profile:", profile.username);
	};

	const handlePostPress = (index: number) => {
		lightImpact();
		// router.push(`/(tabs)/profile/food?startIndex=${index}`);
	};

	const handleTabSelect = (tab: TabType) => {
		lightImpact();
		setSelectedTab(tab);
	};

	return {
		BlurModal,
		openEditModal,
		closeEditModal,
		handleFollow,
		handleEditProfile,
		handleSaveProfile,
		handleShareProfile,
		handlePostPress,
		handleTabSelect,
	};
}
