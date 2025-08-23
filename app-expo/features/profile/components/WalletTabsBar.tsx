import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { TabBarProps } from 'react-native-collapsible-tab-view';
import i18n from '@/lib/i18n';

export function WalletTabsBar(props: TabBarProps) {
  const { tabNames, index, onTabPress } = props;
  
  // Convert collapsible tab view props to our expected format
  const state = {
    index: index.value || 0,
    routes: tabNames.map(name => ({ 
      key: name, 
      title: i18n.t(`Profile.tabs.${name}`) 
    })),
  };
  
  const jumpTo = (key: string) => {
    onTabPress(key);
  };

  return (
    <View style={styles.walletTabsContainer}>
      {state.routes.map((route, routeIndex) => {
        const isActive = state.index === routeIndex;
        return (
          <TouchableOpacity
            key={route.key}
            style={[styles.walletTab, isActive && styles.activeWalletTab]}
            onPress={() => jumpTo(route.key)}
          >
            <Text style={[styles.walletTabText, isActive && styles.activeWalletTabText]}>
              {route.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  walletTabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  walletTab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    marginHorizontal: 4,
    borderRadius: 32,
  },
  activeWalletTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  walletTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  activeWalletTabText: {
    color: '#5EA2FF',
    fontWeight: '600',
  },
});