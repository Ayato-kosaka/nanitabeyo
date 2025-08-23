import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { TabBarProps } from 'react-native-collapsible-tab-view';
import { Grid3x3 as Grid3X3, Bookmark, Heart, Wallet } from 'lucide-react-native';
import i18n from '@/lib/i18n';
import { PROFILE_TAB_GROUPS, TopLevelTab, ProfileTabRoute } from '../constants/tabRoutes';
import { useSharedValueState } from '@/hooks/useSharedValueState';

interface GroupedTabBarProps extends TabBarProps<ProfileTabRoute> {
  availableTopTabs: TopLevelTab[];
}

function getGroupForRoute(route: ProfileTabRoute): TopLevelTab {
  const entries = Object.entries(PROFILE_TAB_GROUPS) as [TopLevelTab, ProfileTabRoute[]][];
  for (const [group, routes] of entries) {
    if (routes.includes(route)) return group;
  }
  return 'reviews';
}

export function GroupedTabBar(props: GroupedTabBarProps) {
  const { tabNames, onTabPress, availableTopTabs, index } = props;
  const currentIndex = useSharedValueState(index);
  const activeRoute = tabNames[currentIndex] as ProfileTabRoute;
  const activeGroup = getGroupForRoute(activeRoute);

  const [lastRoute, setLastRoute] = React.useState<Partial<Record<TopLevelTab, ProfileTabRoute>>>(
    {
      saved: PROFILE_TAB_GROUPS.saved[0],
      wallet: PROFILE_TAB_GROUPS.wallet[0],
    },
  );

  React.useEffect(() => {
    setLastRoute((prev) => ({ ...prev, [activeGroup]: activeRoute }));
  }, [activeGroup, activeRoute]);

  const handleTopPress = (group: TopLevelTab) => {
    const routes = PROFILE_TAB_GROUPS[group];
    const target = lastRoute[group] || routes[0];
    onTabPress(target);
  };

  const handleSubPress = (route: ProfileTabRoute, group: TopLevelTab) => {
    setLastRoute((prev) => ({ ...prev, [group]: route }));
    onTabPress(route);
  };

  const renderTopIcon = (group: TopLevelTab) => {
    const isActive = activeGroup === group;
    const color = isActive ? '#5EA2FF' : '#666';
    switch (group) {
      case 'reviews':
        return <Grid3X3 size={20} color={color} />;
      case 'saved':
        return <Bookmark size={20} color={color} fill={isActive ? color : 'transparent'} />;
      case 'liked':
        return <Heart size={20} color={color} fill={isActive ? color : 'transparent'} />;
      case 'wallet':
        return <Wallet size={20} color={color} fill={isActive ? color : 'transparent'} />;
    }
  };

  return (
    <View>
      <View style={styles.topTabsContainer}>
        {availableTopTabs.map((group) => {
          const isActive = activeGroup === group;
          return (
            <TouchableOpacity
              key={group}
              style={[styles.topTab, isActive && styles.activeTopTab]}
              onPress={() => handleTopPress(group)}
            >
              {renderTopIcon(group)}
            </TouchableOpacity>
          );
        })}
      </View>
      {PROFILE_TAB_GROUPS[activeGroup].length > 1 && (
        <View style={styles.subTabsContainer}>
          {PROFILE_TAB_GROUPS[activeGroup].map((route) => {
            const isActive = activeRoute === route;
            return (
              <TouchableOpacity
                key={route}
                style={[styles.subTab, isActive && styles.activeSubTab]}
                onPress={() => handleSubPress(route, activeGroup)}
              >
                <Text style={[styles.subTabText, isActive && styles.activeSubTabText]}>
                  {i18n.t(`Profile.tabs.${route}`)}
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
  topTabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
  },
  topTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  activeTopTab: {
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
