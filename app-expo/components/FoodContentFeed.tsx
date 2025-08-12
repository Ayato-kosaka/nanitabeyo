import React, { useState, useRef, useEffect } from "react";
import { StyleSheet, Animated, Dimensions } from "react-native";
import { PanGestureHandler } from "react-native-gesture-handler";
import FoodContentScreen from "./FoodContentScreen";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import type { DishMediaEntry } from "@shared/api/v1/res";

const { height } = Dimensions.get("window");

interface FoodContentFeedProps {
	items: DishMediaEntry[];
	initialIndex?: number;
	onIndexChange?: (index: number) => void;
}

export default function FoodContentFeed({ items, initialIndex = 0, onIndexChange }: FoodContentFeedProps) {
	const [currentIndex, setCurrentIndex] = useState(initialIndex);
	const translateY = useRef(new Animated.Value(0)).current;
	const { selectionChanged } = useHaptics();
	const { logFrontendEvent } = useLogger();

	useEffect(() => {
		// Log component mount with initial state
		logFrontendEvent({
			event_name: "food_feed_mounted",
			error_level: "log",
			payload: {
				itemCount: items.length,
				initialIndex,
				hasItems: items.length > 0,
			},
		});
	}, [items.length, initialIndex, logFrontendEvent]);

	const updateIndex = (newIndex: number) => {
		selectionChanged();
		const previousIndex = currentIndex;
		setCurrentIndex(newIndex);
		onIndexChange?.(newIndex);

		// Log swipe navigation
		logFrontendEvent({
			event_name: "food_feed_swipe",
			error_level: "log",
			payload: {
				fromIndex: previousIndex,
				toIndex: newIndex,
				direction: newIndex > previousIndex ? "down" : "up",
				currentItemId: items[newIndex]?.dish_media.id,
			},
		});
	};

	const onGestureEvent = Animated.event([{ nativeEvent: { translationY: translateY } }], { useNativeDriver: true });

	const onHandlerStateChange = (event: any) => {
		if (event.nativeEvent.oldState === 4) {
			const { translationY } = event.nativeEvent;

			if (translationY < -height * 0.2 && currentIndex < items.length - 1) {
				updateIndex(currentIndex + 1);
			} else if (translationY > height * 0.2 && currentIndex > 0) {
				updateIndex(currentIndex - 1);
			}

			Animated.timing(translateY, {
				toValue: 0,
				useNativeDriver: true,
			}).start();
		}
	};

	const currentItem = items[currentIndex];

	if (!currentItem) {
		return null;
	}

	return (
		<PanGestureHandler onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
			<Animated.View
				style={[
					styles.container,
					{
						transform: [{ translateY }],
					},
				]}>
				<FoodContentScreen item={currentItem} />
			</Animated.View>
		</PanGestureHandler>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#000",
	},
});
