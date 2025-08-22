import React from 'react';
import { GridList } from '@/features/profile/components/GridList';
import type { DishMediaEntry } from '@shared/api/v1/res';

interface LikeTabProps {
  data: DishMediaEntry[];
  onItemPress: (item: DishMediaEntry, index: number) => void;
  onEndReached: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  isLoadingMore: boolean;
  renderEmptyComponent: () => React.ReactNode;
}

export function LikeTab({
  data,
  onItemPress,
  onEndReached,
  onRefresh,
  refreshing,
  isLoadingMore,
  renderEmptyComponent,
}: LikeTabProps) {
  return (
    <GridList
      data={data}
      numColumns={3}
      onItemPress={onItemPress}
      onEndReached={onEndReached}
      onRefresh={onRefresh}
      refreshing={refreshing}
      isLoadingMore={isLoadingMore}
      renderEmptyComponent={renderEmptyComponent}
    />
  );
}