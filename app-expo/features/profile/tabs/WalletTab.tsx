import React from 'react';
import { Tabs } from '@/components/collapsible-tabs';
import { WalletTabsBar } from '../components/WalletTabsBar';
import { DepositsTab } from './wallet/DepositsTab';
import { EarningsTab } from './wallet/EarningsTab';
import i18n from '@/lib/i18n';
import { BidItem, EarningItem } from '../constants';

interface WalletTabProps {
  deposits: BidItem[];
  earnings: EarningItem[];
  isLoadingDeposits?: boolean;
  isLoadingEarnings?: boolean;
  isLoadingMoreDeposits?: boolean;
  isLoadingMoreEarnings?: boolean;
  refreshingDeposits?: boolean;
  refreshingEarnings?: boolean;
  onRefreshDeposits?: () => void;
  onRefreshEarnings?: () => void;
  onEndReachedDeposits?: () => void;
  onEndReachedEarnings?: () => void;
  onDepositPress?: (item: BidItem, index: number) => void;
  onEarningPress?: (item: EarningItem, index: number) => void;
  onScroll?: any;
  contentContainerStyle?: any;
}

export function WalletTab({
  deposits,
  earnings,
  isLoadingDeposits = false,
  isLoadingEarnings = false,
  isLoadingMoreDeposits = false,
  isLoadingMoreEarnings = false,
  refreshingDeposits = false,
  refreshingEarnings = false,
  onRefreshDeposits,
  onRefreshEarnings,
  onEndReachedDeposits,
  onEndReachedEarnings,
  onDepositPress,
  onEarningPress,
  onScroll,
  contentContainerStyle,
}: WalletTabProps) {
  return (
    <Tabs.Container
      headerHeight={0}
      renderTabBar={WalletTabsBar}
      initialTabName="deposits"
    >
      <Tabs.Tab name="deposits">
        <DepositsTab
          data={deposits}
          isLoading={isLoadingDeposits}
          isLoadingMore={isLoadingMoreDeposits}
          refreshing={refreshingDeposits}
          onRefresh={onRefreshDeposits}
          onEndReached={onEndReachedDeposits}
          onItemPress={onDepositPress}
        />
      </Tabs.Tab>

      <Tabs.Tab name="earnings">
        <EarningsTab
          data={earnings}
          isLoading={isLoadingEarnings}
          isLoadingMore={isLoadingMoreEarnings}
          refreshing={refreshingEarnings}
          onRefresh={onRefreshEarnings}
          onEndReached={onEndReachedEarnings}
          onItemPress={onEarningPress}
        />
      </Tabs.Tab>
    </Tabs.Container>
  );
}