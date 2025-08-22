import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';

interface SaveSubTabsBarProps {
  state: {
    index: number;
    routes: Array<{ key: string; title?: string }>;
  };
  jumpTo: (key: string) => void;
}

export function SaveSubTabsBar({ state, jumpTo }: SaveSubTabsBarProps) {
  return (
    <View style={styles.container}>
      {state.routes.map((route, index) => (
        <TouchableOpacity
          key={route.key}
          style={[styles.tab, state.index === index && styles.activeTab]}
          onPress={() => jumpTo(route.key)}>
          <Text style={[styles.tabText, state.index === index && styles.activeTabText]}>
            {route.title}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#5EA2FF',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});