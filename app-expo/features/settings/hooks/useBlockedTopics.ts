import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthProvider";

export interface BlockedTopic {
	id: string;
	category_id: string;
	category_name: string;
	category_image_url: string;
}

// #[TICKET] 【設計】ブロック済み料理トピックを取得するフック
export const useBlockedTopics = () => {
	const [blockedTopics, setBlockedTopics] = useState<BlockedTopic[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);
	const { user } = useAuth();

	const fetchBlockedTopics = async () => {
		if (!user || user.is_anonymous) {
			setBlockedTopics([]);
			setIsLoading(false);
			return;
		}

		try {
			setIsLoading(true);
			setError(null);

			// #[TICKET] 【設計】block リアクションを取得
			const { data: reactions, error: reactionsError } = await supabase
				.from("reactions")
				.select("id, target_id")
				.eq("user_id", user.id)
				.eq("target_type", "dish_categories")
				.eq("action_type", "block")
				.order("created_at", { ascending: false });

			if (reactionsError) throw reactionsError;

			if (!reactions || reactions.length === 0) {
				setBlockedTopics([]);
				setIsLoading(false);
				return;
			}

			// #[TICKET] 【設計】カテゴリ情報を取得
			const categoryIds = reactions.map((r) => r.target_id);
			const { data: categories, error: categoriesError } = await supabase
				.from("dish_categories")
				.select("id, label_en, image_url")
				.in("id", categoryIds);

			if (categoriesError) throw categoriesError;

			// #[TICKET] 【設計】reactions と categories を結合
			const blocked: BlockedTopic[] = reactions
				.map((reaction) => {
					const category = categories?.find((c) => c.id === reaction.target_id);
					if (!category) return null;
					return {
						id: reaction.id,
						category_id: reaction.target_id,
						category_name: category.label_en,
						category_image_url: category.image_url,
					};
				})
				.filter((item): item is BlockedTopic => item !== null);

			setBlockedTopics(blocked);
		} catch (err) {
			console.error("Failed to fetch blocked topics:", err);
			setError(err instanceof Error ? err : new Error("Unknown error"));
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		fetchBlockedTopics();
	}, [user?.id]);

	return {
		blockedTopics,
		isLoading,
		error,
		refetch: fetchBlockedTopics,
	};
};
