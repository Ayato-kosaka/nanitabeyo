import React, { useCallback } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { GridList } from "../../components/GridList";
import { ImageCard } from "@/components/ImageCardGrid";
import i18n from "@/lib/i18n";

// Mock data type for saved topics
interface SavedTopic {
	id: string;
	name: string;
	imageUrl: string;
	savedCount: number;
}

interface SaveTopicTabProps {
	data: SavedTopic[];
	isLoading?: boolean;
	isLoadingMore?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	onEndReached?: () => void;
	onItemPress?: (item: SavedTopic, index: number) => void;
	onScroll?: any;
	contentContainerStyle?: any;
	error?: string | null;
	onRetry?: () => void;
}

export function SaveTopicTab({
	data,
	isLoading = false,
	isLoadingMore = false,
	refreshing = false,
	onRefresh,
	onEndReached,
	onItemPress,
	onScroll,
	contentContainerStyle,
	error,
	onRetry,
}: SaveTopicTabProps) {
	const renderTopicItem = useCallback(
		({ item, index }: { item: SavedTopic; index: number }) => {
			return (
				<ImageCard
					item={{
						id: item.id,
						imageUrl: item.imageUrl,
					}}
					onPress={() => onItemPress?.(item, index)}>
					<View style={styles.topicCardOverlay}>
						<Text style={styles.topicName}>{item.name}</Text>
						<Text style={styles.savedCount}>{i18n.t("Profile.savedCount", { count: item.savedCount })}</Text>
					</View>
				</ImageCard>
			);
		},
		[onItemPress],
	);

	const renderEmptyState = useCallback(() => {
		if (error) {
			return (
				<View style={styles.emptyStateContainer}>
					<View style={styles.emptyStateCard}>
						<Text style={styles.emptyStateText}>{i18n.t("Profile.tabError.failedToLoad", { error })}</Text>
						<TouchableOpacity style={styles.retryButton} onPress={onRetry}>
							<Text style={styles.retryButtonText}>{i18n.t("Profile.tabError.retry")}</Text>
						</TouchableOpacity>
					</View>
				</View>
			);
		}

		return (
			<View style={styles.emptyStateContainer}>
				<View style={styles.emptyStateCard}>
					<Text style={styles.emptyStateText}>{i18n.t("Profile.emptyState.noSavedTopics")}</Text>
				</View>
			</View>
		);
	}, [error, onRetry]);

	return (
		<GridList
			data={data}
			renderItem={renderTopicItem}
			numColumns={2}
			contentContainerStyle={[styles.gridContent, contentContainerStyle]}
			columnWrapperStyle={styles.gridRow}
			isLoading={isLoading}
			isLoadingMore={isLoadingMore}
			refreshing={refreshing}
			onRefresh={onRefresh}
			onEndReached={onEndReached}
			ListEmptyComponent={renderEmptyState}
			onScroll={onScroll}
			testID="save-topic-tab-grid"
		/>
	);
}

const styles = StyleSheet.create({
	gridContent: {
		paddingHorizontal: 16,
		paddingVertical: 8,
	},
	gridRow: {
		gap: 8,
	},
	topicCardOverlay: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		backgroundColor: "rgba(0, 0, 0, 0.6)",
		borderBottomLeftRadius: 12,
		borderBottomRightRadius: 12,
		padding: 12,
	},
	topicName: {
		fontSize: 14,
		fontWeight: "600",
		color: "#FFFFFF",
		marginBottom: 4,
		textShadowColor: "rgba(0, 0, 0, 0.8)",
		textShadowOffset: { width: 0, height: 1 },
		textShadowRadius: 2,
	},
	savedCount: {
		fontSize: 12,
		color: "#E5E5E5",
		fontWeight: "500",
	},
	emptyStateContainer: {
		flex: 1,
	},
	emptyStateCard: {
		backgroundColor: "#FFFFFF",
		borderRadius: 20,
		padding: 32,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.08,
		shadowRadius: 16,
		elevation: 4,
	},
	emptyStateText: {
		fontSize: 16,
		color: "#6B7280",
		textAlign: "center",
	},
	retryButton: {
		marginTop: 16,
		backgroundColor: "#5EA2FF",
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
	},
	retryButtonText: {
		color: "#FFFFFF",
		fontWeight: "600",
	},
});
