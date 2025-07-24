import React, { useState } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { Stack } from 'expo-router';
import SearchScreen from '../search';

export default function SearchTabScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="recommendations" />
        <Stack.Screen name="feed" />
      </Stack>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF7FF',
  },
});