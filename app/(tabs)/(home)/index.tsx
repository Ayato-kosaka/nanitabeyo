import React from 'react';
import FoodContentFeed from '@/components/FoodContentFeed';
import { foodItems } from '@/data/foodData';

export default function HomeScreen() {
  return <FoodContentFeed items={foodItems} />;
}
