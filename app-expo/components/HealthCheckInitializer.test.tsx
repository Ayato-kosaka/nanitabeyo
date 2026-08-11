import { act } from "react";
import TestRenderer from "react-test-renderer";
import type { User } from "@supabase/supabase-js";
import { HealthCheckInitializer, resolveHealthCheckErrorLevel } from "./HealthCheckInitializer";
import { useLogger } from "@/hooks/useLogger";
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

/** 30 秒待っても応答が返らなかった（useAPICall の AbortController によるタイムアウト） */
const timeoutError: ApiError = {
	code: "network_error",
	status: 0,
	message: "Network timeout (30000ms) while calling health",
};

/** メンテナンスモード。このコンポーネントが存在する理由そのもの */
const maintenanceError: ApiError = {
	code: "maintenance_mode",
	status: 503,
	message: "API call to health failed with status 503",
};

/** 強制アップデート。同上 */
const unsupportedVersionError: ApiError = {
	code: "unsupported_version",
	status: 426,
	message: "API call to health failed with status 426",
};

/** サーバーには届いた上での 4xx。クライアント側の契約違反なので握り潰してはいけない */
const badRequestError: ApiError = {
	code: "http_error",
	status: 400,
	message: "API call to health failed with status 400",
};

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

/**
 * #1234 health_check_error のログレベルの感度テスト。
 *
 * 回線起因（レスポンスが 1 度も返らなかった失敗）を error で記録していたため、error-triage が
 * 毎日 Issue を起票していた。同じ失敗でも `api_call_error` 側は SQL の除外ルール E3
 * `client_network`（status = 0）で既に落ちており、イベント名の違いだけで扱いが割れていた。
 *
 * 直し方として「health_check_error を丸ごと warn にする」のが一番簡単だが、**それは絶対にやらない**。
 * このコンポーネントはメンテナンスモード(503) と強制アップデート(426) をアプリが知る唯一の経路で、
 * その 2 つが壊れたことに気付ける手段が error ログしか無い（#1092 参照）。
 * 下の it.each は「一律 warn 化していない」を固定するためのもので、
 * resolveHealthCheckErrorLevel が常に warn を返すようになると赤くなる。
 */
describe("#1234 ヘルスチェック失敗のログレベル", () => {
	describe("resolveHealthCheckErrorLevel", () => {
		it.each([
			["応答が返らないネットワーク断", networkError, "warn"],
			["30秒タイムアウト", timeoutError, "warn"],
		])("%s は warn（サーバーに届いていないのでサーバー起因ではない）", (_name, error, expected) => {
			expect(resolveHealthCheckErrorLevel(error)).toBe(expected);
		});

		it.each([
			["メンテナンスモード(503)", maintenanceError],
			["強制アップデート(426)", unsupportedVersionError],
			["サーバーに届いた上での 400", badRequestError],
			["トークン未確立(unauthenticated)", unauthenticatedError],
		])("%s は error のまま", (_name, error) => {
			expect(resolveHealthCheckErrorLevel(error)).toBe("error");
		});

		it("code だけ network_error でも HTTP ステータスを持つなら error のまま", () => {
			// 「レスポンスが返ってこなかった」の判定はステータスの有無で行う。
			// code だけで warn にすると、将来 status 付きで network_error を投げた経路が黙る
			expect(resolveHealthCheckErrorLevel({ code: "network_error", status: 503, message: "" })).toBe("error");
		});

		it("素の Error（ApiError ではない想定外の例外）は error のまま", () => {
			expect(resolveHealthCheckErrorLevel(new Error("boom"))).toBe("error");
			expect(resolveHealthCheckErrorLevel(undefined)).toBe("error");
		});
	});

	describe("コンポーネントが実際に出すログ", () => {
		const logFrontendEvent = useLogger().logFrontendEvent as unknown as jest.Mock;

		const mountAndFail = async (error: ApiError) => {
			mockCallBackend.mockRejectedValue(error);
			await act(async () => {
				TestRenderer.create(
					<HealthCheckInitializer>
						<></>
					</HealthCheckInitializer>,
				);
			});
			await act(async () => {
				jest.advanceTimersByTime(100);
			});
			return logFrontendEvent.mock.calls
				.map(([event]) => event)
				.filter((event) => event.event_name === "health_check_error");
		};

		beforeEach(() => {
			jest.useFakeTimers();
			(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
			// 認証は確立済み。ここで null にすると unauthenticated の再試行経路が混ざる
			mockUser = { id: "anon-1" };
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it("ネットワーク断は warn で記録する（error-triage の起票対象から外す）", async () => {
			const events = await mountAndFail(networkError);
			expect(events).toHaveLength(1);
			expect(events[0].error_level).toBe("warn");
			// レベルを下げても調査に必要な情報は落とさない
			expect(events[0].payload.code).toBe("network_error");
			expect(events[0].payload.status).toBe(0);
		});

		it("メンテナンスモード(503)は error で記録する", async () => {
			const events = await mountAndFail(maintenanceError);
			expect(events).toHaveLength(1);
			expect(events[0].error_level).toBe("error");
		});

		it("強制アップデート(426)は error で記録する", async () => {
			const events = await mountAndFail(unsupportedVersionError);
			expect(events).toHaveLength(1);
			expect(events[0].error_level).toBe("error");
		});

		it("トークン未確立は error のまま（SQL 側の E2 unauthenticated_race で除外済みのため触らない）", async () => {
			const events = await mountAndFail(unauthenticatedError);
			expect(events).toHaveLength(1);
			expect(events[0].error_level).toBe("error");
			expect(events[0].payload.code).toBe("unauthenticated");
		});
	});
});
