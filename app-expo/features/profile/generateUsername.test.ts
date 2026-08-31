import { generateUsername, USERNAME_RANDOM_DIGITS } from "./generateUsername";

/**
 * #1599 自動採番する username の衝突耐性。
 *
 * `users.username` には UNIQUE (`uq_users_username`) が張ってある。以前の実装は
 * `Date.now() + Math.floor(Math.random() * 1000)` で、乱数がタイムスタンプへ
 * **足し込まれていた**ため、同じ 1 秒のあいだのサインアップが現実的な確率で衝突した。
 */
describe("#1599 generateUsername", () => {
	it("user + 数字のみ（citext の大小無視とぶつからない形）", () => {
		expect(generateUsername(1756166400000, () => 0.123456)).toMatch(/^user\d+$/);
	});

	it("タイムスタンプと乱数を連結する（足さない）", () => {
		// 足していると桁が繰り上がって混ざり、タイムスタンプがそのまま読めなくなる
		const username = generateUsername(1756166400000, () => 0.5);
		expect(username).toBe(`user1756166400000${"500000".padStart(USERNAME_RANDOM_DIGITS, "0")}`);
		expect(username.startsWith("user1756166400000")).toBe(true);
	});

	it("乱数が 0 でも桁を落とさない（ゼロ埋め）", () => {
		expect(generateUsername(1756166400000, () => 0)).toBe("user1756166400000000000");
	});

	it("乱数が上限直前でも桁あふれしない", () => {
		expect(generateUsername(1756166400000, () => 0.9999999)).toBe("user1756166400000999999");
	});

	it("同じミリ秒でも、乱数が違えば別の名前になる", () => {
		const at = 1756166400000;
		expect(generateUsername(at, () => 0.111111)).not.toBe(generateUsername(at, () => 0.222222));
	});

	it("【回帰】同じ 1 秒のあいだに 2000 人が登録しても衝突しない", () => {
		// 旧実装（timestamp + rand[0..999]）はこの条件で必ず衝突していた。
		// 1 秒 = 1000 ミリ秒に 2000 件なので、鳩の巣原理でタイムスタンプは必ず重なる。
		let seed = 1;
		const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

		const names = new Set<string>();
		for (let i = 0; i < 2000; i++) {
			names.add(generateUsername(1756166400000 + (i % 1000), rnd));
		}

		expect(names.size).toBe(2000);
	});

	it("既定の引数でも user + 数字になる（Date.now / Math.random を差し替えない経路）", () => {
		expect(generateUsername()).toMatch(/^user\d+$/);
	});
});
