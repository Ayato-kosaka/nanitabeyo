import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import DishMediaMap from "@/features/dishMedia/components/DishMediaMap";
import type { QueryDishMediaByIdsResponse } from "@shared/api/v1/res";
import type { QueryDishMediaByIdsDto } from "@shared/api/v1/dto";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { OpenInAppBanner } from "@/components/deepLinking/OpenInAppBanner";
import { type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useSeo } from "@/contexts/SeoContext";
import i18n from "@/lib/i18n";
import { SeoOverride } from "@/contexts/SeoContext/SeoProvider";
import { resolvePublicLocale, SITE_NAME_BY_PUBLIC_LOCALE } from "@/constants/seoLocales";

/**
 * #1477 【仕様】`?ids=` は **URL のクエリそのもの**なので、中身は信用できない。
 *
 * この画面は共有リンクの着地先で、`__tests__/sitemap.test.ts` にも
 * 「`?ids=` のクエリ前提で、クエリ無しでは対象が決まらない」と書いてある公開 URL である。
 * リンクが途中で切れた・クローラが加工した・手打ちした、のいずれでも壊れた値が届く。
 *
 * 実測（本番 2026-08-20T15:12:39Z / 1 ユーザー）: `/hi/posts` を **ids 無し**で開いた結果、
 * クライアントが `{ ids: [] }` を送り、`?ids=` として直列化され、サーバの Transform が
 * `"".split(",")` で `[""]` にしたため `@IsUUID` が落ちて 400。その 400 は握り潰されず
 * `DishMediaMap` のオーバーレイに出るため、**ヒンディー語環境のユーザーが
 * `each value in ids must be a UUID` という英語の内部バリデーション文を画面で見た**。
 *
 * したがって「送る前に弾く」のが正しい。UUID の形をしていない値は落とし、
 * 1 件も残らなければ API を呼ばずに「見つかりません」を出す。
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseDishMediaIds = (ids: string | string[] | undefined): string[] => {
	const raw = typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids.flatMap((v) => v.split(",")) : [];
	return raw.map((v) => v.trim()).filter((v) => UUID_PATTERN.test(v));
};

export default function PostsScreen() {
	const { ids, entriesKey: entriesKeyParam } = useLocalSearchParams<{
		ids?: string | string[];
		entriesKey?: string | string[];
	}>();
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const entriesKey =
		typeof entriesKeyParam === "string" && entriesKeyParam.length > 0 ? entriesKeyParam : "PostsScreen";

	const [seoData, setSeoData] = useState<SeoOverride["data"]>({});

	// #717 【設計】useSeo で投稿画面のSEO情報を上書き（フォーカス連動で自動解除）
	// #717 【設計】i18n を使用して多言語対応（ハードコードではなく翻訳キー使用）
	useSeo(seoData);

	const idArray = useMemo(() => parseDishMediaIds(ids), [ids]);
	const hasValidIds = idArray.length > 0;

	useEffect(() => {
		const { upsertDishMediaEntries, updateMediaIdsByKeyAsync, clearByKey } = useDishMediaEntriesStore.getState();
		// #1477 有効な id が 1 件も無いなら API を呼ばない。呼べば必ず 400 になり、
		// その本文（英語のバリデーション文）がそのまま画面に出る。
		if (!hasValidIds) {
			logFrontendEvent({
				event_name: "posts_ids_invalid",
				// 壊れた URL を開かれただけで、アプリは壊れていない（人間の対応は要らない）
				error_level: "warn",
				payload: { hasIdsParam: ids !== undefined, rawCount: typeof ids === "string" ? ids.split(",").length : Array.isArray(ids) ? ids.length : 0 },
			});
			return;
		}
		const fetchData = async () => {
			const requestPayload: QueryDishMediaByIdsDto = { ids: idArray };
			const responsePromise = callBackend<QueryDishMediaByIdsDto, QueryDishMediaByIdsResponse>("v1/dish-media", {
				method: "GET",
				requestPayload,
			});
			const idsPromise = responsePromise.then((res) => {
				// SEOデータの設定
				res.items.length > 0 &&
					setSeoData({
						title: SITE_NAME_BY_PUBLIC_LOCALE[resolvePublicLocale(i18n.locale)] + " - " + res.items[0].restaurant.name,
						...(res.items[0].dish_reviews.length > 0 ? { description: res.items[0].dish_reviews[0].comment } : {}),
						image: res.items[0].dish_media.thumbnailImageUrl ?? undefined,
						imageAlt: res.items[0].restaurant.name,
					});

				// ストアにデータを格納
				upsertDishMediaEntries(res.items);
				return res.items.map((item) => String(item.dish_media.id));
			});
			updateMediaIdsByKeyAsync(entriesKey, idsPromise, (_, fetchedIds) => fetchedIds);
		};
		fetchData();
		return () => {
			clearByKey(entriesKey);
		};
	}, [callBackend, entriesKey, ids, idArray, hasValidIds, logFrontendEvent]);

	// #721 testID は共有リンク（/s/:token）が «捨てられず投稿画面へ着地したか» を E2E から見るための目印。
	// 解決画面は resolve の往復の間しか出ず観測できないため、着地先そのものを観測点にしている。見た目には影響しない
	// #1477 壊れた URL で着地した人には、内部エラー文ではなく «見つかりません» を出す。
	if (!hasValidIds) {
		return (
			<LinearGradient colors={colors.backgroundGradient} style={styles.container} testID="posts-screen">
				<View style={styles.notFoundContainer}>
					<Text style={styles.notFoundText} testID="posts-not-found">
						{i18n.t("Common.errors.notFound")}
					</Text>
				</View>
			</LinearGradient>
		);
	}

	return (
		<LinearGradient colors={colors.backgroundGradient} style={styles.container} testID="posts-screen">
			{/* #688 【設計】Web Deep Linking バナー（アプリ未インストール時の導線） */}
			<OpenInAppBanner path="posts" params={{ ids, entriesKey }} />
			<DishMediaMap entriesKey={entriesKey} idType="dish_media" />
		</LinearGradient>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: { flex: 1 },
		notFoundContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
		notFoundText: { fontSize: 16, color: c.textSecondary, textAlign: "center" },
	});
