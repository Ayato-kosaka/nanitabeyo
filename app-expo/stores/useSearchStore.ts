import { FoodItem } from '@/types';
import { create } from "zustand";

type SearchStore = {
    dishesMap: Record<string, FoodItem[]>;
    setDishes: (topicId: string, items: FoodItem[]) => void;
    clearDishes: (topicId?: string) => void;
};

export const useSearchStore = create<SearchStore>((set) => ({
    dishesMap: {},
    setDishes: (topicId, items) =>
        set((state) => ({
            dishesMap: {
                ...state.dishesMap,
                [topicId]: items,
            },
        })),
    clearDishes: (topicId) =>
        set((state) => {
            if (!topicId) return { dishesMap: {} };
            const newMap = { ...state.dishesMap };
            delete newMap[topicId];
            return { dishesMap: newMap };
        }),
}));