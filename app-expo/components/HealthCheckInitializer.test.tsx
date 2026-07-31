import { act } from "react";
import TestRenderer from "react-test-renderer";
import type { User } from "@supabase/supabase-js";
import { HealthCheckInitializer } from "./HealthCheckInitializer";
import type { ApiError } from "@/hooks/useAPICall";

/**
 * #1092 C2 の感度テスト: **トークンが無くて失敗したヘルスチェックは「完了」ではない**。
 *
 * 起動時のヘルスチェックは、失敗しても必ず `hasCompleted: true` を確定させ、その起動では
 * 二度と走らなかった。ヘルスチェックは **メンテナンスモード(503) と強制アップデート(426) を
 * アプリが知る唯一の経路**（フロントは Remote Config の `is_maintenance` /
 * `minimum_supported_version` を読んでいない）なので、認証の確立より先に走って失敗すると、
 * その起動では 503/426 の検知が丸ごとスキップされる。#1092 の中で最も重い副作用。
 *
 * ここでは「トークンが無いだけの失敗なら auth 解決後に 1 回だけ叩き直す」ことと、
 * 「それ以外の失敗では再試行しない（無限に叩かない）」ことの両方を固定する。
 */

/** 現在の user。null = 認証がまだ確立していない */
let mockUser: Pick<User, "id"> | null = null;
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: mockUser }),
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
}));
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});

const unauthenticatedError: ApiError = {
	code: "unauthenticated",
	message: "User is not authenticated: Supabase access_token is missing (endpoint: health).",
};

const networkError: ApiError = { code: "network_error", status: 0, message: "Network error while calling health" };

describe("#1092 HealthCheckInitializer は auth 未確定での失敗を「完了」にしない", () => {
	/** マウント〜再レンダリングを操作するためのレンダラ */
	let renderer: TestRenderer.ReactTestRenderer;

	const mount = async () => {
		await act(async () => {
			renderer = TestRenderer.create(
				<HealthCheckInitializer>
					<></>
				</HealthCheckInitializer>,
			);
		});
	};

	/** 起動時の 100ms ディレイを消化する */
	const runStartupDelay = async () => {
		await act(async () => {
			jest.advanceTimersByTime(100);
		});
	};

	/** 匿名サインインが後から成功した状況を作る（user が入り、再レンダリングされる） */
	const resolveAuth = async (userId: string) => {
		mockUser = { id: userId };
		await act(async () => {
			renderer.update(
				<HealthCheckInitializer>
					<></>
				</HealthCheckInitializer>,
			);
		});
	};

	beforeEach(() => {
		jest.useFakeTimers();
		(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		mockUser = null;
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("トークンが無くて失敗したら、auth の解決で 1 回だけ叩き直す", async () => {
		mockCallBackend.mockRejectedValueOnce(unauthenticatedError).mockResolvedValueOnce({ status: "ok" });

		await mount();
		await runStartupDelay();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		// ここで再試行されないと、この起動ではメンテナンスモード(503)も強制アップデート(426)も検知されない
		await resolveAuth("anon-1");
		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).toHaveBeenLastCalledWith("health", { method: "GET", requestPayload: {} });
	});

	it("再試行が成功した後は、user が変わっても叩き直さない", async () => {
		mockCallBackend.mockRejectedValueOnce(unauthenticatedError).mockResolvedValueOnce({ status: "ok" });

		await mount();
		await runStartupDelay();
		await resolveAuth("anon-1");
		expect(mockCallBackend).toHaveBeenCalledTimes(2);

		await resolveAuth("user-1");
		expect(mockCallBackend).toHaveBeenCalledTimes(2);
	});

	it("トークン以外の理由（ネットワーク断など）で失敗したときは再試行しない", async () => {
		// 認証は確立済みだが通信が死んでいる状況。ここで再試行を足すと、
		// user が変わるたびにヘルスチェックが増えるだけで直らない
		mockUser = { id: "anon-1" };
		mockCallBackend.mockRejectedValue(networkError);

		await mount();
		await runStartupDelay();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await resolveAuth("user-1");
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
	});

	it("トークンが無いまま auth が解決しなければ（user が入らなければ）叩き直さない", async () => {
		mockCallBackend.mockRejectedValue(unauthenticatedError);

		await mount();
		await runStartupDelay();
		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		// 認証が失敗し続けている間は、叩いてもトークンが無いので意味がない
		await act(async () => {
			jest.advanceTimersByTime(60_000);
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
	});
});
