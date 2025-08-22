import React from 'react';
import { Tabs } from '@/features/profile/lib/collapsible-tabs';
import { WalletTabsBar } from '@/features/profile/components/WalletTabsBar';
import { DepositsTab } from './wallet/DepositsTab';
import { EarningsTab } from './wallet/EarningsTab';
import i18n from '@/lib/i18n';

export function WalletTab() {
  return (
    <Tabs.Container
      headerHeight={0}
      renderTabBar={WalletTabsBar as any}>
      <Tabs.Tab name="deposits">
        <DepositsTab />
      </Tabs.Tab>
      <Tabs.Tab name="earnings">
        <EarningsTab />
      </Tabs.Tab>
    </Tabs.Container>
  );
}