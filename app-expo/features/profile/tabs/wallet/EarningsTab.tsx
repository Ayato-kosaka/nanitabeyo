import React, { useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { GridList } from '../../components/GridList';
import { ImageCard } from '@/components/ImageCardGrid';
import i18n from '@/lib/i18n';
import { EarningItem } from '../../constants';

interface EarningsTabProps {
  data: EarningItem[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  onItemPress?: (item: EarningItem, index: number) => void;
}

export function EarningsTab({
  data,
  isLoading = false,
  isLoadingMore = false,
  refreshing = false,
  onRefresh,
  onEndReached,
  onItemPress,
}: EarningsTabProps) {
  const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(['paid', 'pending']);

  const earningStatuses = [
    { id: 'paid', label: i18n.t('Profile.statusLabels.paid'), color: '#4CAF50' },
    { id: 'pending', label: i18n.t('Profile.statusLabels.pending'), color: '#FF9800' },
  ];

  const toggleEarningStatus = useCallback((statusId: string) => {
    setSelectedEarningStatuses((prev) =>
      prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId]
    );
  }, []);

  const filteredData = data.filter((earning) => selectedEarningStatuses.includes(earning.status));

  const renderHeaderComponent = useCallback(() => {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.statusFilterContainer}
        contentContainerStyle={styles.statusFilterContent}
      >
        {earningStatuses.map((status) => (
          <TouchableOpacity
            key={status.id}
            style={[
              styles.statusFilterChip,
              selectedEarningStatuses.includes(status.id) && {
                backgroundColor: status.color,
              },
            ]}
            onPress={() => toggleEarningStatus(status.id)}
          >
            <Text
              style={[
                styles.statusFilterChipText,
                selectedEarningStatuses.includes(status.id) && styles.statusFilterChipTextActive,
              ]}
            >
              {status.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }, [selectedEarningStatuses, earningStatuses, toggleEarningStatus]);

  const renderEarningItem = useCallback(
    ({ item, index }: { item: EarningItem; index: number }) => {
      return (
        <ImageCard
          item={{
            id: item.id,
            imageUrl: item.imageUrl,
          }}
          onPress={() => onItemPress?.(item, index)}
        >
          <View style={styles.earningCardOverlay}>
            <Text style={styles.earningCardAmount}>
              {i18n.t('Search.currencySuffix')}
              {item.earnings.toLocaleString()}
            </Text>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: item.status === 'paid' ? '#4CAF50' : '#FF9800',
                },
              ]}
            >
              <Text style={styles.statusText}>
                {item.status === 'paid'
                  ? i18n.t('Profile.statusLabels.paid')
                  : i18n.t('Profile.statusLabels.pending')}
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
            {i18n.t('Profile.emptyState.noEarnings')}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <GridList
      data={filteredData}
      renderItem={renderEarningItem}
      numColumns={3}
      contentContainerStyle={styles.gridContent}
      columnWrapperStyle={styles.gridRow}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={onEndReached}
      ListHeaderComponent={renderHeaderComponent}
      ListEmptyComponent={renderEmptyState}
      testID="earnings-tab-grid"
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
  statusFilterContainer: {
    marginVertical: 16,
  },
  statusFilterContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  statusFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#EDEFF1",
    marginHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusFilterChipText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  statusFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  earningCardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 8,
  },
  earningCardAmount: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFF",
    marginBottom: 4,
    textShadowColor: "rgba(0, 0, 0, 0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  statusChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
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