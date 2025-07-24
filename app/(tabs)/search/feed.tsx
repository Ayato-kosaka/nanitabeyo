import React from 'react';
import { View, StyleSheet } from 'react-native';
import FeedScreen from '../../feed';

export default function SearchFeedScreen() {
  return (
    <View style={styles.container}>
      <FeedScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});