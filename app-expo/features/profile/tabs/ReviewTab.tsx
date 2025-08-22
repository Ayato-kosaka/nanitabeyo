import React from 'react';
import { GridList } from '@/features/profile/components/GridList';
import type { DishMediaEntry } from '@shared/api/v1/res';

interface ReviewTabProps {
  data: DishMediaEntry[];
  onItemPress: (item: DishMediaEntry, index: number) => void;
  onEndReached: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  isLoadingMore: boolean;
  renderEmptyComponent: () => React.ReactNode;
}

export function ReviewTab({
  data,
  onItemPress,
  onEndReached,
  onRefresh,
  refreshing,
  isLoadingMore,
  renderEmptyComponent,
}: ReviewTabProps) {
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