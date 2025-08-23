import React, { useCallback, useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Tabs } from "@/components/collapsible-tabs";
import { SaveSubTabsBar } from "../components/SaveSubTabsBar";
import { SaveTopicTab } from "./save/SaveTopicTab";
import { SavePostTab } from "./save/SavePostTab";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useCursorPagination } from "@/features/profile/hooks/useCursorPagination";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useLocale } from "@/hooks/useLocale";
import { router } from "expo-router";
import type {
        QueryMeSavedDishCategoriesDto,
        QueryMeSavedDishMediaDto,
} from "@shared/api/v1/dto";
import type {
        QueryMeSavedDishCategoriesResponse,
        QueryMeSavedDishMediaResponse,
        DishMediaEntry,
} from "@shared/api/v1/res";

interface SaveTabProps {
        isOwnProfile: boolean;
}

export function SaveTab({ isOwnProfile }: SaveTabProps) {
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
                        [callBackend],
                ),
        );

        const posts = useCursorPagination<QueryMeSavedDishMediaDto, DishMediaEntry>(
                useCallback(
                        async ({ cursor }) => {
                                const response = await callBackend<
                                        QueryMeSavedDishMediaDto,
                                        QueryMeSavedDishMediaResponse
                                >("v1/users/me/saved-dish-media", {
                                        method: "GET",
                                        requestPayload: cursor ? { cursor } : {},
                                });
                                return {
                                        data: response.data || [],
                                        nextCursor: response.nextCursor,
                                };
                        },
                        [callBackend],
                ),
        );

        useEffect(() => {
                topics.loadInitial();
                posts.loadInitial();
        }, [topics.loadInitial, posts.loadInitial]);

        const { lightImpact } = useHaptics();
        const { logFrontendEvent } = useLogger();
        const { setDishePromises } = useDishMediaEntriesStore();
        const locale = useLocale();

        const handleTopicPress = useCallback(
                (item: any, index: number) => {
                        lightImpact();
                        logFrontendEvent({
                                event_name: "saved_topic_selected",
                                error_level: "log",
                                payload: { topicId: item.id, index },
                        });
                },
                [lightImpact, logFrontendEvent],
        );

        const handlePostPress = useCallback(
                (item: DishMediaEntry, index: number) => {
                        lightImpact();
                        setDishePromises("saved", Promise.resolve(posts.items));
                        router.push({
                                pathname: "/[locale]/(tabs)/profile/food",
                                params: { locale, startIndex: index, tabName: "saved" },
                        });
                        logFrontendEvent({
                                event_name: "dish_media_entry_selected",
                                error_level: "log",
                                payload: { item, tabName: "saved" },
                        });
                },
                [lightImpact, setDishePromises, posts.items, locale, logFrontendEvent],
        );

        const topicsError = topics.error
                ? topics.error instanceof Error
                        ? topics.error.message
                        : String(topics.error)
                : null;
        const postsError = posts.error
                ? posts.error instanceof Error
                        ? posts.error.message
                        : String(posts.error)
                : null;

        return (
                <Tabs.Container headerHeight={0} renderTabBar={SaveSubTabsBar} initialTabName="topics">
                        <Tabs.Tab name="topics">
                                <SaveTopicTab
                                        data={topics.items}
                                        isLoading={topics.isLoadingInitial}
                                        isLoadingMore={topics.isLoadingMore}
                                        refreshing={topics.isLoadingInitial}
                                        onRefresh={topics.refresh}
                                        onEndReached={topics.loadMore}
                                        onItemPress={handleTopicPress}
                                        error={topicsError}
                                        onRetry={topics.refresh}
                                />
                        </Tabs.Tab>
                        <Tabs.Tab name="posts">
                                <SavePostTab
                                        data={posts.items}
                                        isLoading={posts.isLoadingInitial}
                                        isLoadingMore={posts.isLoadingMore}
                                        refreshing={posts.isLoadingInitial}
                                        onRefresh={posts.refresh}
                                        onEndReached={posts.loadMore}
                                        onItemPress={handlePostPress}
                                        error={postsError}
                                        onRetry={posts.refresh}
                                />
                        </Tabs.Tab>
                </Tabs.Container>
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
