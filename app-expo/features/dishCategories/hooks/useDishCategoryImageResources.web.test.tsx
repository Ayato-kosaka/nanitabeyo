// #1213 【回帰】web の先読みが「URL を確定するだけ」で実体を取りに行かなかった問題の固定テスト。
//
// useDishCategoryImageResources の web 分岐は、Blob を作らないために ready へ即座に進み、
// 実体の取得は表示側の <img> に任せる設計だった（#719/#929）。
// DishCategories 検索画面はカルーセルとサムネイルで全件を同時に描くので、それでも «全件が取得済み» に
// なっていたが、カードを **1 枚ずつしか描かない** 友達投票の投票画面では
// 先読みが一切効かず、候補を送るたびにカード背景色(#EEE)のグレーが取得完了まで見えていた
// （実測: 画像応答を 1200ms 遅らせた web ビルドで、切り替えごとに最大 1320ms のグレー）。
//
// 修正は「ready の意味も描画経路も変えず、ブラウザキャッシュへ実体だけ先に載せる」というもの。
// このテストは **web 分岐が候補全件ぶんの取得を開始すること** を固定する。
// （ブラウザキャッシュに実際に載るかどうかは e2e-web の
//   tests/dish-category-group-votes/vote-candidate-image-preload.spec.ts が担保する）
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { Platform } from "react-native";
import type { DishCategoryRecommendation } from "@/types/search";

jest.mock("expo-image", () => ({
	Image: {
		// web 分岐では呼ばれてはいけない（呼ばれたら Blob を作る旧経路へ戻っている）
		loadAsync: jest.fn(),
	},
}));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));

import { Image as ExpoImage } from "expo-image";
import { useDishCategoryImageResources } from "./useDishCategoryImageResources";

/** src へ代入された URL を記録するだけの HTMLImageElement 代役 */
class FakeBrowserImage {
	static requested: string[] = [];
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	decoding = "auto";
	set src(value: string) {
		FakeBrowserImage.requested.push(value);
	}
}

const DISH_CATEGORIES: DishCategoryRecommendation[] = [0, 1, 2].map((index) => ({
	category: `cat-${index}`,
	categoryId: `cat-${index}`,
	title: `title-${index}`,
	reason: `reason-${index}`,
	imageUrl: `https://images.example.invalid/candidate-${index}.svg`,
}));

function Probe({ dishCategories }: { dishCategories: DishCategoryRecommendation[] }) {
	useDishCategoryImageResources({ dishCategories, sessionKey: "session-1213" });
	return null;
}

describe("useDishCategoryImageResources（web）", () => {
	let originalPlatformOS: string;
	let originalWindowImage: unknown;

	beforeAll(() => {
		originalPlatformOS = Platform.OS;
		// Platform.OS は素のプロパティなので差し替えで web 分岐へ入れる
		Object.defineProperty(Platform, "OS", { configurable: true, get: () => "web" });
		const globalWindow = (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {};
		(globalThis as unknown as { window?: Record<string, unknown> }).window = globalWindow;
		originalWindowImage = globalWindow.Image;
		globalWindow.Image = FakeBrowserImage;
	});

	afterAll(() => {
		Object.defineProperty(Platform, "OS", { configurable: true, get: () => originalPlatformOS });
		const globalWindow = (globalThis as unknown as { window?: Record<string, unknown> }).window;
		if (globalWindow) globalWindow.Image = originalWindowImage;
	});

	beforeEach(() => {
		FakeBrowserImage.requested = [];
	});

	// ─ テストケース: マウント時に候補「全件」の取得が始まる ─
	// 手順:
	//   1. 候補 3 件で hook をマウントする
	//   2. src へ代入された URL を全件ぶん記録できていることを検証する
	// 補足: 修正前はここが 0 件になる（ready にするだけで取得を始めていなかった）。
	//       «表示中の 1 枚だけ» に縮む回帰も 1 件になって落ちる
	it("マウント時に候補全件ぶんのブラウザ取得を開始する", () => {
		act(() => {
			TestRenderer.create(<Probe dishCategories={DISH_CATEGORIES} />);
		});

		expect(FakeBrowserImage.requested).toEqual(DISH_CATEGORIES.map((dishCategory) => dishCategory.imageUrl));
	});

	// ─ テストケース: web では native の loadAsync 経路へ入らない ─
	// 手順:
	//   1. 同じくマウントする
	//   2. expo-image の loadAsync が呼ばれていないことを検証する
	// 補足: #719/#929 の「web で loadAsync を使うと解放不能な Blob を生む」判断を固定する。
	//       先読みを足したついでにここを native と同じ経路へ寄せてしまう回帰を防ぐ
	it("web では expo-image の loadAsync を使わない", () => {
		act(() => {
			TestRenderer.create(<Probe dishCategories={DISH_CATEGORIES} />);
		});

		expect(ExpoImage.loadAsync).not.toHaveBeenCalled();
	});

	// ─ テストケース: 同じ候補を二重に取りに行かない ─
	// 手順:
	//   1. マウント後、同じ dishCategories で再描画させる
	//   2. 取得要求が増えていないことを検証する
	// 補足: loadDishCategoryImage は loading / ready の候補を弾く。ここが壊れると
	//       再描画のたびにリクエストが積み上がる
	it("再描画しても同じ候補を取り直さない", () => {
		let renderer!: TestRenderer.ReactTestRenderer;
		act(() => {
			renderer = TestRenderer.create(<Probe dishCategories={DISH_CATEGORIES} />);
		});
		const afterMount = [...FakeBrowserImage.requested];

		act(() => {
			renderer.update(<Probe dishCategories={DISH_CATEGORIES} />);
		});

		expect(FakeBrowserImage.requested).toEqual(afterMount);
	});
});
