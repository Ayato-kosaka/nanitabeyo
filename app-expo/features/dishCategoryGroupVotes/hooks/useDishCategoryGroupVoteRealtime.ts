/**
 * #856 【責務】
 * participants INSERT を購読して detail refresh のトリガーにする。
 *
 * votes / candidates の差分は購読しない。削除や投票の整合性は GET detail で揃える。
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Env } from "@/constants/Env";

type UseDishCategoryGroupVoteRealtimeParams = {
	sessionId?: string;
	onParticipantInserted: () => void;
};

export function useDishCategoryGroupVoteRealtime({
	sessionId,
	onParticipantInserted,
}: UseDishCategoryGroupVoteRealtimeParams) {
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!sessionId) return;

		// #856 【設計】Realtime は participants INSERT だけをセッション更新通知として使う。
		// votes/candidates の差分適用は順序や削除レースが複雑になるため、通知後は GET detail で整合させる。
		const channel = supabase
			.channel(`dish-category-group-vote:${sessionId}`)
			.on(
				"postgres_changes",
				{
					event: "INSERT",
					schema: Env.DB_SCHEMA,
					table: "dish_category_group_vote_participants",
					filter: `session_id=eq.${sessionId}`,
				},
				() => {
					if (timerRef.current) clearTimeout(timerRef.current);
					timerRef.current = setTimeout(onParticipantInserted, 200);
				},
			)
			.subscribe();

		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
			supabase.removeChannel(channel);
		};
	}, [onParticipantInserted, sessionId]);
}
