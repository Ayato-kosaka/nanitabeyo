import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Grid3x3 as Grid3X3, Bookmark, Wallet, Heart } from 'lucide-react-native';
import type { TabBarProps } from 'react-native-collapsible-tab-view';
import i18n from '@/lib/i18n';
import { useSharedValueState } from '@/hooks/useSharedValueState';

type GroupType = 'reviews' | 'saved' | 'liked' | 'wallet';

interface GroupedTabBarProps extends TabBarProps<string> {
  availableTabs: GroupType[];
}

const GROUP_ROUTES: Record<GroupType, string[]> = {
  reviews: ['reviews'],
  saved: ['saved-posts', 'saved-topics'],
  liked: ['liked'],
  wallet: ['wallet-deposit', 'wallet-earning'],
} as const;

export function GroupedTabBar({ tabNames, index, onTabPress, availableTabs }: GroupedTabBarProps) {
  const currentIndex = useSharedValueState(index);
  const activeRoute = tabNames[currentIndex] ?? tabNames[0];

  const [lastRoute, setLastRoute] = React.useState<{ [K in GroupType]?: string }>(
    { saved: 'saved-posts', wallet: 'wallet-deposit' }
  );

  const getGroupByRoute = React.useCallback((route: string): GroupType => {
    const entry = Object.entries(GROUP_ROUTES).find(([, routes]) => routes.includes(route));
    return (entry ? entry[0] : route) as GroupType;
  }, []);

  const activeGroup = getGroupByRoute(activeRoute);

  const handleGroupPress = (group: GroupType) => {
    const routes = GROUP_ROUTES[group];
    const target = routes.length === 1 ? routes[0] : lastRoute[group] || routes[0];
    onTabPress(target);
  };

  const handleSubTabPress = (route: string) => {
    const group = getGroupByRoute(route);
    setLastRoute((prev) => ({ ...prev, [group]: route }));
    onTabPress(route);
  };

  const renderIcon = (group: GroupType, isActive: boolean) => {
    const color = isActive ? '#5EA2FF' : '#666';
    switch (group) {
      case 'reviews':
        return <Grid3X3 size={20} color={color} />;
      case 'saved':
        return <Bookmark size={20} color={color} fill={isActive ? color : 'transparent'} />;
      case 'wallet':
        return <Wallet size={20} color={color} fill={isActive ? color : 'transparent'} />;
      case 'liked':
        return <Heart size={20} color={color} fill={isActive ? color : 'transparent'} />;
    }
  };

  const filteredGroups = availableTabs.filter((g) => GROUP_ROUTES[g]);

  return (
    <View>
      <View style={styles.tabsContainer}>
        {filteredGroups.map((group) => {
          const isActive = activeGroup === group;
          return (
            <TouchableOpacity
              key={group}
              style={[styles.tab, isActive && styles.activeTab]}
              onPress={() => handleGroupPress(group)}
            >
              {renderIcon(group, isActive)}
            </TouchableOpacity>
          );
        })}
      </View>
      {GROUP_ROUTES[activeGroup].length > 1 && (
        <View style={styles.subTabsContainer}>
          {GROUP_ROUTES[activeGroup].map((route) => {
            const isActive = activeRoute === route;
            const label =
              route === 'saved-posts'
                ? i18n.t('Profile.tabs.saved-posts')
                : route === 'saved-topics'
                ? i18n.t('Profile.tabs.saved-topics')
                : route === 'wallet-deposit'
                ? i18n.t('Profile.tabs.deposits')
                : i18n.t('Profile.tabs.earnings');
            return (
              <TouchableOpacity
                key={route}
                style={[styles.subTab, isActive && styles.activeSubTab]}
                onPress={() => handleSubTabPress(route)}
              >
                <Text style={[styles.subTabText, isActive && styles.activeSubTabText]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#5EA2FF',
  },
  subTabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  subTab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    marginHorizontal: 4,
    borderRadius: 32,
  },
  activeSubTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  subTabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  activeSubTabText: {
    color: '#5EA2FF',
    fontWeight: '600',
  },
});
