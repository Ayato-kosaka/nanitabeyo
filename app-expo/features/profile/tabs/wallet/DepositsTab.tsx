import React, { useState, useCallback } from 'react';
import { View, ScrollView, TouchableOpacity, Text, FlatList, StyleSheet, Image } from 'react-native';
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
        <View style={styles.depositHeader}>
          <Image
            source={{ uri: item.restaurantImageUrl }}
            style={styles.depositAvatar}
            onError={() => console.log("Failed to load restaurant image")}
          />
          <View style={styles.depositInfo}>
            <Text style={styles.depositRestaurantName}>{item.restaurantName}</Text>
            <Text style={styles.depositAmount}>
              {i18n.t("Search.currencySuffix")}
              {item.bidAmount.toLocaleString()}
            </Text>
          </View>
          <View style={[styles.statusChip, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
          </View>
        </View>
        <Text style={styles.depositDays}>{i18n.t("Common.daysRemaining", { count: item.remainingDays })}</Text>
      </TouchableOpacity>
    ),
    [onItemPress]
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "#4CAF50";
      case "completed":
        return "#2196F3";
      case "refunded":
        return "#FF9800";
      default:
        return "#666";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "active":
        return i18n.t("Profile.statusLabels.active");
      case "completed":
        return i18n.t("Profile.statusLabels.completed");
      case "refunded":
        return i18n.t("Profile.statusLabels.refunded");
      default:
        return status;
    }
  };

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
  depositHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  depositAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  depositInfo: {
    flex: 1,
  },
  depositRestaurantName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 2,
    letterSpacing: -0.3,
  },
  depositAmount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#5EA2FF",
    letterSpacing: -0.3,
  },
  depositDays: {
    fontSize: 15,
    color: "#6B7280",
    fontWeight: "500",
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