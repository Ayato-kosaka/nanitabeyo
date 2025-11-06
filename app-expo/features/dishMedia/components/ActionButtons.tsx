import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Heart, Bookmark, Share, MapPinned } from "lucide-react-native";

interface ActionButtonsProps {
        restaurantImageUrl: string;
        onPressRestaurant: () => void;
        isLiked: boolean;
        likesText: string;
        onLike: () => void;
        isSaved: boolean;
        onSave: () => void;
        onShare: () => void;
        onOpenMap: () => void;
        shareLabel: string;
        mapLabel: string;
        onLayout?: (width: number) => void;
}

// ボタン押下時の副作用は親が提供するハンドラに委譲
const ActionButtons: React.FC<ActionButtonsProps> = ({
        restaurantImageUrl,
        onPressRestaurant,
        isLiked,
        likesText,
        onLike,
        isSaved,
        onSave,
        onShare,
        onOpenMap,
        shareLabel,
        mapLabel,
        onLayout,
}) => {
        const handleLayout = (event: LayoutChangeEvent) => {
                onLayout?.(event.nativeEvent.layout.width);
        };

        return (
                <View style={styles.rightActions} onLayout={handleLayout}>
                        <TouchableOpacity style={styles.actionButton} onPress={onPressRestaurant}>
                                <Image
                                        source={{ uri: restaurantImageUrl }}
                                        style={styles.restaurantAvatar}
                                        onError={() => console.log("Failed to load restaurant avatar")}
                                />
                        </TouchableOpacity>

                        <View style={styles.actionContainer}>
                                <TouchableOpacity style={styles.actionButton} onPress={onLike}>
                                        <Heart size={28} color={isLiked ? "#FF3040" : "#FFFFFF"} fill={isLiked ? "#FF3040" : "white"} />
                                </TouchableOpacity>
                                <Text style={styles.actionText}>{likesText}</Text>
                        </View>

                        <TouchableOpacity style={styles.actionButton} onPress={onSave}>
                                <Bookmark size={30} color={"transparent"} fill={isSaved ? "orange" : "white"} />
                        </TouchableOpacity>

                        <View style={styles.actionContainer}>
                                <TouchableOpacity style={styles.actionButton} onPress={onShare}>
                                        <Share size={28} color="#FFFFFF" />
                                </TouchableOpacity>
                                <Text style={styles.actionText}>{shareLabel}</Text>
                        </View>

                        <View style={styles.actionContainer}>
                                <TouchableOpacity style={styles.actionButton} onPress={onOpenMap}>
                                        <MapPinned size={28} color="#FFFFFF" />
                                </TouchableOpacity>
                                <Text style={styles.actionText}>{mapLabel}</Text>
                        </View>
                </View>
        );
};

const styles = StyleSheet.create({
        rightActions: {
                alignItems: "center",
                gap: 16,
        },
        actionContainer: {
                alignItems: "center",
        },
        actionButton: {
                padding: 4,
        },
        restaurantAvatar: {
                width: 40,
                height: 40,
                borderRadius: 20,
        },
        actionText: {
                fontSize: 13,
                fontWeight: "500",
                color: "#FFFFFF",
                marginTop: 4,
                letterSpacing: 0.2,
        },
});

export default ActionButtons;
