import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Image } from 'react-native';
import { Tabs } from '@/features/profile/lib/collapsible-tabs';
import { useHaptics } from '@/hooks/useHaptics';
import i18n from '@/lib/i18n';
import { mockBids, BidItem } from '@/features/profile/constants';

export function DepositsTab() {
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['active', 'completed', 'refunded']);
  const { lightImpact } = useHaptics();

  const depositStatuses = [
    { id: 'active', label: i18n.t('Profile.statusLabels.active'), color: '#4CAF50' },
    { id: 'completed', label: i18n.t('Profile.statusLabels.completed'), color: '#2196F3' },
    { id: 'refunded', label: i18n.t('Profile.statusLabels.refunded'), color: '#FF9800' },
  ];

  const toggleStatus = (statusId: string) => {
    lightImpact();
    setSelectedStatuses((prev) =>
      prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
    );
  };

  const filteredBids = mockBids.filter((bid) => selectedStatuses.includes(bid.status));

  const renderBidItem = ({ item }: { item: BidItem }) => (
    <View style={styles.depositCard}>
      <View style={styles.depositHeader}>
        <Image
          source={{ uri: item.restaurantImageUrl }}
          style={styles.depositAvatar}
          onError={() => console.log('Failed to load restaurant image')}
        />
        <View style={styles.depositInfo}>
          <Text style={styles.depositRestaurantName}>{item.restaurantName}</Text>
          <Text style={styles.depositAmount}>
            {i18n.t('Search.currencySuffix')}
            {item.bidAmount.toLocaleString()}
          </Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: getStatusColor(item.status) }]}>
          <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
        </View>
      </View>
      <Text style={styles.depositDays}>{i18n.t('Common.daysRemaining', { count: item.remainingDays })}</Text>
    </View>
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return '#4CAF50';
      case 'completed':
        return '#2196F3';
      case 'refunded':
        return '#FF9800';
      default:
        return '#666';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return i18n.t('Profile.statusLabels.active');
      case 'completed':
        return i18n.t('Profile.statusLabels.completed');
      case 'refunded':
        return i18n.t('Profile.statusLabels.refunded');
      default:
        return status;
    }
  };

  const renderListHeader = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.statusFilterContainer}
      contentContainerStyle={styles.statusFilterContent}>
      {depositStatuses.map((status) => (
        <TouchableOpacity
          key={status.id}
          style={[
            styles.statusFilterChip,
            selectedStatuses.includes(status.id) && {
              backgroundColor: status.color,
            },
          ]}
          onPress={() => toggleStatus(status.id)}>
          <Text
            style={[
              styles.statusFilterChipText,
              selectedStatuses.includes(status.id) && styles.statusFilterChipTextActive,
            ]}>
            {status.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  return (
    <Tabs.FlatList
      data={filteredBids}
      renderItem={renderBidItem}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={renderListHeader}
      contentContainerStyle={styles.depositsList}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <View style={styles.emptyStateContainer}>
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateText}>{i18n.t('Profile.emptyState.noDeposits')}</Text>
          </View>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  statusFilterContainer: {
    marginHorizontal: 16,
    marginVertical: 16,
  },
  statusFilterContent: {
    paddingHorizontal: 0,
  },
  statusFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    marginRight: 8,
  },
  statusFilterChipText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  statusFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  depositsList: {
    paddingHorizontal: 16,
  },
  depositCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  depositHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  depositAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  depositInfo: {
    flex: 1,
  },
  depositRestaurantName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  depositAmount: {
    fontSize: 14,
    color: '#5EA2FF',
    fontWeight: '500',
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  depositDays: {
    fontSize: 12,
    color: '#666',
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