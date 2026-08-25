import { DEFAULT_TIMEOUT, by, element, existsNow, tapWhenVisible, waitUntil, waitUntilVisible } from "../fixtures/e2e";

/** 通知カテゴリ key（app 側 shared/api/v1/constants/notificationCategories.ts と一致させる） */
export type NotificationCategoryKey = "likes" | "saves" | "group_votes";

export const NOTIFICATION_CATEGORY_KEYS: NotificationCategoryKey[] = ["likes", "saves", "group_votes"];

/**
 * 🔔 設定画面の「通知」カード（#1510 SET-02）の Screen Object。
 *
 * 対応コンポーネント: `app-expo/features/settings/components/NotificationSettingsCard.tsx`
 * e2e-web 側の対応物: `e2e-web/pages/SettingsPage.ts` の `notificationToggle()` 周辺。
 *
 * ## 押すのは行、状態は行から読む
 * `SettingsToggleItem` は行全体をタップ対象にし、Switch は `pointerEvents="none"` で
 * タッチを親へ透過させる。Switch を直接タップしようとすると透過して座標だけが合った
 * 別の要素に当たりうるので、**必ず行（`settings-notifications-<category>`）をタップする。**
 *
 * ## 状態の読み取りについて（正直な但し書き）
 * Detox には `accessibilityState` を検証する API が無く（utils/waits.ts の `waitUntil` 参照）、
 * トグルの on/off は `getAttributes()` で読むしかない。**この PR では Detox を実行していない**ため、
 * on/off が `value` / `text` / `label` のどれに載るかは実測で確認できていない。
 * そこで「特定の属性の絶対値」を期待値にせず、**タップ前後で状態シグネチャが変わったこと**を
 * 見る形にしてある（ResultScreen の `waitForLikeLabelChange` と同じ考え方）。
 * CI で実測できたら、`readStateSignature()` を実際の属性 1 本に絞ってよい。
 */
export class NotificationSettingsSection {
	/** 通知カード全体。ゲスト（匿名）には描画されない */
	readonly card = by.id("settings-notifications-card");
	/** 読み込み失敗時に出る再試行行（トグルの代わりに出る） */
	readonly errorRow = by.id("settings-notifications-error");
	/** OS 側で通知が拒否されているときだけ出る案内行 */
	readonly osDeniedNotice = by.id("settings-notifications-os-denied");

	/** カテゴリのトグル行（タップ対象） */
	row(category: NotificationCategoryKey): Detox.NativeMatcher {
		return by.id(`settings-notifications-${category}`);
	}

	/** カテゴリの Switch 本体（表示確認用。タップしない） */
	switchOf(category: NotificationCategoryKey): Detox.NativeMatcher {
		return by.id(`settings-notifications-${category}-switch`);
	}

	/** カードが表示されるまで待つ */
	async expectVisible(timeout: number = DEFAULT_TIMEOUT): Promise<void> {
		await waitUntilVisible(this.card, timeout);
	}

	/** カードが **無い** ことを待たずに判定する（ゲスト側の検証用） */
	async exists(): Promise<boolean> {
		return existsNow(this.card);
	}

	/** OS 拒否の案内行が出ているかを待たずに判定する */
	async hasOsDeniedNotice(): Promise<boolean> {
		return existsNow(this.osDeniedNotice);
	}

	/** 読み込み失敗の再試行行が出ているかを待たずに判定する */
	async hasErrorRow(): Promise<boolean> {
		return existsNow(this.errorRow);
	}

	/** カテゴリ行をタップして切り替える */
	async toggle(category: NotificationCategoryKey): Promise<void> {
		await tapWhenVisible(this.row(category));
	}

	/**
	 * トグルの状態を表す文字列を読む。
	 *
	 * `getAttributes()` の戻り値は iOS / Android で形が分かれるため、
	 * on/off を載せうる属性をまとめて 1 本の文字列にする。
	 * **値そのものに意味は無く、変化の検出にだけ使う。**
	 */
	async readStateSignature(category: NotificationCategoryKey): Promise<string> {
		const attributes = (await element(this.row(category)).getAttributes()) as {
			value?: unknown;
			text?: unknown;
			label?: unknown;
		};
		return JSON.stringify([attributes.value, attributes.text, attributes.label]);
	}

	/**
	 * タップ前の状態シグネチャから変化するまで待ち、変化後の値を返す。
	 *
	 * 楽観更新しているので、通信の往復を待たずに変化するのが期待挙動。
	 * 逆に「保存に失敗したら元へ戻る」までを見たい場合は、戻り切るのを
	 * `waitUntil` で待つこと（この spec ではネットワークを差し替えられないため扱わない）。
	 */
	async waitForStateChange(
		category: NotificationCategoryKey,
		from: string,
		timeout: number = DEFAULT_TIMEOUT,
	): Promise<string> {
		await waitUntil(async () => (await this.readStateSignature(category)) !== from, {
			timeout,
			description: `${category} トグルの状態変化`,
		});
		return this.readStateSignature(category);
	}
}
