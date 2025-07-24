import React from 'react';
import { View, StyleSheet } from 'react-native';
import TopicsScreen from '../../topics';

export default function SearchTopicsScreen() {
  return (
    <View style={styles.container}>
      <TopicsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});