import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GridList } from '../../components/GridList';
import { ImageCard } from '@/components/ImageCardGrid';
import Stars from '@/components/Stars';
import i18n from '@/lib/i18n';
import type { DishMediaEntry } from '@shared/api/v1/res';

interface SavePostTabProps {
  data: DishMediaEntry[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  onItemPress?: (item: DishMediaEntry, index: number) => void;
}

export function SavePostTab({
  data,
  isLoading = false,
  isLoadingMore = false,
  refreshing = false,
  onRefresh,
  onEndReached,
  onItemPress,
}: SavePostTabProps) {
  const renderPostItem = useCallback(
    ({ item, index }: { item: DishMediaEntry; index: number }) => {
      const gridItem = {
        ...item,
        id: item.dish_media.id,
        imageUrl: item.dish_media.thumbnailImageUrl,
      };
      
      return (
        <ImageCard
          item={gridItem}
          onPress={() => onItemPress?.(item, index)}
        >
          <View style={styles.postCardOverlay}>
            <View style={styles.postCardRating}>
              <Stars rating={item.dish.averageRating} />
              <Text style={styles.postCardRatingText}>
                ({item.dish.reviewCount})
              </Text>
            </View>
          </View>
        </ImageCard>
      );
    },
    [onItemPress]
  );

  const renderEmptyState = useCallback(() => {
    return (
      <View style={styles.emptyStateContainer}>
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateText}>
            {i18n.t('Profile.emptyState.noSavedPosts')}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <GridList
      data={data.map(item => ({ ...item, id: item.dish_media.id }))}
      renderItem={({ item, index }) => renderPostItem({ item: item as DishMediaEntry, index })}
      numColumns={3}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={onEndReached}
      ListEmptyComponent={renderEmptyState}
      testID="save-post-tab-grid"
    />
  );
}

const styles = StyleSheet.create({
  gridContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  gridRow: {
    gap: 1,
  },
  postCardOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  postCardRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  postCardRatingText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  emptyStateContainer: {
    flex: 1,
    padding: 16,
  },
  emptyStateCard: {
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
  emptyStateText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});