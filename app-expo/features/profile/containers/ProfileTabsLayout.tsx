import React, { useState, useCallback, useMemo } from "react";
import { View, StyleSheet, LayoutChangeEvent, Text, TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Tabs } from "@/components/collapsible-tabs";
import { ProfileHeader } from "../components/ProfileHeader";
import { GroupedTabBar } from "../components/GroupedTabBar";
import { ReviewTab } from "../tabs/ReviewTab";
import { LikeTab } from "../tabs/LikeTab";
import { SavedPostsTab } from "../tabs/SavedPostsTab";
import { SavedTopicsTab } from "../tabs/SavedTopicsTab";
import { DepositsTab } from "../tabs/wallet/DepositsTab";
import { EarningsTab } from "../tabs/wallet/EarningsTab";
import {
  PROFILE_TABS,
  PROFILE_TAB_GROUPS,
  TopLevelTab,
  ProfileTabRoute,
} from "../constants/tabRoutes";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useBlurModal } from "@/hooks/useBlurModal";
import { userProfile, otherUserProfile } from "@/data/profileData";
import { mockBids, mockEarnings } from "../constants";
import { Card } from "@/components/Card";
import { PrimaryButton } from "@/components/PrimaryButton";
import i18n from "@/lib/i18n";
import type { TabBarProps } from "react-native-collapsible-tab-view";

export function ProfileTabsLayout() {
  const { userId } = useLocalSearchParams();
  const { mediumImpact, lightImpact } = useHaptics();
  const { logFrontendEvent } = useLogger();
  const { BlurModal, open: openEditModal, close: closeEditModal } = useBlurModal({
    intensity: 100,
  });

  const [headerHeight, setHeaderHeight] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [editedBio, setEditedBio] = useState("");

  const isOwnProfile = !userId || userId === "me";
  const profile = isOwnProfile ? userProfile : otherUserProfile;

  const availableTopTabs: TopLevelTab[] = useMemo(() => {
    const tabs: TopLevelTab[] = ["reviews"];
    if (isOwnProfile) {
      tabs.push("saved", "liked", "wallet");
    }
    return tabs;
  }, [isOwnProfile]);

  const tabRouteList: ProfileTabRoute[] = useMemo(() => {
    const routes: ProfileTabRoute[] = [PROFILE_TABS.reviews];
    if (isOwnProfile) {
      routes.push(
        PROFILE_TABS.savedPosts,
        PROFILE_TABS.savedTopics,
        PROFILE_TABS.liked,
        PROFILE_TABS.walletDeposit,
        PROFILE_TABS.walletEarning,
      );
    }
    return routes;
  }, [isOwnProfile]);

  const getGroupForRoute = useCallback((route: ProfileTabRoute): TopLevelTab => {
    const entries = Object.entries(PROFILE_TAB_GROUPS) as [TopLevelTab, ProfileTabRoute[]][];
    for (const [group, routes] of entries) {
      if (routes.includes(route)) return group;
    }
    return "reviews";
  }, []);

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

  const handleTabChange = useCallback(
    (index: number) => {
      const route = tabRouteList[index];
      const tabName = getGroupForRoute(route);
      logFrontendEvent({
        event_name: "profile_tab_changed",
        error_level: "log",
        payload: { tabName, userId: profile.id },
      });
    },
    [tabRouteList, getGroupForRoute, logFrontendEvent, profile.id],
  );

  const renderHeader = useCallback(() => {
    return (
      <ProfileHeader
        profile={profile}
        isOwnProfile={isOwnProfile}
        isFollowing={isFollowing}
        onLayout={handleHeaderLayout}
        onBack={handleBack}
        onShare={handleShareProfile}
        onSettings={() => {}}
        onEditProfile={handleEditProfile}
        onFollow={handleFollow}
        onMessage={() => {}}
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

  const renderTabBar = useCallback(
    (props: TabBarProps<ProfileTabRoute>) => {
      return <GroupedTabBar {...props} availableTopTabs={availableTopTabs} />;
    },
    [availableTopTabs],
  );

  return (
    <View style={styles.container}>
      <Tabs.Container
        headerHeight={headerHeight}
        renderHeader={renderHeader}
        renderTabBar={renderTabBar}
        onIndexChange={handleTabChange}
        pagerProps={{ scrollEnabled: true }}
        containerStyle={{ backgroundColor: "white" }}
      >
        <Tabs.Tab name={PROFILE_TABS.reviews}>
          <ReviewTab />
        </Tabs.Tab>
        {isOwnProfile && (
          <>
            <Tabs.Tab name={PROFILE_TABS.savedPosts}>
              <SavedPostsTab isOwnProfile={isOwnProfile} />
            </Tabs.Tab>
            <Tabs.Tab name={PROFILE_TABS.savedTopics}>
              <SavedTopicsTab isOwnProfile={isOwnProfile} />
            </Tabs.Tab>
            <Tabs.Tab name={PROFILE_TABS.liked}>
              <LikeTab />
            </Tabs.Tab>
            <Tabs.Tab name={PROFILE_TABS.walletDeposit}>
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
            <Tabs.Tab name={PROFILE_TABS.walletEarning}>
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
          </>
        )}
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
        <PrimaryButton
          style={{ marginHorizontal: 16 }}
          onPress={handleSaveProfile}
          label={i18n.t("Common.save")}
        />
      </BlurModal>
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
});
