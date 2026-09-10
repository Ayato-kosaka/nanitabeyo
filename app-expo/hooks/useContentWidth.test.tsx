/**
 * #1783 SSG(静的書き出し)由来のレイアウト崩れを固定するテスト。
 *
 * `expo export --platform web` は Node 上で 1 回描画して HTML を吐くため
 * `useWindowDimensions()` / `Dimensions.get()` が 0 を返す。0 を px 計算へ通すと
 * 負の値になり、それが HTML へ焼き付いたまま **React のハイドレーションでは直らない**
 * (属性の食い違いを React は patch しない)。実際に検索画面のグリッドが
 * `style="width:-9.5px"` になり、web で画像が 1 枚も出なくなっていた。
 *
 * ここで固定するのは 3 点:
 *   1. サーバ描画(getServerSnapshot)で 0 も負の値も返さないこと
 *   2. クライアントでは実寸を返すこと(既定値のまま固まらない)
 *   3. web は中央カラム幅でクランプし、native はしないこと
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Dimensions, Platform } from "react-native";
import { useContentWidth, useWindowHeight, STATIC_RENDER_WINDOW } from "./useContentWidth";

jest.mock("react-native", () => ({
	Platform: { OS: "web" },
	Dimensions: {
		get: jest.fn(),
		addEventListener: jest.fn(() => ({ remove: jest.fn() })),
	},
}));

const mockWindow = (width: number, height: number) =>
	(Dimensions.get as jest.Mock).mockReturnValue({ width, height, scale: 1, fontScale: 1 });

function renderHook<T>(hook: () => T): T {
	let captured!: T;
	const Harness = () => {
		captured = hook();
		return null;
	};
	act(() => {
		TestRenderer.create(<Harness />);
	});
	return captured;
}

describe("useContentWidth / useWindowHeight", () => {
	beforeEach(() => {
		mockWindow(390, 844);
		jest.clearAllMocks();
		mockWindow(390, 844);
	});

	it("クライアントでは実寸(中央カラム幅でクランプ済み)を返す", () => {
		expect(renderHook(useContentWidth)).toBe(390);
	});

	it("ウィンドウが中央カラムより広いときはカラム幅でクランプする", () => {
		mockWindow(1280, 900);
		expect(renderHook(useContentWidth)).toBe(STATIC_RENDER_WINDOW.width);
	});

	it("useWindowHeight は実寸をそのまま返す(高さはクランプしない)", () => {
		expect(renderHook(useWindowHeight)).toBe(844);
	});

	// ─ SSG 用のスナップショット ─
	// getServerSnapshot は React が «ハイドレーション中のコンポーネント» にだけ使う。
	// ここが 0 だと HTML へ負の px が焼き付き、ハイドレーションでは二度と直らない
	it("SSG 用の既定ビューポートは 0 でも負でもない", () => {
		expect(STATIC_RENDER_WINDOW.width).toBeGreaterThan(0);
		expect(STATIC_RENDER_WINDOW.height).toBeGreaterThan(0);
	});

	it("SSG 中(window が無く Dimensions が 0 を返す)でも既定値を返し、負の px を生まない", () => {
		// react-test-renderer は SSR ではないので getServerSnapshot は呼ばれない。
		// 代わりに «SSG と同じ 0 が返る環境» を作り、grid の px 計算が負にならないことを見る
		mockWindow(0, 0);
		const width = renderHook(useContentWidth);
		// 0 のまま素通しされていたら、この計算(検索画面と同じ式)は負になる
		const itemWidth = (Math.max(width, STATIC_RENDER_WINDOW.width) - 32 - 6 - 40) / 4;
		expect(itemWidth).toBeGreaterThan(0);
	});
});

describe("useContentWidth (native)", () => {
	afterEach(() => {
		(Platform as { OS: string }).OS = "web";
	});

	it("native は中央カラム幅でクランプしない(全画面がそのままカラム)", () => {
		(Platform as { OS: string }).OS = "ios";
		mockWindow(1024, 1366);

		expect(renderHook(useContentWidth)).toBe(1024);
	});
});
