import React, { useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import StoryScreen from '@/components/StoryScreen';
import { foodItems } from '@/data/foodData';
import { FoodItem } from '@/types';

const { height } = Dimensions.get('window');

export default function HomeScreen() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [items, setItems] = useState<FoodItem[]>(foodItems);
  const translateY = useRef(new Animated.Value(0)).current;

  const handleLike = () => {
    setItems(prevItems => 
      prevItems.map((item, index) => 
        index === currentIndex 
          ? { 
              ...item, 
              isLiked: !item.isLiked,
              likes: item.isLiked ? item.likes - 1 : item.likes + 1
            }
          : item
      )
    );
  };

  const handleSave = () => {
    setItems(prevItems => 
      prevItems.map((item, index) => 
        index === currentIndex 
          ? { ...item, isSaved: !item.isSaved }
          : item
      )
    );
  };

  const handleAddComment = (text: string) => {
    const newComment = {
      id: Date.now().toString(),
      username: 'you',
      text,
      timestamp: 'now',
    };

    setItems(prevItems => 
      prevItems.map((item, index) => 
        index === currentIndex 
          ? { ...item, comments: [newComment, ...item.comments] }
          : item
      )
    );
  };

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationY: translateY } }],
    { useNativeDriver: true }
  );

  const onHandlerStateChange = (event: any) => {
    if (event.nativeEvent.oldState === 4) { // END state
      const { translationY } = event.nativeEvent;
      
      if (translationY < -height * 0.2 && currentIndex < items.length - 1) {
        // Swipe up - next item
        setCurrentIndex(currentIndex + 1);
      } else if (translationY > height * 0.2 && currentIndex > 0) {
        // Swipe down - previous item
        setCurrentIndex(currentIndex - 1);
      }
      
      // Reset animation
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  };

  const currentItem = items[currentIndex];

  return (
    <PanGestureHandler
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
    >
      <Animated.View 
        style={[
          styles.container,
          {
            transform: [{ translateY }]
          }
        ]}
      >
        <StoryScreen
          item={currentItem}
          onLike={handleLike}
          onSave={handleSave}
          onAddComment={handleAddComment}
        />
      </Animated.View>
    </PanGestureHandler>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});