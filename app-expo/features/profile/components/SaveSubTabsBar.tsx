import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface SaveSubTabsBarProps {
  state: {
    index: number;
    routes: Array<{ key: string; title: string }>;
  };
  jumpTo: (key: string) => void;
}

export function SaveSubTabsBar({ state, jumpTo }: SaveSubTabsBarProps) {
  return (
    <View style={styles.subTabsContainer}>
      {state.routes.map((route, index) => {
        const isActive = state.index === index;
        return (
          <TouchableOpacity
            key={route.key}
            style={[styles.subTab, isActive && styles.activeSubTab]}
            onPress={() => jumpTo(route.key)}
          >
            <Text style={[styles.subTabText, isActive && styles.activeSubTabText]}>
              {route.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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