import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function LikesScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Liked Items</Text>
      <Text style={styles.subtitle}>Your favorite dishes and reviews</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  text: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#CCCCCC',
  },
});