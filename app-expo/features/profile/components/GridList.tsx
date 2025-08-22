import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Tabs } from '@/features/profile/lib/collapsible-tabs';
import { ImageCard } from '@/components/ImageCardGrid';
import Stars from '@/components/Stars';
import i18n from '@/lib/i18n';
import type { DishMediaEntry } from '@shared/api/v1/res';

interface GridListProps {
  data: DishMediaEntry[];
  numColumns?: number;
  onItemPress?: (item: DishMediaEntry, index: number) => void;
  onEndReached?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  isLoadingMore?: boolean;
  renderEmptyComponent?: () => React.ReactNode;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement | null;
}

export function GridList({
  data,
  numColumns = 3,
  onItemPress,
  onEndReached,
  onRefresh,
  refreshing = false,
  isLoadingMore = false,
  renderEmptyComponent,
  ListHeaderComponent,
}: GridListProps) {
  const renderItem = ({ item, index }: { item: DishMediaEntry; index: number }) => {
    return (
      <ImageCard
        item={{ ...item, id: item.dish_media.id, imageUrl: item.dish_media.thumbnailImageUrl }}
        onPress={() => onItemPress?.(item, index)}>
        <View style={styles.reviewCardOverlay}>
          <View style={styles.reviewCardRating}>
            <Stars rating={item.dish.averageRating} />
            <Text style={styles.reviewCardRatingText}>({item.dish.reviewCount})</Text>
          </View>
        </View>
      </ImageCard>
    );
  };

  const renderLoadingFooter = () => {
    if (!isLoadingMore) return null;

    return (
      <View style={styles.loadingFooter}>
        <ActivityIndicator size="small" color="#5EA2FF" />
      </View>
    );
  };

  const renderEmptyState = () => {
    if (renderEmptyComponent) {
      return renderEmptyComponent();
    }

    return (
      <View style={styles.emptyStateContainer}>
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateText}>
            {i18n.t('Profile.emptyState.noDishReviews')}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Tabs.FlatList
      data={data}
      renderItem={renderItem}
      keyExtractor={(item, index) => item.dish_media.id}
      numColumns={numColumns}
      contentContainerStyle={styles.flatListContent}
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      removeClippedSubviews
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListEmptyComponent={renderEmptyState}
      ListFooterComponent={renderLoadingFooter}
      ListHeaderComponent={ListHeaderComponent}
      windowSize={10}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={50}
      getItemLayout={(data, index) => ({
        length: 120, // Approximate item height
        offset: 120 * Math.floor(index / numColumns),
        index,
      })}
    />
  );
}

const styles = StyleSheet.create({
  flatListContent: {
    padding: 16,
    paddingTop: 0,
  },
  reviewCardOverlay: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  reviewCardRating: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewCardRatingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  loadingFooter: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyStateText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
});