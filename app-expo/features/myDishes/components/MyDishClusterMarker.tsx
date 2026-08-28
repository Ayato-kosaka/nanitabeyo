import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "@/components/MapView";
import { FixedColors } from "@/constants/Palette";
import { useMarkerViewTracking } from "@/features/mapMarkers/hooks/useMarkerViewTracking";
import i18n from "@/lib/i18n";
import type { MyDishPinCluster } from "../clustering";

/*
#1375（実機: マップのクラッシュ / 性能劣化）**畳んだピンの «数字の丸»。**

以前は `MyDishesMapView` の `useMemo` の中で直接組んでいたが、
`tracksViewChanges` を «絵が決まるまで» に限るにはフック（= コンポーネント）が要るので
切り出した。理由は `features/mapMarkers/hooks/useMarkerViewTracking.ts` にある。

この丸は画像を持たず、変わるのは中の数字だけなので、
レイアウトが 1 度決まればそれ以上焼き直す必要は無い。
*/
export function MyDishClusterMarker({ cluster, onPress }: { cluster: MyDishPinCluster; onPress: () => void }) {
	const count = cluster.pins.length;
	// 数字が変われば絵が変わる。それ以外（地図を動かすだけ）では焼き直さない
	const { tracksViewChanges, onContentReady } = useMarkerViewTracking(String(count));

	return (
		<Marker
			testID="my-dishes-map-cluster"
			coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
			onPress={onPress}
			tracksViewChanges={tracksViewChanges}
			accessibilityLabel={i18n.t("MyDishes.map.clusterA11yLabel", { count })}>
			{/* ⚠️ `onLayout` を消さないこと。これが来ないと焼き直しが止まらず、
			    300 個の丸が毎フレーム作り直されて Android が落ちる */}
			<View style={styles.cluster} onLayout={onContentReady}>
				<Text style={styles.clusterLabel}>{count}</Text>
			</View>
		</Marker>
	);
}

// #1375（5 巡目）クラスタの丸。地図の上に載るので白い縁で輪郭を保つ
// （バッジ類と同じ考え方。`MyDishStatusCountBadges.tsx`）。
// 地図タイルは常にライト配色なので、テーマではなく固定色を使う
const styles = StyleSheet.create({
	cluster: {
		minWidth: 36,
		height: 36,
		paddingHorizontal: 6,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(17,24,39,0.82)",
		borderWidth: 2,
		borderColor: FixedColors.onMedia,
	},
	clusterLabel: {
		fontSize: 14,
		fontWeight: "700",
		color: FixedColors.onMedia,
	},
});
