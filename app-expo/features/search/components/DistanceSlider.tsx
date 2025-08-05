import React from "react";
import { View, Text, PanResponder } from "react-native";
import { distanceOptions } from "@/features/search/constants";

// Slider component to choose search distance
export function DistanceSlider({
        distance,
        setDistance,
}: {
        distance: number;
        setDistance: (value: number) => void;
}) {
        const currentIndex = distanceOptions.findIndex((option) => option.value === distance);
        const sliderWidth = 280;
        const thumbWidth = 24;
        const trackWidth = sliderWidth - thumbWidth;
        const thumbPosition = (currentIndex / (distanceOptions.length - 1)) * trackWidth;

        const panResponder = PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onMoveShouldSetPanResponder: () => true,
                onPanResponderMove: (evt, gestureState) => {
                        const newPosition = Math.max(0, Math.min(trackWidth, gestureState.moveX - 50));
                        const newIndex = Math.round((newPosition / trackWidth) * (distanceOptions.length - 1));
                        if (newIndex !== currentIndex && newIndex >= 0 && newIndex < distanceOptions.length) {
                                setDistance(distanceOptions[newIndex].value);
                        }
                },
        });

        return (
                <View style={styles.sliderContainer}>
                        <View style={styles.sliderTrack}>
                                <View style={[styles.sliderThumb, { left: thumbPosition }]} {...panResponder.panHandlers} />
                        </View>
                        <View style={styles.sliderLabels}>
                                <Text style={styles.sliderLabelLeft}>近い</Text>
                                <Text style={styles.sliderLabelRight}>遠い</Text>
                        </View>
                </View>
        );
}

// Styles mirror the ones in the original screen
const styles = {
        sliderContainer: {
                width: 300,
                justifyContent: "center",
        },
        sliderTrack: {
                height: 6,
                backgroundColor: "#E5E7EB",
                borderRadius: 3,
                position: "relative",
                marginHorizontal: 16,
        },
        sliderThumb: {
                position: "absolute",
                width: 28,
                height: 28,
                backgroundColor: "#5EA2FF",
                borderRadius: 14,
                top: -11,
                borderWidth: 3,
                borderColor: "#FFFFFF",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 8,
                elevation: 6,
        },
        sliderLabels: {
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 12,
                paddingHorizontal: 16,
        },
        sliderLabelLeft: {
                fontSize: 13,
                color: "#6B7280",
                fontWeight: "500",
        },
        sliderLabelRight: {
                fontSize: 13,
                color: "#6B7280",
                fontWeight: "500",
        },
} as const;
