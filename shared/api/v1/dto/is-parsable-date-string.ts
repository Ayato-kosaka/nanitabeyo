import { registerDecorator, type ValidationOptions } from "class-validator";

/**
 * #1599 その文字列を `new Date()` に渡して**実在の時刻になる**ことを要求する。
 *
 * ## なぜ `@IsISO8601()` だけでは足りないのか
 *
 * `@IsISO8601()`（validator.js の `isISO8601`）は **ISO 8601 の «形»** を見るだけで、
 * JavaScript の `Date` が解釈できるかは見ない。ISO 8601 には週日付や基本形式もあり、
 * それらは規格として正しいのに `new Date()` では **Invalid Date** になる。
 *
 * ```
 * value        @IsISO8601()   new Date(value)
 * "2026-W01"   通る            Invalid Date
 * "2026-W01-1" 通る            Invalid Date
 * "20260826"   通る            Invalid Date
 * "2026-02-30" 通る            2026-03-02（黙って別の日になる）
 * ```
 *
 * この差はそのままバグになる。`my-dishes.query.ts` と
 * `contribution-tasks.service.ts` は受け取った文字列を `new Date(...)` して
 * そのままクエリの条件に載せており、Invalid Date が Prisma まで流れる。
 * ユーザーからは `?from=20260826`（ISO 8601 の基本形式として妥当な入力）で
 * 一覧が壊れて見える。
 *
 * ## この検査の契約
 *
 * **「`new Date()` に渡して安全」** ちょうどそれだけを保証する。呼び出し側が
 * 実際にやることと同じ判定にしてあるので、判定と用途がずれない。
 *
 * `@IsISO8601({ strict: true })` と併用すること。こちらは «実在しない日付»
 * （`2026-02-30`）を弾かない — `new Date()` が黙って繰り上げてしまうため。
 */
export function IsParsableDateString(validationOptions?: ValidationOptions) {
	return function (object: object, propertyName: string) {
		registerDecorator({
			name: "isParsableDateString",
			target: object.constructor,
			propertyName,
			options: validationOptions,
			validator: {
				validate(value: unknown) {
					if (typeof value !== "string") return false;
					return !Number.isNaN(new Date(value).getTime());
				},
				defaultMessage() {
					return `${propertyName} must be a date string that JavaScript can parse (e.g. 2026-08-26 or 2026-08-26T00:00:00Z)`;
				},
			},
		});
	};
}
