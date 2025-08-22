import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Heart, Grid3x3 as Grid3X3, Bookmark, Wallet } from 'lucide-react-native';

type TabType = 'reviews' | 'saved' | 'liked' | 'wallet';

interface ProfileTabsBarProps {
  state: {
    index: number;
    routes: Array<{ key: string; title?: string }>;
  };
  jumpTo: (key: string) => void;
  availableTabs: TabType[];
}

export function ProfileTabsBar({ state, jumpTo, availableTabs }: ProfileTabsBarProps) {
  const renderTabIcon = (tab: TabType) => {
    const isActive = state.routes[state.index]?.key === tab;
    const iconColor = isActive ? '#5EA2FF' : '#666';

    switch (tab) {
      case 'reviews':
        return <Grid3X3 size={20} color={iconColor} />;
      case 'saved':
        return <Bookmark size={20} color={iconColor} fill={isActive ? iconColor : 'transparent'} />;
      case 'wallet':
        return <Wallet size={20} color={iconColor} fill={isActive ? iconColor : 'transparent'} />;
      case 'liked':
        return <Heart size={20} color={iconColor} fill={isActive ? iconColor : 'transparent'} />;
    }
  };

  return (
    <View style={styles.tabsContainer}>
      {availableTabs.map((tab) => (
        <TouchableOpacity
          key={tab}
          style={[styles.tab, state.routes[state.index]?.key === tab && styles.activeTab]}
          onPress={() => jumpTo(tab)}>
          {renderTabIcon(tab)}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 8,
    marginHorizontal: 16,
    marginVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  activeTab: {
    backgroundColor: '#F0F8FF',
  },
});