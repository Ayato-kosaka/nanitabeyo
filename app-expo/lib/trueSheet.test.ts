// #1194 TrueSheet の present/dismiss が「ネイティブ側がもう無い」ときに落ちないこと。
//
// 実機（LINE の共有リンクからアプリ起動）で踏んだ:
//   ERROR [Error: Uncaught (in promise, id: 3) Error: No sheet found with tag 9448]
// が出たあと search 画面へ戻ってしまう、という症状の再発防止。
//
// ⚠️ `ref.current?.present()` のオプショナルチェーンでは防げない。
// JS 側の ref はまだ実体を持っていることがあり、reject するのはネイティブ呼び出しの方。
// そのことをテストでも表現するため、**ref.current は非 null のまま reject させる**。

import type { TrueSheet } from "@lodev09/react-native-true-sheet";
import type { RefObject } from "react";
import { presentSheetSafely, dismissSheetSafely } from "./trueSheet";

/** ref.current は生きているが、ネイティブ呼び出しだけが reject する状態を作る */
const refRejectingWith = (message: string): RefObject<TrueSheet | null> =>
	({
		current: {
			present: jest.fn().mockRejectedValue(new Error(message)),
			dismiss: jest.fn().mockRejectedValue(new Error(message)),
		},
	}) as unknown as RefObject<TrueSheet | null>;

const refResolving = (): RefObject<TrueSheet | null> =>
	({
		current: {
			present: jest.fn().mockResolvedValue(undefined),
			dismiss: jest.fn().mockResolvedValue(undefined),
		},
	}) as unknown as RefObject<TrueSheet | null>;

describe("#1194 TrueSheet の安全な present / dismiss", () => {
	it("ネイティブ側にシートが無い場合は落ちずに false を返す（present）", async () => {
		const ref = refRejectingWith("No sheet found with tag 9448");

		await expect(presentSheetSafely(ref)).resolves.toBe(false);
	});

	it("ネイティブ側にシートが無い場合は落ちずに false を返す（dismiss）", async () => {
		const ref = refRejectingWith("No sheet found with tag 9448");

		await expect(dismissSheetSafely(ref)).resolves.toBe(false);
	});

	it("成功したら true を返す", async () => {
		const ref = refResolving();

		await expect(presentSheetSafely(ref)).resolves.toBe(true);
		await expect(dismissSheetSafely(ref)).resolves.toBe(true);
	});

	it("ref が空なら何も呼ばずに false を返す", async () => {
		const ref = { current: null } as RefObject<TrueSheet | null>;

		await expect(presentSheetSafely(ref)).resolves.toBe(false);
		await expect(dismissSheetSafely(ref)).resolves.toBe(false);
	});

	// ⚠️ ここが重要。**すべての例外を握りつぶすと本当の不具合が見えなくなる**。
	// 握りつぶすのは「シートがもう無い」という想定内のケースだけに限る
	it("それ以外の例外は握りつぶさずに投げ直す", async () => {
		const ref = refRejectingWith("something else went wrong");

		await expect(presentSheetSafely(ref)).rejects.toThrow("something else went wrong");
		await expect(dismissSheetSafely(ref)).rejects.toThrow("something else went wrong");
	});
});
