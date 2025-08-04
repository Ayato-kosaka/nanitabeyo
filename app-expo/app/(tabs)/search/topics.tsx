// TopicsScreen - Expo Router page rendering TopicList with useTopicsData hook
import React from 'react';
import { TopicList } from '@/features/topics/TopicList';
import { useTopicsData } from '@/features/topics/hooks/useTopicsData';

export default function TopicsScreen() {
  const topicsData = useTopicsData();
  return <TopicList {...topicsData} />;
}
