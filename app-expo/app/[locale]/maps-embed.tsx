/*
#843 / #1810 【設計】アプリ内地図（Google Places の呼び出し上限フォールバック）の画面。

本体（見た目・ロジック）は `features/maps/components/MapsEmbedModal.tsx`。ここは
`useMapsEmbedModal`（features/maps/hooks/useMapsEmbedModal.ts）が `POST /v1/maps/embed-token`
での取得に成功したあとに router.push で渡すクエリパラメータを受け取り、閉じる操作を
`router.back()` へつなぐだけの薄いルート。

`sns-import` と同じく `app/[locale]/_layout.tsx` の `<Stack.Screen>` に
`presentation: "modal"` で登録してある。全画面のオーバーレイを react-native-paper の
bare `<Portal>` で作らない理由は `assert-legacy-blur-modal-boundary.mjs` のコメント参照
（#1350 で全廃したオーバーレイ層を作り直さないための CI ガード）。
*/
import { useLocalSearchParams, useRouter } from "expo-router";

import { MapsEmbedModal, type ResolvedMapsEmbedModalParams } from "@/features/maps/components/MapsEmbedModal";
import { type MapsEmbedMode } from "@/features/maps/embedUrl";

export default function MapsEmbedScreen() {
	const router = useRouter();
	const { mode, title, externalUrl, source, embedUrl } = useLocalSearchParams<{
		mode: MapsEmbedMode;
		title?: string;
		externalUrl: string;
		source: string;
		embedUrl: string;
	}>();

	const params: ResolvedMapsEmbedModalParams = { mode, title, externalUrl, source, embedUrl };

	return <MapsEmbedModal params={params} onClose={() => router.back()} />;
}
