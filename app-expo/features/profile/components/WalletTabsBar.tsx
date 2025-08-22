import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Wallet, DollarSign } from 'lucide-react-native';

interface WalletTabsBarProps {
  state: {
    index: number;
    routes: Array<{ key: string; title?: string }>;
  };
  jumpTo: (key: string) => void;
}

export function WalletTabsBar({ state, jumpTo }: WalletTabsBarProps) {
  const renderIcon = (key: string, isActive: boolean) => {
    const color = isActive ? '#FFFFFF' : '#666';
    switch (key) {
      case 'deposits':
        return <Wallet size={16} color={color} />;
      case 'earnings':
        return <DollarSign size={16} color={color} />;
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {state.routes.map((route, index) => {
        const isActive = state.index === index;
        return (
          <TouchableOpacity
            key={route.key}
            style={[styles.tab, isActive && styles.activeTab]}
            onPress={() => jumpTo(route.key)}>
            {renderIcon(route.key, isActive)}
            <Text style={[styles.tabText, isActive && styles.activeTabText]}>
              {route.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: 'transparent',
    elevation: 0,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    gap: 8,
  },
  activeTab: {
    backgroundColor: 'white',
    borderRadius: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#5EA2FF',
    fontWeight: '600',
  },
});