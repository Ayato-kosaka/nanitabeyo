import type { DishMediaEntry } from "@shared/api/v1/res";
import { create } from "zustand";

type SearchStore = {
	dishPromisesMap: Record<string, Promise<DishMediaEntry[]>>;
	setDishePromises: (topicId: string, items: Promise<DishMediaEntry[]>) => void;
	clearDishes: (topicId?: string) => void;
};

export const useSearchStore = create<SearchStore>((set) => ({
	dishPromisesMap: {},
	setDishePromises: (topicId, items) =>
		set((state) => ({
			dishPromisesMap: {
				...state.dishPromisesMap,
				[topicId]: items,
			},
		})),
	clearDishes: (topicId) =>
		set((state) => {
			if (!topicId) return { dishPromisesMap: {} };
			const newMap = { ...state.dishPromisesMap };
			delete newMap[topicId];
			return { dishesMap: newMap };
		}),
}));
