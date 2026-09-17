/**
 * #288 「選んだ時間帯」と「営業時間」を突き合わせるための時間帯（timeSlot）の窓の正本。
 *
 * この境界値は元々 `app-expo/app/[locale]/(tabs)/search/index.tsx` の中に
 * ローカル定数として直書きされていた。検索画面（端末時刻から現在の timeSlot を
 * 自動選択する）と `shared/utils/openingHours.ts`（選んだ timeSlot の窓と営業時間が
 * 重なるかを判定する）の**両方**がこの境界を使うため、ここへ1箇所へ切り出す。
 * 値を2箇所に書き写すと、どちらか片方だけ直って揃わなくなる事故が起きる
 * （このリポジトリで繰り返し起きているパターン。CLAUDE.md 参照）。
 */

export type TimeSlot = "morning" | "lunch" | "dinner" | "late_night";

export const TIME_SLOTS: readonly TimeSlot[] = ["morning", "lunch", "dinner", "late_night"];

/**
 * ある timeSlot の窓（[startMinutes, endMinutesExclusive) 、真夜中からの分）。
 * `endMinutesExclusive <= startMinutes` は日をまたぐ窓（late_night: 22:00〜翌5:00）を表す。
 * `restaurant_opening_hours` の `crossesMidnight` と同じ表現。
 */
export type TimeSlotWindow = {
	slot: TimeSlot;
	startMinutes: number;
	endMinutesExclusive: number;
};

// morning=5:00-10:00 / lunch=10:00-15:00 / dinner=15:00-22:00 / late_night=22:00-翌5:00
export const TIME_SLOT_WINDOWS: readonly TimeSlotWindow[] = [
	{ slot: "morning", startMinutes: 5 * 60, endMinutesExclusive: 10 * 60 },
	{ slot: "lunch", startMinutes: 10 * 60, endMinutesExclusive: 15 * 60 },
	{ slot: "dinner", startMinutes: 15 * 60, endMinutesExclusive: 22 * 60 },
	{ slot: "late_night", startMinutes: 22 * 60, endMinutesExclusive: 5 * 60 },
];

/** {@link TIME_SLOT_WINDOWS} から該当する窓を取り出す */
export function getTimeSlotWindow(slot: TimeSlot): TimeSlotWindow {
	const window = TIME_SLOT_WINDOWS.find((w) => w.slot === slot);
	if (!window) throw new Error(`unknown time slot: ${slot}`);
	return window;
}

/**
 * ある時刻（真夜中からの分, 0-1439）が属する timeSlot を返す。
 * 検索画面の「端末時刻から timeSlot を自動選択する」に使う。
 */
export function resolveTimeSlotForMinutes(minutesOfDay: number): TimeSlot {
	const window = TIME_SLOT_WINDOWS.find((w) =>
		w.startMinutes < w.endMinutesExclusive
			? minutesOfDay >= w.startMinutes && minutesOfDay < w.endMinutesExclusive
			: minutesOfDay >= w.startMinutes || minutesOfDay < w.endMinutesExclusive,
	);
	// TIME_SLOT_WINDOWS は 24時間を隙間なく分割しているので、必ずどれかに一致する
	return window!.slot;
}
