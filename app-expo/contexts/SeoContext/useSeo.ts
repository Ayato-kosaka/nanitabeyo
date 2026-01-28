/**
 * ページからSEO値を上書きするhook
 *
 * #717 【設計】フォーカス連動でpush/popを行い、画面遷移時の残留を防止
 * - focus時: push（上書き登録）
 * - blur時: pop（上書き解除）
 * - unmount時: pop（フォールバック）
 *
 * タブ/スタックなど画面がアンマウントされないケースでも、
 * フォーカスが外れたら上書きを解除する。
 */

import { useCallback, useEffect, useId } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSeoContext, SeoOverride } from "./SeoProvider";

export function useSeo(data: SeoOverride["data"]) {
	const { push, pop } = useSeoContext();
	const id = useId();

	// フォーカス連動でpush/pop（タブ/スタック対応）
	useFocusEffect(useCallback(() => {
		push({ id, data });
		return () => {
			pop(id);
		};
	}, [id, data, push, pop]));

	// unmount時にもpopする（useFocusEffectが動かないケースのフォールバック）
	useEffect(() => {
		return () => {
			pop(id);
		};
	}, [id, pop]);
}
