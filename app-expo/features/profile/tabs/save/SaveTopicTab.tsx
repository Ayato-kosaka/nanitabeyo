import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { GridList } from '../components/GridList';
import { ImageCard } from '@/components/ImageCardGrid';
import i18n from '@/lib/i18n';

// Mock data type for saved topics
interface SavedTopic {
  id: string;
  name: string;
  imageUrl: string;
  savedCount: number;
}

interface SaveTopicTabProps {
  data: SavedTopic[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  onItemPress?: (item: SavedTopic, index: number) => void;
}

export function SaveTopicTab({
  data,
  isLoading = false,
  isLoadingMore = false,
  refreshing = false,
  onRefresh,
  onEndReached,
  onItemPress,
}: SaveTopicTabProps) {
  const renderTopicItem = useCallback(
    ({ item, index }: { item: SavedTopic; index: number }) => {
      return (
        <ImageCard
          item={{
            id: item.id,
            imageUrl: item.imageUrl,
          }}
          onPress={() => onItemPress?.(item, index)}
        >
          <View style={styles.topicCardOverlay}>
            <Text style={styles.topicName}>{item.name}</Text>
            <Text style={styles.savedCount}>
              {i18n.t('Profile.savedCount', { count: item.savedCount })}
            </Text>
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
            {i18n.t('Profile.emptyState.noSavedTopics')}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <GridList
      data={data}
      renderItem={renderTopicItem}
      numColumns={2}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={onEndReached}
      ListEmptyComponent={renderEmptyState}
      testID="save-topic-tab-grid"
    />
  );
}

const styles = StyleSheet.create({
  gridContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  gridRow: {
    gap: 8,
  },
  topicCardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
  },
  topicName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  savedCount: {
    fontSize: 12,
    color: '#E5E5E5',
    fontWeight: '500',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateCard: {
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
  emptyStateText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});