import React, { useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Text, FlatList, StyleSheet } from 'react-native';
import { Tabs } from '@/components/collapsible-tabs';
import i18n from '@/lib/i18n';
import { BidItem } from '../../constants';

interface DepositsTabProps {
  data: BidItem[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  onEndReached?: () => void;
  onItemPress?: (item: BidItem, index: number) => void;
  onScroll?: any;
  contentContainerStyle?: any;
}

export function DepositsTab({
  data,
  isLoading = false,
  isLoadingMore = false,
  refreshing = false,
  onRefresh,
  onEndReached,
  onItemPress,
  onScroll,
  contentContainerStyle,
}: DepositsTabProps) {
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['active', 'completed', 'refunded']);

  const depositStatuses = [
    { id: 'active', label: i18n.t('Profile.statusLabels.active'), color: '#4CAF50' },
    { id: 'completed', label: i18n.t('Profile.statusLabels.completed'), color: '#2196F3' },
    { id: 'refunded', label: i18n.t('Profile.statusLabels.refunded'), color: '#FF9800' },
  ];

  const toggleStatus = useCallback((statusId: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId]
    );
  }, []);

  const filteredData = data.filter((bid) => selectedStatuses.includes(bid.status));

  const renderHeaderComponent = useCallback(() => {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.statusFilterContainer}
        contentContainerStyle={styles.statusFilterContent}
      >
        {depositStatuses.map((status) => (
          <TouchableOpacity
            key={status.id}
            style={[
              styles.statusFilterChip,
              selectedStatuses.includes(status.id) && {
                backgroundColor: status.color,
              },
            ]}
            onPress={() => toggleStatus(status.id)}
          >
            <Text
              style={[
                styles.statusFilterChipText,
                selectedStatuses.includes(status.id) && styles.statusFilterChipTextActive,
              ]}
            >
              {status.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }, [selectedStatuses, depositStatuses, toggleStatus]);

  const renderBidItem = useCallback(
    ({ item, index }: { item: BidItem; index: number }) => (
      <TouchableOpacity
        style={styles.depositCard}
        onPress={() => onItemPress?.(item, index)}
      >
        <View style={styles.depositCardContent}>
          <Text style={styles.depositCardTitle}>{item.restaurantName}</Text>
          <Text style={styles.depositCardAmount}>
            {i18n.t('Search.currencySuffix')}{item.bidAmount.toLocaleString()}
          </Text>
          <View
            style={[
              styles.statusChip,
              {
                backgroundColor:
                  item.status === 'active'
                    ? '#4CAF50'
                    : item.status === 'completed'
                    ? '#2196F3'
                    : '#FF9800',
              },
            ]}
          >
            <Text style={styles.statusText}>
              {depositStatuses.find((s) => s.id === item.status)?.label || item.status}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    ),
    [onItemPress, depositStatuses]
  );

  const renderEmptyState = useCallback(() => {
    return (
      <View style={styles.emptyStateContainer}>
        <View style={styles.emptyStateCard}>
          <Text style={styles.emptyStateText}>
            {i18n.t('Profile.emptyState.noDeposits')}
          </Text>
        </View>
      </View>
    );
  }, []);

  return (
    <Tabs.FlatList
      data={filteredData}
      renderItem={renderBidItem}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderHeaderComponent}
      ListEmptyComponent={renderEmptyState}
      contentContainerStyle={[styles.container, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      onScroll={onScroll}
      scrollEventThrottle={16}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
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
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  statusFilterChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  statusFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  depositCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  depositCardContent: {
    padding: 16,
  },
  depositCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 8,
  },
  depositCardAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#5EA2FF',
    marginBottom: 8,
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusText: {
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "600",
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