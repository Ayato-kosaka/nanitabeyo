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

const styles = StyleSheet.create({
  privateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  privateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    margin: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  privateText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});