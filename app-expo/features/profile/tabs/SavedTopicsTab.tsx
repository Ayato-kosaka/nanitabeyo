import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SaveTopicTab } from "./save/SaveTopicTab";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/features/profile/hooks/useCursorPagination";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import type {
  QueryMeSavedDishCategoriesDto,
} from "@shared/api/v1/dto";
import type {
  QueryMeSavedDishCategoriesResponse,
} from "@shared/api/v1/res";

interface SavedTopicsTabProps {
  isOwnProfile: boolean;
}

export function SavedTopicsTab({ isOwnProfile }: SavedTopicsTabProps) {
  if (!isOwnProfile) {
    return (
      <View style={styles.privateContainer}>
        <View style={styles.privateCard}>
          <Text style={styles.privateText}>{i18n.t("Profile.privateContent")}</Text>
        </View>
      </View>
    );
  }

  const { callBackend } = useAPICall();

  const topics = useCursorPagination<QueryMeSavedDishCategoriesDto, any>(
    useCallback(
      async ({ cursor }) => {
        const response = await callBackend<
          QueryMeSavedDishCategoriesDto,
          QueryMeSavedDishCategoriesResponse
        >("v1/users/me/saved-dish-categories", {
          method: "GET",
          requestPayload: cursor ? { cursor } : {},
        });
        return {
          data: response.data || [],
          nextCursor: response.nextCursor,
        };
      },
      [callBackend]
    )
  );

  useEffect(() => {
    topics.loadInitial();
  }, [topics.loadInitial]);

  const { lightImpact } = useHaptics();
  const { logFrontendEvent } = useLogger();

  const handleTopicPress = useCallback(
    (item: any, index: number) => {
      lightImpact();
      logFrontendEvent({
        event_name: "saved_topic_selected",
        error_level: "log",
        payload: { topicId: item.id, index },
      });
    },
    [lightImpact, logFrontendEvent]
  );

  const error = topics.error
    ? topics.error instanceof Error
      ? topics.error.message
      : String(topics.error)
    : null;

  return (
    <SaveTopicTab
      data={topics.items}
      isLoading={topics.isLoadingInitial}
      isLoadingMore={topics.isLoadingMore}
      refreshing={topics.isLoadingInitial}
      onRefresh={topics.refresh}
      onEndReached={topics.loadMore}
      onItemPress={handleTopicPress}
      error={error}
      onRetry={topics.refresh}
    />
  );
}

const styles = StyleSheet.create({
  privateContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  privateCard: {
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
  privateText: {
    fontSize: 17,
    color: "#6B7280",
    marginTop: 16,
    fontWeight: "500",
    textAlign: "center",
  },
});
