import { Image, type ImageProps } from "expo-image";
import React from "react";

import { PRELOAD_ASSETS, type PreloadAssetKey } from "@/constants/preloadAssets";

export type PreloadedImageProps = Omit<ImageProps, "source" | "cachePolicy"> & {
	/** `constants/preloadAssets.ts` のキー */
	asset: PreloadAssetKey;
};

/**
 * #1087 【設計】先読み対象アセット専用の `expo-image` ラッパ
 *
 * `source` と `cachePolicy` を必ずペアで渡すための唯一の入口。
 * 呼び出し側は `asset` キーだけを指定し、`source` / `cachePolicy` は指定できない
 * (型で `Omit` してある)。これにより #785 の「先読み側と表示側で cachePolicy が
 * 食い違う」事故が構造的に起こせなくなる。
 *
 * ⚠️ `source` / `cachePolicy` を `{...rest}` の**後**に置いているのは、
 * 型を迂回して渡された値に上書きされないようにするため。
 */
export function PreloadedImage({ asset, ...rest }: PreloadedImageProps) {
	const { source, cachePolicy } = PRELOAD_ASSETS[asset];

	return <Image {...rest} source={source} cachePolicy={cachePolicy} />;
}
