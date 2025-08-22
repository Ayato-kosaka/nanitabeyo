import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface WalletTabsBarProps {
  state: {
    index: number;
    routes: Array<{ key: string; title: string }>;
  };
  jumpTo: (key: string) => void;
}

export function WalletTabsBar({ state, jumpTo }: WalletTabsBarProps) {
  return (
    <View style={styles.walletTabsContainer}>
      {state.routes.map((route, index) => {
        const isActive = state.index === index;
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