/*
このファイルの責務
- 店舗への入札フォーム（`features/map/components/BidForm`）を «画面» として提供する。
- 入札の送信（現時点ではダミー処理）と、その結果に応じた離脱を担う。
- 戻る導線（ScreenHeader / ハードウェアバック）で店詳細へ帰す。

#1386 【設計】以前は店詳細シートの中の `BidBlurModal`（**手動 zIndex 1300**）だった。
親（店詳細シート = 1100）とレビュー投稿（1200）と合わせて 3 枚のオーバーレイが
同じ Portal ホストに積まれ、重なり順は呼び出し側の数字だけが根拠という状態だった（#1350 §D）。

入札は «金額を入れて確定する» フローの一段なので、`/legal/[doc]`（#1368）や
`/profile/edit`（#1369）と同じく presentation を指定しないルート（＝既定の card）へ移す。
これで Android の戻る・ブラウザバック・URL 共有が Navigator の既定挙動で賄える。

⚠️ 入札処理は元実装のまま «2 秒待って成功ログを出すだけ» のダミーである（決済は未実装）。
ルート化にあたって挙動は変えていない。実装するときは `restaurantId` が URL から取れる形に
なっているので、この画面の中で完結できる。
*/
import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenHeader } from "@/components/ScreenHeader";
import { BidForm } from "@/features/map/components/BidForm";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";

export default function RestaurantBidScreen() {
	const { restaurantId } = useLocalSearchParams<{ restaurantId: string }>();
	const { lightImpact, mediumImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();

	const [isProcessing, setIsProcessing] = useState(false);

	/**
	 * #1386 【設計】離脱は 1 箇所に寄せる。履歴があれば back（店詳細はマウントされたまま残っており、
	 * タブの選択状態やスクロール位置ごと復帰できる）。履歴が無い着地（URL 直リンク / リロード）だけが
	 * 例外で、そこは戻る先が存在しないので店詳細へ replace する（`/legal/[doc]` と同じ形）。
	 */
	const leave = useCallback(() => {
		if (router.canGoBack()) {
			router.back();
			return;
		}
		router.replace({
			pathname: "/[locale]/(tabs)/review/restaurant/[restaurantId]",
			params: { locale, restaurantId },
		});
	}, [locale, restaurantId]);

	const handleBack = useCallback(() => {
		lightImpact();
		logFrontendEvent({
			event_name: "restaurant_bid_screen_back_pressed",
			error_level: "log",
			payload: { restaurantId, canGoBack: router.canGoBack() },
		});
		leave();
	}, [lightImpact, logFrontendEvent, restaurantId, leave]);

	const handleBid = useCallback(
		async (bidAmount: string) => {
			if (!bidAmount) return;
			mediumImpact();
			setIsProcessing(true);
			try {
				await new Promise((resolve) => setTimeout(resolve, 2000));
				logFrontendEvent({
					event_name: "restaurant_bid_submitted",
					error_level: "log",
					payload: { restaurantId, bidAmount: Number(bidAmount) },
				});
				// モーダル時代の `closeBidModal()` に相当する。成功したのに画面が残る（#498 型）を作らない
				leave();
			} catch {
				logFrontendEvent({
					event_name: "restaurant_bid_submission_failed",
					error_level: "error",
					payload: { restaurantId, bidAmount: Number(bidAmount) },
				});
			} finally {
				setIsProcessing(false);
			}
		},
		[mediumImpact, logFrontendEvent, restaurantId, leave],
	);

	return (
		<LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
			<SafeAreaView style={styles.safeArea} edges={[]}>
				<ScreenHeader title={i18n.t("Map.buttons.placeBid")} onPressBack={handleBack} testID="restaurant-bid-screen" />
				<View style={styles.body}>
					<BidForm onSubmit={handleBid} onCancel={handleBack} isProcessing={isProcessing} />
				</View>
			</SafeAreaView>
		</LinearGradient>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	safeArea: {
		flex: 1,
	},
	body: {
		flex: 1,
		paddingTop: 16,
	},
});
