import React, { memo, useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Marker } from "@/components/MapView";
import { FixedColors } from "@/constants/Palette";
import { AvatarBubbleMarker } from "@/features/mapMarkers";
import { useMarkerViewTracking } from "@/features/mapMarkers/hooks/useMarkerViewTracking";
import type { MapPinCluster } from "@/features/map/clustering";
import type { PinDetailLevel, RestaurantPin } from "../mapPins";

/*
#1629 «お店を選ぶ» 地図のマーカー。

## なぜコンポーネントに切り出すのか（ここが «重い» の本体だった）

直す前は `select-restaurant.tsx` の `useMemo` の中で

    <RestaurantLabelMarker
      coordinate={{ latitude: …, longitude: … }}   // 毎回新しいオブジェクト
      onPress={() => handlePress(item)}            // 毎回新しい関数
    />

と組んでいた。**選択中の店（`activeRestaurantId`）が変わるだけで配列全体が作り直され、
全マーカーへ新しい props が流れる。** View Marker はネイティブ側でビットマップになるので、
1 件選ぶたびに «画面に出ている全部» が焼き直しの対象になる。
同じファイルの 587 行目に «memo で固定する» という申し送りが既にあったが、
`useMemo` の依存に `activeRestaurantId` が入っている以上、配列 memo では防げない。

そこで **props を安定した値だけにして `React.memo` で止める**。
呼び出し側が渡すのは `cluster`（state の配列由来なので参照が変わらない）・`isActive`・
`onPress`（`useCallback` で固定した 1 本）だけで、座標オブジェクトと
「このピンを押した」のクロージャは、この中で `useMemo` / `useCallback` を通して作る。
結果、選択が変わっても props が変わるのは **その 2 件だけ**になる。

## 引きでは点、寄りで丸（`PinDetailLevel`）

大手の地図アプリと同じで、広い表示域ではピンを点に落とす。切り替えの基準は
`mapPins.ts` の `LABEL_ZOOM_MAX_DELTA`。

## #1629【オーナー確定】店名つきのピン（`RestaurantLabelMarker`）は削除した

オーナー実機報告「お店を選ぶのマップピンが Android で映らない」。
«食べたい / 食べた» のマップ（`MyDishesMapView`）は `AvatarBubbleMarker`（丸だけ）で
**実機で出ており**、この画面だけが «丸 + 店名 2 行 / 幅 96px» の別構成だった。

Android は Marker の children を «焼いた時点の測定サイズ» でビットマップ化するため、
大きい・後から伸びる中身は欠ける（`AvatarBubbleMarker` の申し送り）。
オーナー指示で構成を揃え、映っている側に寄せた。

⚠️ **ピンから店名が消える。** #1375 8 巡目は «押すまでどの店か分からない» を理由に
   店名を載せたが、**そもそも映らないより出るほうが先**という判断である。
   店名は押したときと、下部の «保存したお店» シートで読める。
*/

export type RestaurantPinCluster = MapPinCluster<RestaurantPin>;

/**
 * マーカーの見た目。いまは `avatar`（写真の丸）だけ。
 *
 * #1629 `label`（写真 + 店名）は Android で映らなかったため削除した（上の申し送り）。
 * 型を残してあるのは、将来別の見た目を足すときの入口をこの 1 箇所に保つため。
 */
export type PinAppearance = "avatar";

type PinProps = {
	cluster: RestaurantPinCluster;
	appearance: PinAppearance;
	detail: PinDetailLevel;
	isActive: boolean;
	onPress: (pin: RestaurantPin) => void;
};

function RestaurantPinMarkerInner({ cluster, appearance, detail, isActive, onPress }: PinProps) {
	const pin = cluster.pins[0];
	const coordinate = useMemo(
		() => ({ latitude: cluster.latitude, longitude: cluster.longitude }),
		[cluster.latitude, cluster.longitude],
	);
	const handlePress = useCallback(() => onPress(pin), [onPress, pin]);

	if (detail === "dot") {
		return <RestaurantDotMarker coordinate={coordinate} isActive={isActive} onPress={handlePress} />;
	}

	return (
		<AvatarBubbleMarker
			testID="select-restaurant-pin"
			coordinate={coordinate}
			onPress={handlePress}
			// 地図タイルは常にライト配色のため、非アクティブのバブルは固定白（FixedColors 参照）
			color={isActive ? FixedColors.mapMarkerBorderActive : FixedColors.mapMarkerSurface}
			isActive={isActive}
			uri={pin.restaurant.imageUrls?.sm}
		/>
	);
}

export const RestaurantPinMarker = memo(RestaurantPinMarkerInner);

/*
引きのときの «点»。

写真も文字も持たないので、ビットマップは 1 度焼けば二度と変わらない
（`useMarkerViewTracking` に渡す鍵が `isActive` だけなのはそのため）。
地図タイルは常にライト配色なので、色はテーマに追従させず `FixedColors` から取る。
*/
function RestaurantDotMarkerInner({
	coordinate,
	isActive,
	onPress,
}: {
	coordinate: { latitude: number; longitude: number };
	isActive: boolean;
	onPress: () => void;
}) {
	const { tracksViewChanges, onContentReady } = useMarkerViewTracking(String(isActive));
	return (
		<Marker
			testID="select-restaurant-dot"
			coordinate={coordinate}
			onPress={onPress}
			tracksViewChanges={tracksViewChanges}>
			<View style={[styles.dot, isActive && styles.dotActive]} onLayout={onContentReady} />
		</Marker>
	);
}

const RestaurantDotMarker = memo(RestaurantDotMarkerInner);

/*
畳んだピンの «数字の丸»。my-dishes の `MyDishClusterMarker` と同じ作りで、
中の数字が変わったときだけ焼き直す。
*/
function RestaurantClusterMarkerInner({
	cluster,
	onPress,
}: {
	cluster: RestaurantPinCluster;
	onPress: (cluster: RestaurantPinCluster) => void;
}) {
	const count = cluster.pins.length;
	const { tracksViewChanges, onContentReady } = useMarkerViewTracking(String(count));
	const coordinate = useMemo(
		() => ({ latitude: cluster.latitude, longitude: cluster.longitude }),
		[cluster.latitude, cluster.longitude],
	);
	const handlePress = useCallback(() => onPress(cluster), [onPress, cluster]);

	return (
		<Marker
			testID="select-restaurant-cluster"
			coordinate={coordinate}
			onPress={handlePress}
			tracksViewChanges={tracksViewChanges}>
			{/* ⚠️ `onLayout` を消さないこと。これが来ないと焼き直しが止まらない */}
			<View style={styles.cluster} onLayout={onContentReady}>
				<Text style={styles.clusterLabel}>{count}</Text>
			</View>
		</Marker>
	);
}

export const RestaurantClusterMarker = memo(RestaurantClusterMarkerInner);

const DOT_SIZE = 14;

const styles = StyleSheet.create({
	dot: {
		width: DOT_SIZE,
		height: DOT_SIZE,
		borderRadius: DOT_SIZE / 2,
		borderWidth: 2,
		// 地図タイルは常にライト配色なので、テーマではなく固定色を使う（FixedColors の申し送り参照）
		borderColor: FixedColors.mapMarkerSurface,
		backgroundColor: FixedColors.mapMarkerLabel,
	},
	dotActive: {
		backgroundColor: FixedColors.mapMarkerLabelActive,
	},
	cluster: {
		minWidth: 34,
		height: 34,
		paddingHorizontal: 6,
		borderRadius: 17,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: FixedColors.mapMarkerLabel,
		borderWidth: 2,
		borderColor: FixedColors.mapMarkerSurface,
	},
	clusterLabel: {
		fontSize: 14,
		fontWeight: "700",
		color: FixedColors.onMedia,
	},
});
