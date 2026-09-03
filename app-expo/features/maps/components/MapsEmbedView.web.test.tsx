/*
#843 web 側（iframe）。fetch の事前チェックで 503（キー未設定）等を検知し、
fallback（従来の外部ブラウザ導線）へ縮退することを固定する。
iframe の `onError` は HTTP エラーステータスを拾えないため、web だけ fetch で確かめる
（`MapsEmbedView.web.tsx` のヘッダ参照）。
*/
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MapsEmbedView } from "./MapsEmbedView.web";

const URL = "https://api.example.com/v1/maps/embed?mode=search&q=ramen";

describe("MapsEmbedView（web, iframe）", () => {
	afterEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		delete (global as any).fetch;
	});

	it("fetch が成功すれば iframe を描く", async () => {
		global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

		let tree!: ReactTestRenderer;
		await act(async () => {
			tree = create(<MapsEmbedView url={URL} testID="maps-view" fallback={<Text testID="fb">fallback</Text>} />);
			await Promise.resolve();
		});

		expect(tree.root.findAllByType("iframe" as never).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "fb" }).length).toBe(0);
	});

	it("fetch が 503 等（!ok）なら fallback を描く（iframe は作らない）", async () => {
		global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

		let tree!: ReactTestRenderer;
		await act(async () => {
			tree = create(<MapsEmbedView url={URL} testID="maps-view" fallback={<Text testID="fb">fallback</Text>} />);
			await Promise.resolve();
		});

		expect(tree.root.findAllByType("iframe" as never).length).toBe(0);
		expect(tree.root.findAllByProps({ testID: "fb" }).length).toBeGreaterThan(0);
	});

	it("fetch 自体が失敗（ネットワーク断）しても fallback を描く", async () => {
		global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

		let tree!: ReactTestRenderer;
		await act(async () => {
			tree = create(<MapsEmbedView url={URL} testID="maps-view" fallback={<Text testID="fb">fallback</Text>} />);
			await Promise.resolve();
		});

		expect(tree.root.findAllByType("iframe" as never).length).toBe(0);
		expect(tree.root.findAllByProps({ testID: "fb" }).length).toBeGreaterThan(0);
	});
});
