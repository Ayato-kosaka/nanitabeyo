import React from 'react';
import { Tabs } from '@/features/profile/lib/collapsible-tabs';
import { SaveSubTabsBar } from '@/features/profile/components/SaveSubTabsBar';
import { SaveTopicTab } from './save/SaveTopicTab';
import { SavePostTab } from './save/SavePostTab';
import i18n from '@/lib/i18n';
import type { DishMediaEntry } from '@shared/api/v1/res';

interface SaveTabProps {
  savedTopics: any[];
  savedPosts: DishMediaEntry[];
  onItemPress: (item: DishMediaEntry, index: number) => void;
  onEndReached: (tabType: 'topics' | 'posts') => void;
  onRefresh: (tabType: 'topics' | 'posts') => void;
  refreshing: boolean;
  isLoadingMore: { topics: boolean; posts: boolean };
  renderEmptyComponent: (tabType: 'topics' | 'posts') => React.ReactNode;
}

export function SaveTab({
  savedTopics,
  savedPosts,
  onItemPress,
  onEndReached,
  onRefresh,
  refreshing,
  isLoadingMore,
  renderEmptyComponent,
}: SaveTabProps) {
  return (
    <Tabs.Container
      headerHeight={0}
      renderTabBar={SaveSubTabsBar as any}>
      <Tabs.Tab name="topics">
        <SaveTopicTab
          data={savedTopics}
          onItemPress={onItemPress}
          onEndReached={() => onEndReached('topics')}
          onRefresh={() => onRefresh('topics')}
          refreshing={refreshing}
          isLoadingMore={isLoadingMore.topics}
          renderEmptyComponent={() => renderEmptyComponent('topics')}
        />
      </Tabs.Tab>
      <Tabs.Tab name="posts">
        <SavePostTab
          data={savedPosts}
          onItemPress={onItemPress}
          onEndReached={() => onEndReached('posts')}
          onRefresh={() => onRefresh('posts')}
          refreshing={refreshing}
          isLoadingMore={isLoadingMore.posts}
          renderEmptyComponent={() => renderEmptyComponent('posts')}
        />
      </Tabs.Tab>
    </Tabs.Container>
  );
}