import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { GridList } from '@/features/profile/components/GridList';
import { useHaptics } from '@/hooks/useHaptics';
import i18n from '@/lib/i18n';
import { mockEarnings, EarningItem } from '@/features/profile/constants';

export function EarningsTab() {
  const [selectedEarningStatuses, setSelectedEarningStatuses] = useState<string[]>(['paid', 'pending']);
  const { lightImpact } = useHaptics();

  const earningStatuses = [
    { id: 'paid', label: i18n.t('Profile.statusLabels.paid'), color: '#4CAF50' },
    { id: 'pending', label: i18n.t('Profile.statusLabels.pending'), color: '#FF9800' },
  ];

  const toggleEarningStatus = (statusId: string) => {
    lightImpact();
    setSelectedEarningStatuses((prev) =>
      prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId],
    );
  };

  const filteredEarnings = mockEarnings.filter((earning) => selectedEarningStatuses.includes(earning.status));

  // Convert EarningItem to format expected by GridList
  const convertedData = filteredEarnings.map((item) => ({
    dish_media: {
      id: item.id,
      thumbnailImageUrl: item.imageUrl,
    },
    dish: {
      averageRating: 0, // Not used for earnings
      reviewCount: 0, // Not used for earnings
    },
    // Store earning data for overlay
    earningData: item,
  }));

  const renderListHeader = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.statusFilterContainer}
      contentContainerStyle={styles.statusFilterContent}>
      {earningStatuses.map((status) => (
        <TouchableOpacity
          key={status.id}
          style={[
            styles.statusFilterChip,
            selectedEarningStatuses.includes(status.id) && {
              backgroundColor: status.color,
            },
          ]}
          onPress={() => toggleEarningStatus(status.id)}>
          <Text
            style={[
              styles.statusFilterChipText,
              selectedEarningStatuses.includes(status.id) && styles.statusFilterChipTextActive,
            ]}>
            {status.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderEmptyComponent = () => (
    <View style={styles.emptyStateContainer}>
      <View style={styles.emptyStateCard}>
        <Text style={styles.emptyStateText}>{i18n.t('Profile.emptyState.noEarnings')}</Text>
      </View>
    </View>
  );

  return (
    <GridList
      data={convertedData as any}
      numColumns={3}
      onItemPress={() => {}} // No action needed for earnings
      renderEmptyComponent={renderEmptyComponent}
      ListHeaderComponent={renderListHeader()}
    />
  );
}

const styles = StyleSheet.create({
  statusFilterContainer: {
    marginHorizontal: 0,
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