// #1194 フロントログのバッチを «バイト数» で分割できること。
//
// 実機で踏んだ症状:
//   ⚠️ frontend log batch dropped: kind=transient status=500 count=17
// dev の Cloud Run ログには PayloadTooLargeError（body-parser の既定 100 kB 超過）。
// 件数（20 件）だけで区切っていたため、payload が大きいログが混ざると上限を超えていた。

import type { CreateFrontendLogDto } from "@shared/api/v1/dto";
import { MAX_BATCH_BYTES, splitLogBatchesByByteSize, utf8ByteLength } from "./logBatchSize";

/** 指定バイト数«程度» のログを作る（ASCII なので 1 文字 = 1 バイト） */
const logOfSize = (bytes: number, index = 0): CreateFrontendLogDto =>
	({
		event_name: `e${index}`,
		error_level: "log",
		path_name: "/x",
		created_at: "2026-08-08T00:00:00.000Z",
		payload: { blob: "a".repeat(Math.max(0, bytes)) },
	}) as unknown as CreateFrontendLogDto;

const batchBytes = (batch: CreateFrontendLogDto[]): number =>
	batch.reduce((sum, log) => sum + utf8ByteLength(JSON.stringify(log)) + 1, 0);

describe("#1194 UTF-8 のバイト長", () => {
	it("ASCII は 1 文字 1 バイト", () => {
		expect(utf8ByteLength("abc")).toBe(3);
	});

	// ⚠️ ここが今回の見積もり誤りの本体。日本語は 1 文字 3 バイト
	it("日本語は 1 文字 3 バイト（str.length で代用すると 1/3 に見誤る）", () => {
		expect("ログ".length).toBe(2);
		expect(utf8ByteLength("ログ")).toBe(6);
	});

	it("絵文字（サロゲートペア）は 4 バイト", () => {
		expect(utf8ByteLength("🍣")).toBe(4);
	});
});

describe("#1194 バイト数によるバッチ分割", () => {
	it("上限に収まるならまとめて 1 バッチ", () => {
		const logs = [logOfSize(10, 0), logOfSize(10, 1)];

		const { batches, oversized } = splitLogBatchesByByteSize(logs, 1000);

		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(2);
		expect(oversized).toEqual([]);
	});

	it("上限を超えたら分割し、どのバッチも上限以下になる", () => {
		const logs = Array.from({ length: 10 }, (_, i) => logOfSize(200, i));

		const { batches } = splitLogBatchesByByteSize(logs, 600);

		expect(batches.length).toBeGreaterThan(1);
		for (const batch of batches) expect(batchBytes(batch)).toBeLessThanOrEqual(600);
	});

	it("全件が «いずれかの» バッチに入り、順序も保たれる", () => {
		const logs = Array.from({ length: 7 }, (_, i) => logOfSize(200, i));

		const { batches } = splitLogBatchesByByteSize(logs, 600);

		expect(batches.flat().map((l) => l.event_name)).toEqual(logs.map((l) => l.event_name));
	});

	// ⚠️ 分割し続けても永久に通らないので、送らずに捨てて数える
	it("1 件だけで上限を超えるログは送らず oversized へ回す", () => {
		const logs = [logOfSize(10, 0), logOfSize(5000, 1), logOfSize(10, 2)];

		const { batches, oversized } = splitLogBatchesByByteSize(logs, 1000);

		expect(oversized).toHaveLength(1);
		expect(oversized[0].event_name).toBe("e1");
		// 巨大な 1 件のせいで «他のログまで» 落とさないこと
		expect(batches.flat().map((l) => l.event_name)).toEqual(["e0", "e2"]);
	});

	it("空配列なら何も返さない", () => {
		expect(splitLogBatchesByByteSize([], 1000)).toEqual({ batches: [], oversized: [] });
	});

	// 既定値はサーバ側（express body-parser の既定 100 kB）より小さいこと。
	// ここが逆転すると分割しても 413 になり、この対策そのものが無意味になる
	it("既定の上限はサーバの 100 kB より小さい", () => {
		expect(MAX_BATCH_BYTES).toBeLessThan(100 * 1024);
	});

	it("既定の上限でも 20 件ぶんの現実的なログはまとめて送れる", () => {
		const logs = Array.from({ length: 20 }, (_, i) => logOfSize(500, i));

		const { batches, oversized } = splitLogBatchesByByteSize(logs);

		expect(batches).toHaveLength(1);
		expect(oversized).toEqual([]);
	});
});
