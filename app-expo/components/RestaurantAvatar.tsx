import React, { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ImageStyle, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { Store } from "lucide-react-native";

import { useAppTheme } from "@/contexts/ThemeProvider";
import { getCacheKeyForImage } from "@/lib/image";

/*
#1780 【設計】**店の «顔» を描くのはここ 1 箇所。画像が無くても空の枠にしない。**

#1793 で Google の写真を自社 Storage へ複製するのをやめたので、これ以降に作られる店の
`restaurants.image_path` は必ず null になる。API 側は #1780 で
「dish_media のサムネイルを代わりに返す」ようにしたが、**投稿がまだ 1 件も無い店は
それでも画像が無い**（catalog 由来の約 62 万店はもともと持っていない）。

その状態を各画面がそれぞれ `<Image source={{uri: undefined}}>` で描いていたため、
店詳細は 60×60 の空白、店名検索は灰色の四角、保存済み店は 100px の空白になっていた。
オーナーの完了条件（#1780 の 4 番）は «画像が無い店でも灰色にならない» である。

⚠️ **各画面へ «uri が無ければアイコン» を書き足す形にしないこと。** 店の表示は
   4 箇所あり（店詳細 / 店名検索 / 保存済み店 / 地図ピン）、写した瞬間にどれかが
   置き去りになる。ピンだけは形が違う（吹き出し＋ビットマップ化）ので
   `AvatarBubbleMarker` が自前の受け皿を持つが、**平面の 3 箇所はここを通す**。
*/

type Props = {
	/** `restaurant.imageUrls?.sm` / `?.md`。無ければアイコンを描く */
	uri?: string | null;
	/** 画像・受け皿の共通の見た目（大きさと角丸）。呼び出し側の既存 style をそのまま渡す */
	style?: StyleProp<ImageStyle>;
	/** アイコンの大きさ。既定は枠の高さから決められないので呼び出し側が渡す */
	iconSize?: number;
	testID?: string;
	/** 読み上げ用。店名を渡す */
	accessibilityLabel?: string;
};

export function RestaurantAvatar({ uri, style, iconSize = 20, testID, accessibilityLabel }: Props) {
	const { colors } = useAppTheme();
	const source = useMemo(() => (uri ? { uri, cacheKey: getCacheKeyForImage(uri) } : null), [uri]);

	if (!source) {
		return (
			<View
				testID={testID ? `${testID}-placeholder` : undefined}
				accessibilityLabel={accessibilityLabel}
				style={[style as StyleProp<ViewStyle>, styles.placeholder, { backgroundColor: colors.surfaceSubtle }]}>
				<Store size={iconSize} color={colors.textSecondary} />
			</View>
		);
	}

	return (
		<Image
			testID={testID}
			source={source}
			style={style}
			contentFit="cover"
			alt={accessibilityLabel}
			accessibilityLabel={accessibilityLabel}
		/>
	);
}

const styles = StyleSheet.create({
	placeholder: {
		alignItems: "center",
		justifyContent: "center",
	},
});
