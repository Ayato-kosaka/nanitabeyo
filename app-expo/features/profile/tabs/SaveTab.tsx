import React from 'react';
import { Tabs } from '@/components/collapsible-tabs';
import { SaveSubTabsBar } from '../../components/SaveSubTabsBar';
import { SaveTopicTab } from './save/SaveTopicTab';
import { SavePostTab } from './save/SavePostTab';
import i18n from '@/lib/i18n';

interface SaveTabProps {
  savedTopics: any[];
  savedPosts: any[];
  isOwnProfile: boolean;
  isLoadingTopics?: boolean;
  isLoadingPosts?: boolean;
  isLoadingMoreTopics?: boolean;
  isLoadingMorePosts?: boolean;
  refreshingTopics?: boolean;
  refreshingPosts?: boolean;
  onRefreshTopics?: () => void;
  onRefreshPosts?: () => void;
  onEndReachedTopics?: () => void;
  onEndReachedPosts?: () => void;
  onTopicPress?: (item: any, index: number) => void;
  onPostPress?: (item: any, index: number) => void;
}

export function SaveTab({
  savedTopics,
  savedPosts,
  isOwnProfile,
  isLoadingTopics = false,
  isLoadingPosts = false,
  isLoadingMoreTopics = false,
  isLoadingMorePosts = false,
  refreshingTopics = false,
  refreshingPosts = false,
  onRefreshTopics,
  onRefreshPosts,
  onEndReachedTopics,
  onEndReachedPosts,
  onTopicPress,
  onPostPress,
}: SaveTabProps) {
  // For non-own profiles, show private content message
  if (!isOwnProfile) {
    return (
      <div>Private content - implementation needed for non-own profiles</div>
    );
  }

  return (
    <Tabs.Container
      headerHeight={0}
      TabBarComponent={SaveSubTabsBar}
      initialTabName="topics"
    >
      <Tabs.Tab name="topics">
        <SaveTopicTab
          data={savedTopics}
          isLoading={isLoadingTopics}
          isLoadingMore={isLoadingMoreTopics}
          refreshing={refreshingTopics}
          onRefresh={onRefreshTopics}
          onEndReached={onEndReachedTopics}
          onItemPress={onTopicPress}
        />
      </Tabs.Tab>

      <Tabs.Tab name="posts">
        <SavePostTab
          data={savedPosts}
          isLoading={isLoadingPosts}
          isLoadingMore={isLoadingMorePosts}
          refreshing={refreshingPosts}
          onRefresh={onRefreshPosts}
          onEndReached={onEndReachedPosts}
          onItemPress={onPostPress}
        />
      </Tabs.Tab>
    </Tabs.Container>
  );
}