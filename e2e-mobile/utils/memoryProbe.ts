import { execFileSync } from "node:child_process";

import { device } from "detox";

/**
 * 📈 #1641 **アプリのメモリ使用量を実機から読む（Android のみ）。**
 *
 * ## なぜ要るのか
 *
 * 埋め込みセルを 5 本並べたところ、Android エミュレータが `lowmemorykiller` で
 * アプリを殺した（run 33133043261）。**クラッシュではなくプロセス消滅**なので
 * クラッシュバッファには何も残らず、失敗時のスクリーンショットはランチャーだった。
 * つまり «落ちた» ことしか分からず、**何がどれだけ食っているのかが観測できていない**。
 *
 * 直す前に «見えるようにする» のが先である（CLAUDE.md「完了の定義」§4）。
 * セルを 1 つ送るごとにここを呼ぶと、
 *
 *     セル 0（youtube）  totalPss 210MB / nativeHeap 60MB
 *     セル 1（tiktok）   totalPss 320MB / nativeHeap 120MB
 *     ...
 *
 * のような «増え方» が run のログに残る。**戻っているのか、積み上がるだけなのか**が
 * 数字で分かるので、対策（本数制限 / 破棄の仕方）の効果もこの数字で判定できる。
 *
 * ⚠️ **iOS では取れない。** `dumpsys` は Android の仕組みなので、iOS では null を返す。
 *    ここで例外を投げると spec が落ちるので、**取れないことは失敗ではない**扱いにする。
 */

/** `dumpsys meminfo` から読む主要な内訳（KB） */
export type MemorySnapshot = {
	/** プロセス全体の PSS。lowmemorykiller が見るのはこれに近い */
	totalPssKb: number;
	/** Java ヒープ（RN の JS ではなく Android 側） */
	javaHeapKb: number;
	/** ネイティブヒープ。**WebView / Chromium はここに乗る** */
	nativeHeapKb: number;
	/** グラフィック（テクスチャ等）。全画面の映像はここも伸びる */
	graphicsKb: number;
};

const PACKAGE = "com.nanitabeyo";

function adb(args: string[]): string {
	return execFileSync("adb", ["-s", device.id, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

/**
 * `dumpsys meminfo` の «App Summary» から数値を拾う。
 *
 * 出力例（Android 14）:
 *
 *      App Summary
 *                         Pss(KB)  Rss(KB)
 *                          ------   ------
 *             Java Heap:    41880    93184
 *           Native Heap:   131072   140000
 *              Graphics:    52000    52000
 *              TOTAL PSS:  321000
 *
 * ⚠️ 見出しの綴りと桁位置は端末・OS で揺れる。**行の先頭ラベルで拾い、最初の数値を採る**。
 */
function parseMeminfo(dump: string): MemorySnapshot | null {
	const pick = (label: RegExp): number | null => {
		const line = dump.split("\n").find((row) => label.test(row));
		if (!line) return null;
		const value = /(-?\d+)/.exec(line.replace(label, ""));
		return value ? Number(value[1]) : null;
	};

	const totalPssKb = pick(/TOTAL PSS:/) ?? pick(/TOTAL:/);
	const javaHeapKb = pick(/Java Heap:/);
	const nativeHeapKb = pick(/Native Heap:/);
	const graphicsKb = pick(/Graphics:/);
	if (totalPssKb === null) return null;
	return {
		totalPssKb,
		javaHeapKb: javaHeapKb ?? 0,
		nativeHeapKb: nativeHeapKb ?? 0,
		graphicsKb: graphicsKb ?? 0,
	};
}

/**
 * いまのアプリのメモリ使用量を読む。
 *
 * @returns Android なら内訳 / iOS・adb が使えない場合は null（**例外は投げない**）
 */
export function readMemory(): MemorySnapshot | null {
	if (device.getPlatform() !== "android") return null;
	try {
		return parseMeminfo(adb(["shell", "dumpsys", "meminfo", PACKAGE]));
	} catch {
		return null;
	}
}

/** run のログへ 1 行で残す。**数字は MB に丸めて読みやすくする**（判断に必要な桁はこれで足りる） */
export function logMemory(label: string): MemorySnapshot | null {
	const snapshot = readMemory();
	if (!snapshot) return null;
	const mb = (kb: number) => (kb / 1024).toFixed(0);
	// eslint-disable-next-line no-console -- run のログへ残すことが目的
	console.log(
		`[mem] ${label} totalPss=${mb(snapshot.totalPssKb)}MB` +
			` java=${mb(snapshot.javaHeapKb)}MB` +
			` native=${mb(snapshot.nativeHeapKb)}MB` +
			` graphics=${mb(snapshot.graphicsKb)}MB`,
	);
	return snapshot;
}
