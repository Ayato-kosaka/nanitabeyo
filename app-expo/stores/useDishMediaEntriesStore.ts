import type { DishMediaEntry } from "@shared/api/v1/res";
import { create } from "zustand";

type DishMediaEntriesStore = {
	dishPromisesMap: Record<string, Promise<DishMediaEntry[]>>;
	setDishePromises: (key: string, items: Promise<DishMediaEntry[]>) => void;
	clearDishes: (key?: string) => void;
};

export const useDishMediaEntriesStore = create<DishMediaEntriesStore>((set) => ({
	dishPromisesMap: {},
	setDishePromises: (key, items) =>
		set((state) => ({
			dishPromisesMap: {
				...state.dishPromisesMap,
				[key]: items,
			},
		})),
	clearDishes: (key) =>
		set((state) => {
			if (!key) return { dishPromisesMap: {} };
			const newMap = { ...state.dishPromisesMap };
			delete newMap[key];
			return { dishesMap: newMap };
		}),
}));
