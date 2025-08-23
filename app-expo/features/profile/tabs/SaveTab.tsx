import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tabs } from '@/components/collapsible-tabs';
import { SaveSubTabsBar } from '../components/SaveSubTabsBar';
import { SaveTopicTab } from './save/SaveTopicTab';
import { SavePostTab } from './save/SavePostTab';
import i18n from '@/lib/i18n';

interface SaveTabProps {
  savedTopics: any[];
  savedPosts: any[];
  isOwnProfile: boolean;
  isLoading?: boolean;
  isLoadingMore?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
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
  onScroll?: any;
  contentContainerStyle?: any;
  error?: string | null;
  topicsError?: string | null;
  postsError?: string | null;
  onRetry?: () => void;
  onRetryTopics?: () => void;
  onRetryPosts?: () => void;
}

export function SaveTab({
  savedTopics,
  savedPosts,
  isOwnProfile,
  isLoading = false,
  isLoadingMore = false,
  refreshing = false,
  onRefresh,
  onEndReached,
  isLoadingTopics,
  isLoadingPosts,
  isLoadingMoreTopics,
  isLoadingMorePosts,
  refreshingTopics,
  refreshingPosts,
  onRefreshTopics,
  onRefreshPosts,
  onEndReachedTopics,
  onEndReachedPosts,
  onTopicPress,
  onPostPress,
  onScroll,
  contentContainerStyle,
  error,
  topicsError,
  postsError,
  onRetry,
  onRetryTopics,
  onRetryPosts,
}: SaveTabProps) {
  // For non-own profiles, show private content message
  if (!isOwnProfile) {
    return (
      <View style={styles.privateContainer}>
        <View style={styles.privateCard}>
          <Text style={styles.privateText}>
            {i18n.t('Profile.privateContent')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Tabs.Container
      headerHeight={0}
      renderTabBar={SaveSubTabsBar}
      initialTabName="topics"
    >
      <Tabs.Tab name="topics">
        <SaveTopicTab
          data={savedTopics}
          isLoading={isLoadingTopics ?? isLoading}
          isLoadingMore={isLoadingMoreTopics ?? isLoadingMore}
          refreshing={refreshingTopics ?? refreshing}
          onRefresh={onRefreshTopics ?? onRefresh}
          onEndReached={onEndReachedTopics ?? onEndReached}
          onItemPress={onTopicPress}
          error={topicsError ?? error}
          onRetry={onRetryTopics ?? onRetry}
        />
      </Tabs.Tab>

      <Tabs.Tab name="posts">
        <SavePostTab
          data={savedPosts}
          isLoading={isLoadingPosts ?? isLoading}
          isLoadingMore={isLoadingMorePosts ?? isLoadingMore}
          refreshing={refreshingPosts ?? refreshing}
          onRefresh={onRefreshPosts ?? onRefresh}
          onEndReached={onEndReachedPosts ?? onEndReached}
          onItemPress={onPostPress}
          error={postsError ?? error}
          onRetry={onRetryPosts ?? onRetry}
        />
      </Tabs.Tab>
    </Tabs.Container>
  );
}

const styles = StyleSheet.create({
  privateContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  privateCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  privateText: {
    fontSize: 17,
    color: "#6B7280",
    marginTop: 16,
    fontWeight: "500",
    textAlign: "center",
  },
});