import React, { useState, useRef } from 'react';
import { StyleSheet, Animated, Dimensions } from 'react-native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import FoodContentScreen from './FoodContentScreen';
import { FoodItem } from '@/types';

const { height } = Dimensions.get('window');

interface FoodContentFeedProps {
  items: FoodItem[];
  initialIndex?: number;
}

export default function FoodContentFeed({ items, initialIndex = 0 }: FoodContentFeedProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [feedItems, setFeedItems] = useState<FoodItem[]>(items);
  const translateY = useRef(new Animated.Value(0)).current;

  const handleLike = () => {
    setFeedItems((prevItems) =>
      prevItems.map((item, index) =>
        index === currentIndex
          ? {
              ...item,
              isLiked: !item.isLiked,
              likes: item.isLiked ? item.likes - 1 : item.likes + 1,
            }
          : item,
      ),
    );
  };

  const handleSave = () => {
    setFeedItems((prevItems) =>
      prevItems.map((item, index) =>
        index === currentIndex ? { ...item, isSaved: !item.isSaved } : item,
      ),
    );
  };

  const handleAddComment = (text: string) => {
    const newComment = {
      id: Date.now().toString(),
      username: 'you',
      text,
      timestamp: 'now',
    };

    setFeedItems((prevItems) =>
      prevItems.map((item, index) =>
        index === currentIndex
          ? { ...item, comments: [newComment, ...item.comments] }
          : item,
      ),
    );
  };

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationY: translateY } }],
    { useNativeDriver: true },
  );

  const onHandlerStateChange = (event: any) => {
    if (event.nativeEvent.oldState === 4) {
      const { translationY } = event.nativeEvent;

      if (translationY < -height * 0.2 && currentIndex < feedItems.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else if (translationY > height * 0.2 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }

      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  };

  const currentItem = feedItems[currentIndex];

  return (
    <PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
      <Animated.View
        style={[
          styles.container,
          {
            transform: [{ translateY }],
          },
        ]}
      >
        <FoodContentScreen item={currentItem} onLike={handleLike} onSave={handleSave} onAddComment={handleAddComment} />
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
