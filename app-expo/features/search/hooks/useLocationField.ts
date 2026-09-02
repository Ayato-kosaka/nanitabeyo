import { useCallback, useRef, useState } from "react";
import type { AutocompleteLocation, LocationDetailsResponse } from "@shared/api/v1/res";
import type { LocationAutocompleteHandle, RecentLocation } from "@/components/LocationAutocomplete";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { LocationPermissionError, type LocationPermissionErrorKind } from "@/hooks/locationPermissionError";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocationSearch } from "@/hooks/useLocationSearch";
import { useLogger } from "@/hooks/useLogger";
import { toErrorLogString } from "@/lib/errorMessage";
import i18n from "@/lib/i18n";
import {
	getCurrentLocationErrorMessage,
	shouldFallbackToManualInput,
} from "@/features/search/currentLocationErrorMessage";
import { useRecentLocations } from "@/features/search/hooks/useRecentLocations";

/** 緯度経度が確定済みの地点（details API のレスポンスから viewport を除いた形） */
type ResolvedLocation = Omit<LocationDetailsResponse, "viewport">;

/**
 * #1133 【設計】確定した地点は「まだ緯度経度を知らない経路」と「もう知っている経路」の 2 種類しかない。
 *
 * オートコンプリートの候補は `place_id` しか持たず、緯度経度は details API を叩くまで判らない。
 * 一方で現在地と「最近使った場所」は緯度経度が確定済みで、`place_id` を持たない。
 * 呼び出し元はこの 2 つで後続処理（details の遅延取得の要否、検索キーの作り方）を変える必要があるため、
 * 判別可能 union で返して分岐を強制する。どちらか一方だけを扱う実装は型で落ちる。
 */
export type SelectedLocation =
	/** サジェスト選択。詳細(緯度経度)は未取得なので、必要なら呼び出し元が遅延取得する */
	| { kind: "prediction"; prediction: AutocompleteLocation; locationQuery: string }
	/** 現在地 or 最近使った場所。緯度経度が確定済みで place_id は無い */
	| { kind: "resolved"; location: ResolvedLocation; locationQuery: string };

type Params = {
	/**
	 * ログの payload に載せる画面名。
	 * ⚠️ **イベント名は画面によらず同一**にし、出所は payload の `screen` で区別する。
	 * 既存の分析基盤がイベント名で集計している可能性があり、名前を分けると過去との連続性が切れるため。
	 */
	screen: string;
	/** 地点が確定したときに呼ばれる */
	onSelected: (selected: SelectedLocation) => void;
};

/**
 * #1133 「どのあたりで探す」の入力欄の振る舞い（現在地取得・最近使った場所・クリア）をまとめたフック。
 *
 * ホーム（検索タブ）では同じ振る舞いが `app/[locale]/(tabs)/search/index.tsx` に直接書かれている。
 * 保存料理タブでも同じ体験を出すにあたり、コピーすると片方だけ直る事故が確実に起きるため共通化した。
 *
 * ⚠️ 現時点で**ホーム側はまだこのフックを使っていない**（移行は別 Issue）。
 * それまではホームとこのフックに同じ振る舞いが 2 つ存在する。挙動を変えるときは両方直すこと。
 * ここの実装はすべて「ホームの現在の挙動」に一致させてあり、意図的な差分は無い。
 *
 * UI（`LocationAutocomplete`）は状態を持たない表示専任なので、このフックは UI を持たず
 * 「表示用の文字列・ref・ハンドラ」だけを返す。
 */
export function useLocationField({ screen, onSelected }: Params) {
	const [locationQuery, setLocationQuery] = useState("");

	const { getCurrentLocation } = useLocationSearch();
	const { showSnackbar } = useSnackbar();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	// #953 直近5件の地点。ホームと同じリストを共有する（ストレージキーは増やさない）
	const { recentLocations, addRecentLocation, clearRecentLocations } = useRecentLocations();

	// #932 【設計】現在地取得の恒久的な失敗(権限拒否・未対応)時に手入力へ誘導するため
	const inputRef = useRef<LocationAutocompleteHandle>(null);

	// onSelected は呼び出し元でインライン定義されがちなので ref 経由で最新を読む。
	// 依存配列に入れると、返すハンドラの同一性が毎レンダリング壊れて子の再描画を誘発する。
	const onSelectedRef = useRef(onSelected);
	onSelectedRef.current = onSelected;

	// #1133 【設計】「最近使った場所」への登録関数はここには置かない。
	// サジェスト経由の登録は details が解決してから（＝呼び出し元が遷移したあと）でないとできず、
	// その時点でこのフックを持つフォームは閉じている。ここに置くと**本番から呼ばれない関数**が
	// テストだけ緑になり、実際に走る呼び出し元側の実装（viewport の除去など）は無防備になる。
	// 登録は呼び出し元が行い、そこでテストする（`features/profile/tabs/SavedDishCategoriesTab.test.tsx`）。

	/** サジェスト選択。ここでは details を取りに行かず、取得の要否は呼び出し元に委ねる */
	const handleSelectSuggestion = useCallback(
		(prediction: AutocompleteLocation) => {
			logFrontendEvent({
				event_name: "location_selected",
				error_level: "log",
				payload: { placeId: prediction.place_id, mainText: prediction.mainText, screen },
			});
			setLocationQuery(prediction.mainText);
			onSelectedRef.current({ kind: "prediction", prediction, locationQuery: prediction.mainText });
		},
		[logFrontendEvent, screen],
	);

	/** #953 最近使った場所は details API を呼び直さず、保存済みの location をそのまま復元する */
	const handleSelectRecentLocation = useCallback(
		(recent: RecentLocation) => {
			logFrontendEvent({
				event_name: "recent_location_selected",
				error_level: "log",
				payload: { locationQuery: recent.locationQuery, screen },
			});
			setLocationQuery(recent.locationQuery);
			onSelectedRef.current({ kind: "resolved", location: recent, locationQuery: recent.locationQuery });
			// #1129 【仕様】再選択した地点を MRU(Most Recently Used)順で先頭へ引き上げる。
			// addRecentLocation は同一地点を除去してから先頭へ積むため、件数は増えない。
			// ⚠️ #1129 はホームの画面側(`search/index.tsx`)に実装されており `useRecentLocations` の中には無い。
			// そのためこの 1 行が要る。落とすと「ホームでは先頭に来るが保存料理では来ない」不整合になる。
			addRecentLocation(recent);
		},
		[logFrontendEvent, addRecentLocation, screen],
	);

	const handleUseCurrentLocation = useCallback(async () => {
		lightImpact();
		logFrontendEvent({
			event_name: "current_location_requested",
			error_level: "log",
			payload: { screen },
		});
		try {
			const currentLocation = await getCurrentLocation();
			const query = i18n.t("Search.currentLocation");
			setLocationQuery(query);
			onSelectedRef.current({ kind: "resolved", location: currentLocation, locationQuery: query });
			logFrontendEvent({
				event_name: "current_location_success",
				error_level: "log",
				payload: { hasLocation: !!currentLocation, screen },
			});
		} catch (error) {
			const kind: LocationPermissionErrorKind = error instanceof LocationPermissionError ? error.kind : "unavailable";
			logFrontendEvent({
				event_name: "current_location_failed",
				error_level: "error",
				payload: { error: toErrorLogString(error), kind, screen },
			});
			showSnackbar(getCurrentLocationErrorMessage(kind));

			// #932 【設計】権限拒否・未対応は再試行しても解決しないため、手入力へ誘導する
			if (shouldFallbackToManualInput(kind)) {
				inputRef.current?.focus();
			}
		}
	}, [lightImpact, logFrontendEvent, getCurrentLocation, showSnackbar, screen]);

	/**
	 * 入力欄のクリア。
	 * ⚠️ ここでは `onSelected` を呼ばない。`SelectedLocation` は「確定した地点」を表す型であり、
	 * クリアは確定ではないため。呼び出し元が選択解除を知る必要が出たら、そのとき union を増やすこと。
	 */
	const handleClear = useCallback(() => {
		lightImpact();
		setLocationQuery("");
		logFrontendEvent({
			event_name: "location_cleared",
			error_level: "log",
			payload: { screen },
		});
	}, [lightImpact, logFrontendEvent, screen]);

	return {
		locationQuery,
		setLocationQuery,
		inputRef,
		recentLocations,
		clearRecentLocations,
		handleSelectSuggestion,
		handleSelectRecentLocation,
		handleUseCurrentLocation,
		handleClear,
	};
}
