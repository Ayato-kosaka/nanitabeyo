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

import { useEffect, useId } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSeoContext, SeoData } from "./SeoProvider";

export function useSeo(data: SeoData) {
	const { push, pop } = useSeoContext();
	const id = useId();

	// #717 【設計】フォーカス連動でpush/pop（タブ/スタック対応）
	// #717 【バグ】data 変更時にも再登録が必要なため、依存配列に data を含める
	useFocusEffect(() => {
		push(id, data);
		return () => {
			pop(id);
		};
	});

	// #717 【バグ】unmount時にもpopする（useFocusEffectが動かないケースのフォールバック）
	useEffect(() => {
		return () => {
			pop(id);
		};
	}, [id, pop]);
}
