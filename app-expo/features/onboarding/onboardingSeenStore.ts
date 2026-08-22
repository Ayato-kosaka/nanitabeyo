/*
このファイルの責務
- 「オンボーディングを見終わったか」という **アプリ内で唯一の真実** を持つ。
- AsyncStorage への読み書きと、値が変わったことの購読を提供する。

#1486 【設計】なぜフックではなくモジュールスコープのストアなのか。

旧実装（features/search/hooks/useSearchTutorial.ts）は `useState` をフックの中に閉じていた。
チュートリアルが検索画面の中の BottomSheet だった頃は、読む側も書く側も同じ画面の同じ
フック呼び出しだったので、それで足りていた。

新オンボーディングでは読み手と書き手が **別のコンポーネント**へ分かれる。

| 誰が | 何をする |
| --- | --- |
| `app/[locale]/(tabs)/search/index.tsx` | 未読なら自動でオンボーディングへ送る（読む） |
| `app/[locale]/onboarding/welcome.tsx` | 「はじめる」で完了を確定する（書く） |
| `components/MetaAppEventsInitializer.tsx` | 完了するまで ATT を要求しない（読む） |

フックローカルの state のままだと、welcome が書いても検索画面と Meta の初期化は
**古い値を持ったまま**になる。とくに ATT は「オンボーディング完了 → 直後に要求」という
順序そのものが要件（#1486 §8）なので、通知が届かないと要件を満たせない。

⚠️ ストレージキーは旧チュートリアルから **1 文字も変えないこと**（#1486 §3）。
既存ユーザーは既にこのキーで既読になっており、キーを変えると全員に再表示される。
e2e-web/utils/storage.ts の `TUTORIAL_STORAGE_KEY` とも一致させること。
*/
import AsyncStorage from "@react-native-async-storage/async-storage";

import { readE2ETutorialSeen } from "@/lib/e2e/tutorialSeed";

/** #1486 §3 旧チュートリアルと同一のキー。変更禁止（既存ユーザーの既読が飛ぶ） */
export const ONBOARDING_STORAGE_KEY = "search_tutorial_seen_v1";

/** `null` = まだ読み込んでいない（＝どちらとも判定してはいけない） */
type SeenState = boolean | null;

let seen: SeenState = null;
let loadPromise: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) listener();
};

const setSeen = (next: boolean) => {
	if (seen === next) return;
	seen = next;
	emit();
};

/**
 * 現在の値を同期的に返す。まだ読み込んでいなければ `null`。
 *
 * `useSyncExternalStore` の getSnapshot として使うため、**同じ値なら同じ参照**を返すこと
 * （boolean と null しか返さないので自然に満たされる）。
 */
export const getOnboardingSeenSnapshot = (): SeenState => seen;

/** 値の変化を購読する。戻り値を呼ぶと解除される */
export const subscribeOnboardingSeen = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/**
 * AsyncStorage から既読状態を読み込む。多重呼び出しは同じ Promise を共有する。
 *
 * @失敗時 例外は投げない。読めなかった場合は「未読」へ倒す。
 * ここで throw するとアプリが起動しなくなるうえ、最悪でもオンボーディングが
 * 1 回余分に出るだけで済むため（旧実装 useSearchTutorial.ts と同じ方針）。
 */
export const loadOnboardingSeen = (): Promise<boolean> => {
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		// #1027 【設計】E2E(Detox) では起動引数で既読フラグを固定できる。通常ビルドでは
		// metro の resolver が noop 実装へ差し替えるため、この関数は常に null を返す
		//（= 以下の AsyncStorage 読み込みへそのまま進み、本番と 1 バイトも挙動が変わらない）
		const seeded = readE2ETutorialSeen();
		if (seeded !== null) {
			setSeen(seeded);
			return seeded;
		}

		try {
			const value = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
			setSeen(value === "true");
			return value === "true";
		} catch (error) {
			console.error("Failed to load onboarding state:", error);
			setSeen(false);
			return false;
		}
	})();

	return loadPromise;
};

/**
 * オンボーディング完了を確定する（#1486 §7「Welcome画面完了時点で完了フラグを確定」）。
 *
 * 書き込みの成否によらず購読者へは「既読」を通知する。ここで失敗するのは
 * ストレージが壊れているときだけで、その場合でも **今このセッションでは**
 * オンボーディングを再表示すべきではないため。
 */
export const markOnboardingSeen = async (): Promise<void> => {
	setSeen(true);
	// loadOnboardingSeen() がまだ走っていない場合に、後から古い値で上書きされないようにする
	loadPromise = Promise.resolve(true);

	try {
		await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
	} catch (error) {
		console.error("Failed to save onboarding state:", error);
	}
};

/** 既読状態をリセットする（開発 / テスト用） */
export const resetOnboardingSeen = async (): Promise<void> => {
	setSeen(false);
	loadPromise = Promise.resolve(false);

	try {
		await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
	} catch (error) {
		console.error("Failed to reset onboarding state:", error);
	}
};

/** テスト専用: モジュールスコープの状態を初期化する */
export const __resetOnboardingSeenStoreForTest = () => {
	seen = null;
	loadPromise = null;
	listeners.clear();
};
