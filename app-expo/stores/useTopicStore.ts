import { create } from "zustand";
import type { DishMediaEntry } from "@shared/api/v1/res";

// #433 【設計】Topic 用の新規ストア実装（Dish と同様の設計方針）
export interface Topic {
	category: string;
	topicTitle: string;
	reason: string;
	categoryId: string;
	imageUrl: string;
	dishItemsPromise: Promise<DishMediaEntry[]>;
	isHidden?: boolean;
	isSaved?: boolean;
}

type TopicStore = {
	// #433 【設計】生の Promise を保持（フェッチ中かどうかは Promise の有無や状態から判断）
	topicsPromisesMap: Record<string, Promise<Topic[]>>;
	// #433 【設計】categoryId をキーとした Topic エンティティのマップ（唯一のソースオブトゥルース）
	topicsById: Record<string, Topic>;

	// Promise 設定（フェッチ結果の保存）
	setTopicsPromises: (key: string, items: Promise<Topic[]>) => void;
	// Topic エンティティの保存・更新
	setTopic: (categoryId: string, topic: Topic) => void;
	updateTopic: (categoryId: string, updates: Partial<Topic>) => void;
	// 非表示状態の更新
	hideTopic: (categoryId: string, isHidden: boolean) => void;
	// 保存状態の更新（楽観的更新用）
	toggleSave: (categoryId: string, isSaved: boolean) => void;
	// クリア処理
	clearTopics: (key?: string) => void;
};

export const useTopicStore = create<TopicStore>((set, get) => ({
	topicsPromisesMap: {},
	topicsById: {},

	setTopicsPromises: (key, items) =>
		set((state) => {
			// #433 【設計】Promise を保存すると同時に、結果を topicsById にも保存
			items
				.then((topics) => {
					const newTopicsById = { ...state.topicsById };
					topics.forEach((topic) => {
						// 既存エントリがあれば状態を維持しつつ更新、なければ新規作成
						const existing = newTopicsById[topic.categoryId];
						newTopicsById[topic.categoryId] = {
							...topic,
							isHidden: existing?.isHidden ?? topic.isHidden ?? false,
							isSaved: existing?.isSaved ?? topic.isSaved ?? false,
						};
					});
					set({ topicsById: newTopicsById });
				})
				.catch((error) => {
					console.error("Failed to process topic promises:", error);
				});

			return {
				topicsPromisesMap: {
					...state.topicsPromisesMap,
					[key]: items,
				},
			};
		}),

	setTopic: (categoryId, topic) =>
		set((state) => ({
			topicsById: {
				...state.topicsById,
				[categoryId]: {
					...topic,
					isHidden: state.topicsById[categoryId]?.isHidden ?? topic.isHidden ?? false,
					isSaved: state.topicsById[categoryId]?.isSaved ?? topic.isSaved ?? false,
				},
			},
		})),

	updateTopic: (categoryId, updates) =>
		set((state) => {
			const existing = state.topicsById[categoryId];
			if (!existing) return state;

			return {
				topicsById: {
					...state.topicsById,
					[categoryId]: {
						...existing,
						...updates,
					},
				},
			};
		}),

	hideTopic: (categoryId, isHidden) =>
		set((state) => {
			const existing = state.topicsById[categoryId];
			if (!existing) return state;

			return {
				topicsById: {
					...state.topicsById,
					[categoryId]: {
						...existing,
						isHidden,
					},
				},
			};
		}),

	toggleSave: (categoryId, isSaved) =>
		set((state) => {
			const existing = state.topicsById[categoryId];
			if (!existing) return state;

			return {
				topicsById: {
					...state.topicsById,
					[categoryId]: {
						...existing,
						isSaved,
					},
				},
			};
		}),

	clearTopics: (key) =>
		set((state) => {
			if (!key) return { topicsPromisesMap: {}, topicsById: {} };
			const newMap = { ...state.topicsPromisesMap };
			delete newMap[key];
			return { topicsPromisesMap: newMap };
		}),
}));
