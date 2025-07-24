import React from 'react';
import { View, StyleSheet } from 'react-native';
import RecommendationsScreen from '../../recommendations';

export default function SearchRecommendationsScreen() {
  return (
    <View style={styles.container}>
      <RecommendationsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});