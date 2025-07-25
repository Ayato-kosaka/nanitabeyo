import { FoodItem } from '@/types';
import { create } from "zustand";

type FeedStore = {
    feedItemsMap: Record<string, FoodItem[]>;
    setFeedItems: (topicId: string, items: FoodItem[]) => void;
    clearFeedItems: (topicId?: string) => void;
};

export const useFeedStore = create<FeedStore>((set) => ({
    feedItemsMap: {},
    setFeedItems: (topicId, items) =>
        set((state) => ({
            feedItemsMap: {
                ...state.feedItemsMap,
                [topicId]: items,
            },
        })),
    clearFeedItems: (topicId) =>
        set((state) => {
            if (!topicId) return { feedItemsMap: {} };
            const newMap = { ...state.feedItemsMap };
            delete newMap[topicId];
            return { feedItemsMap: newMap };
        }),
}));