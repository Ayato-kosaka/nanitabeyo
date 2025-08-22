import React, { useState, useCallback } from 'react';
import { View } from 'react-native';
import { Tabs } from '@/features/profile/lib/collapsible-tabs';
import { ProfileHeader } from '@/features/profile/components/ProfileHeader';
import { ProfileTabsBar } from '@/features/profile/components/ProfileTabsBar';
import { ReviewTab } from '@/features/profile/tabs/ReviewTab';
import { LikeTab } from '@/features/profile/tabs/LikeTab';
import { SaveTab } from '@/features/profile/tabs/SaveTab';
import { WalletTab } from '@/features/profile/tabs/WalletTab';
import i18n from '@/lib/i18n';
import type { DishMediaEntry } from '@shared/api/v1/res';

type TabType = 'reviews' | 'saved' | 'liked' | 'wallet';

interface ProfileTabsLayoutProps {
  profile: {
    avatar: string;
    displayName: string;
    bio: string;
    followingCount: number;
    followersCount: number;
    totalLikes: number;
    isFollowing?: boolean;
  };
  isOwnProfile: boolean;
  isFollowing: boolean;
  profileData: {
    userDishMediaEntries: DishMediaEntry[] | null;
    likedDishMediaEntries: DishMediaEntry[] | null;
    savedTopics: any[] | null; // Use any for now since it's different data structure
    savedDishMediaEntries: DishMediaEntry[] | null;
  };
  onEditProfile: () => void;
  onFollow: () => void;
  onItemPress: (item: DishMediaEntry, index: number) => void;
  onEndReached: (tab: TabType) => void;
  onRefresh: (tab: TabType) => void;
  refreshing: boolean;
  isLoadingMore: Record<TabType, boolean>;
  renderEmptyComponent: (tab: TabType) => React.ReactNode;
}

export function ProfileTabsLayout({
  profile,
  isOwnProfile,
  isFollowing,
  profileData,
  onEditProfile,
  onFollow,
  onItemPress,
  onEndReached,
  onRefresh,
  refreshing,
  isLoadingMore,
  renderEmptyComponent,
}: ProfileTabsLayoutProps) {
  const [headerHeight, setHeaderHeight] = useState(200);

  const availableTabs: TabType[] = isOwnProfile ? ['reviews', 'saved', 'liked', 'wallet'] : ['reviews'];

  const handleHeaderLayout = useCallback((event: any) => {
    const { height } = event.nativeEvent.layout;
    setHeaderHeight(height);
  }, []);

  const renderHeader = () => (
    <ProfileHeader
      profile={profile}
      isOwnProfile={isOwnProfile}
      isFollowing={isFollowing}
      onEditProfile={onEditProfile}
      onFollow={onFollow}
      onLayout={handleHeaderLayout}
    />
  );

  const renderTabBar = (props: any) => (
    <ProfileTabsBar
      state={props.navigationState}
      jumpTo={props.jumpTo}
      availableTabs={availableTabs}
    />
  );

  const tabs = [
    <Tabs.Tab key="reviews" name="reviews">
      <ReviewTab
        data={profileData.userDishMediaEntries || []}
        onItemPress={onItemPress}
        onEndReached={() => onEndReached('reviews')}
        onRefresh={() => onRefresh('reviews')}
        refreshing={refreshing}
        isLoadingMore={isLoadingMore.reviews}
        renderEmptyComponent={() => renderEmptyComponent('reviews')}
      />
    </Tabs.Tab>
  ];

  if (isOwnProfile) {
    tabs.push(
      <Tabs.Tab key="saved" name="saved">
        <SaveTab
          savedTopics={profileData.savedTopics || []}
          savedPosts={profileData.savedDishMediaEntries || []}
          onItemPress={onItemPress}
          onEndReached={(tabType) => onEndReached('saved')}
          onRefresh={(tabType) => onRefresh('saved')}
          refreshing={refreshing}
          isLoadingMore={{ topics: isLoadingMore.saved, posts: isLoadingMore.saved }}
          renderEmptyComponent={(tabType) => renderEmptyComponent('saved')}
        />
      </Tabs.Tab>,
      <Tabs.Tab key="liked" name="liked">
        <LikeTab
          data={profileData.likedDishMediaEntries || []}
          onItemPress={onItemPress}
          onEndReached={() => onEndReached('liked')}
          onRefresh={() => onRefresh('liked')}
          refreshing={refreshing}
          isLoadingMore={isLoadingMore.liked}
          renderEmptyComponent={() => renderEmptyComponent('liked')}
        />
      </Tabs.Tab>,
      <Tabs.Tab key="wallet" name="wallet">
        <WalletTab />
      </Tabs.Tab>
    );
  }

  return (
    <Tabs.Container
      headerHeight={headerHeight}
      renderHeader={renderHeader}
      renderTabBar={renderTabBar}>
      {tabs}
    </Tabs.Container>
  );
}