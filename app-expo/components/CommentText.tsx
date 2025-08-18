import React, { useState, useEffect } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { getRemoteConfig } from "@/lib/remoteConfig";

interface CommentTextProps {
	text: string;
	style?: any;
	testID?: string;
}

export const CommentText: React.FC<CommentTextProps> = ({ text, style, testID }) => {
	const [visibleLength, setVisibleLength] = useState<number>(0);
	const [characterLimit, setCharacterLimit] = useState<number>(100); // default fallback

	useEffect(() => {
		// Get character limit from remote config
		const remoteConfig = getRemoteConfig();
		if (remoteConfig?.v1_dish_comment_review_show_number) {
			const limit = parseInt(remoteConfig.v1_dish_comment_review_show_number, 10);
			if (!isNaN(limit) && limit > 0) {
				setCharacterLimit(limit);
				setVisibleLength(limit);
				return;
			}
		}
		// Fallback to default
		setVisibleLength(characterLimit);
	}, []);

	const needsTruncation = text.length > visibleLength;
	const displayText = needsTruncation ? text.slice(0, visibleLength) : text;
	const hasMoreToShow = visibleLength < text.length;

	const handleSeeMore = () => {
		const newLength = Math.min(visibleLength + characterLimit, text.length);
		setVisibleLength(newLength);
	};

	if (visibleLength === 0) {
		// Still loading remote config, show nothing or loading state
		return <Text style={style}>{text}</Text>;
	}

	return (
		<View style={styles.container}>
			<Text style={style} testID={testID}>
				{displayText}
				{hasMoreToShow && (
					<Text onPress={handleSeeMore} style={styles.seeMoreText}>
						{" "}
						see more
					</Text>
				)}
			</Text>
		</View>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	seeMoreText: {
		color: "#5EA2FF",
		fontWeight: "600",
		fontSize: 14,
	},
});
