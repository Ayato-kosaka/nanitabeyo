import React from 'react';
import { GridList } from '@/features/profile/components/GridList';
import type { DishMediaEntry } from '@shared/api/v1/res';

interface SaveTopicTabProps {
  data: DishMediaEntry[];
  onItemPress: (item: DishMediaEntry, index: number) => void;
  onEndReached: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  isLoadingMore: boolean;
  renderEmptyComponent: () => React.ReactNode;
}

export function SaveTopicTab({
  data,
  onItemPress,
  onEndReached,
  onRefresh,
  refreshing,
  isLoadingMore,
  renderEmptyComponent,
}: SaveTopicTabProps) {
  return (
    <GridList
      data={data}
      numColumns={2} // As specified in the issue
      onItemPress={onItemPress}
      onEndReached={onEndReached}
      onRefresh={onRefresh}
      refreshing={refreshing}
      isLoadingMore={isLoadingMore}
      renderEmptyComponent={renderEmptyComponent}
    />
  );
}