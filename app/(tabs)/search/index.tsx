import React from 'react';
import { View, StyleSheet } from 'react-native';
import SearchScreen from '../../search';

export default function SearchIndexScreen() {
  return (
    <View style={styles.container}>
      <SearchScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});