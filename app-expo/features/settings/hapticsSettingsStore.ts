/*
このファイルの責務
- 「ハプティクスを鳴らすか」という **アプリ内で唯一の真実** を持つ。
- AsyncStorage への読み書きと、値が変わったことの購読を提供する。

#1504 【設計】onboardingSeenStore.ts と同じ、モジュールスコープのストア + AsyncStorage
というこのリポジトリ既存の作法に揃えている（zustand の persist ミドルウェアはこのリポジトリで
未使用のため、新しい保存基盤を持ち込まないという Issue の指示に従い採用しない）。

⚠️ onboardingSeenStore.ts と違い、こちらは既定値が「オン」(= 現状維持) である。
未読込みの間も `getHapticsEnabledSnapshot()` は `true` を返す必要がある
（`useHaptics` は 100 箇所以上から呼ばれており、読み込み完了前に振動が止まってしまうと
既定値オンという要件を満たせない）。
*/
import AsyncStorage from "@react-native-async-storage/async-storage";

export const HAPTICS_ENABLED_STORAGE_KEY = "haptics_enabled_v1";

let enabled = true;
let loadPromise: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) listener();
};

const setEnabledState = (next: boolean) => {
	if (enabled === next) return;
	enabled = next;
	emit();
};

/** 現在の値を同期的に返す。`useSyncExternalStore` の getSnapshot として使うため、同じ値なら同じ参照を返す */
export const getHapticsEnabledSnapshot = (): boolean => enabled;

/** 値の変化を購読する。戻り値を呼ぶと解除される */
export const subscribeHapticsEnabled = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/**
 * AsyncStorage から設定を読み込む。多重呼び出しは同じ Promise を共有する。
 *
 * @失敗時 例外は投げない。読めなかった場合は既定値(オン)へ倒す。
 */
export const loadHapticsEnabled = (): Promise<boolean> => {
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		try {
			const value = await AsyncStorage.getItem(HAPTICS_ENABLED_STORAGE_KEY);
			// 未設定(= 初回起動)は既定値オンのまま。保存済みの値がある場合のみそれに従う
			const next = value === null ? true : value === "true";
			setEnabledState(next);
			return next;
		} catch (error) {
			console.error("Failed to load haptics setting:", error);
			setEnabledState(true);
			return true;
		}
	})();

	return loadPromise;
};

/** トグル操作を確定する。書き込みの成否によらず、このセッションでは即座に値を反映する */
export const setHapticsEnabled = async (next: boolean): Promise<void> => {
	setEnabledState(next);
	// loadHapticsEnabled() がまだ走っていない場合に、後から古い値で上書きされないようにする
	loadPromise = Promise.resolve(next);

	try {
		await AsyncStorage.setItem(HAPTICS_ENABLED_STORAGE_KEY, next ? "true" : "false");
	} catch (error) {
		console.error("Failed to save haptics setting:", error);
	}
};

/** テスト専用: モジュールスコープの状態を初期化する */
export const __resetHapticsSettingsStoreForTest = () => {
	enabled = true;
	loadPromise = null;
	listeners.clear();
};
