// app-expo/features/mapMarkers/components/BubblePinBitmap.tsx
import React, { useEffect, useMemo, useRef } from "react";
import { Image, StyleSheet, View } from "react-native";
import { FixedColors } from "@/constants/Palette";

/**
 * #235 BubblePinBitmap
 *
 * ✅ 目的：
 *   - react-native-view-shot で PNG 化する「オフスクリーン描画用」のピン View
 *   - Map 上に直接載せる View Marker ではなく、Renderer（Provider）が画面外に描画して capture する
 *
 * ✅ Android の「画像が出ない（枠だけPNG）」根治：
 *   - remote image のロード完了（onLoad / onLoadEnd）を Renderer に通知し、
 *     画像が描画された後に capture してもらう
 *
 * ✅ ベストプラクティス：
 *   - requestKey を必須扱いで渡す（生成要求と画像ロード完了を正しく紐付け）
 *   - onLoadEnd は成功/失敗どちらでも呼ばれるので、通知は onLoadEnd ではなく
 *     onLoad / onError を主に使い、最後の安全弁として onLoadEnd も使う
 *   - 重複通知（多重 onLoad / 再レンダ）を防ぐため、1リクエストにつき1回だけ通知
 */

type Props = {
	uri: string | undefined;
	size?: number;

	/**
	 * 枠＆tail の色（正規化済み #RRGGBB 推奨）
	 * Renderer 側で normalizeColor して渡す想定
	 */
	color?: string;

	/**
	 * Renderer が生成状態を管理するためのキー（makeKey(...)）
	 * ※これが無いと「どのリクエストの画像がロードされたか」が分からなくなる
	 */
	requestKey?: string;

	/**
	 * 画像ロード成功通知（Renderer 側の imageReady を true にする）
	 */
	onImageReady?: (key: string) => void;

	/**
	 * 画像ロード失敗通知（Renderer 側はプレースホルダで確定させる等）
	 */
	onImageError?: (key: string, error?: unknown) => void;
};

/*
#1629 【設計】この View は画面外で描いて PNG 化し、その PNG を **地図のマーカー画像**として
置くためのものである（`MarkerBitmapRendererProvider`）。焼き上がった絵は Google Map の
タイルの上に載り、タイルはアプリのテーマに追従せず常にライト配色なので、
ここの色をテーマで振ってはいけない（ダークで暗くすると地図の上で見えなくなる）。
さらに PNG はキャッシュされて再利用されるため、テーマ切替に追従すること自体が構造的に不可能。
*/
export function BubblePinBitmap({
	uri,
	size = 48,
	color = FixedColors.mapMarkerSurface,
	requestKey,
	onImageReady,
	onImageError,
}: Props) {
	const radius = size / 2;

	// ✅ 通知の多重実行を防ぐ（onLoad / onLoadEnd が複数回走るケースがある）
	const notifiedRef = useRef(false);

	// ✅ requestKey / uri が変わったら「新しいリクエスト」とみなし通知状態をリセット
	useEffect(() => {
		notifiedRef.current = false;
	}, [requestKey, uri, size, color]);

	// ✅ uri が無い場合、画像ロード待ちは不要（プレースホルダだけで capture してよい）
	// Renderer が WAIT_IMAGE で待たされないように、マウント時に ready を即通知
	useEffect(() => {
		if (!requestKey) return;
		if (!uri && !notifiedRef.current) {
			notifiedRef.current = true;
			onImageReady?.(requestKey);
		}
	}, [uri, requestKey, onImageReady]);

	const handleLoad = () => {
		// ✅ 成功時通知
		if (!requestKey) return;
		if (notifiedRef.current) return;
		notifiedRef.current = true;
		onImageReady?.(requestKey);
	};

	const handleError = (e: unknown) => {
		// ✅ 失敗時通知：Renderer 側は「画像は無いが capture は進める」判断ができる
		if (!requestKey) return;
		if (notifiedRef.current) return;
		notifiedRef.current = true;
		onImageError?.(requestKey, e);
	};

	/**
	 * ✅ 最後の安全弁：
	 * onLoadEnd は成功/失敗どちらでも呼ばれる。
	 * ただし onError が来ないケースや platform 差があるため、未通知なら ready に倒理解釈で通知。
	 */
	const handleLoadEnd = () => {
		if (!requestKey) return;
		if (notifiedRef.current) return;
		notifiedRef.current = true;
		onImageReady?.(requestKey);
	};

	// style 計算は毎回作らず memo しておく（オフスクリーンでも無駄な再計算を減らす）
	const avatarSizeStyle = useMemo(
		() => ({
			width: size,
			height: size,
			borderRadius: radius,
		}),
		[size, radius],
	);

	return (
		<View
			style={[
				styles.container,
				{
					width: size,
					height: size + 4, // tail 分の高さ
				},
			]}>
			{/* 円形アバター（枠） */}
			<View
				style={[
					styles.avatarContainer,
					avatarSizeStyle,
					{
						// 画像が無い/遅い時のベース（地図の上なので固定色。上のコメント参照）
						backgroundColor: FixedColors.mapMarkerImagePlaceholder,
					},
				]}>
				{uri ? (
					<Image
						/**
						 * ✅ remote image
						 * - view-shot は explainable ではないが、画面外でも描画タイミングが揺れるので
						 *   onLoad/onError を必ず取り、Renderer に「描画準備完了」を通知する
						 */
						source={{ uri, cache: "force-cache" }}
						style={[
							styles.avatarImage,
							avatarSizeStyle,
							{
								borderColor: color,
							},
						]}
						resizeMode="cover"
						onLoad={handleLoad}
						onError={handleError}
						onLoadEnd={handleLoadEnd}
					/>
				) : (
					// uri が無い場合は枠付きのプレースホルダ（renderer には useEffect で即 ready 済み）
					<View
						style={[
							styles.avatarPlaceholder,
							avatarSizeStyle,
							{
								borderColor: color,
							},
						]}
					/>
				)}
			</View>

			{/* バブルしっぽ（tail） */}
			<View
				style={[
					styles.bubbleTail,
					{
						backgroundColor: color,
						bottom: 0,
					},
				]}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		alignItems: "center",
		justifyContent: "flex-start",
	},

	// 円形クリップ
	avatarContainer: {
		overflow: "hidden",
		zIndex: 1,
	},

	// アバター画像（枠はここで付与）
	avatarImage: {
		borderWidth: 2,
	},

	// uri が無い場合のプレースホルダ（枠だけ）
	avatarPlaceholder: {
		borderWidth: 2,
	},

	// tail（回転した四角）
	bubbleTail: {
		position: "absolute",
		width: 8,
		height: 8,
		transform: [{ rotate: "45deg" }],
	},
});
