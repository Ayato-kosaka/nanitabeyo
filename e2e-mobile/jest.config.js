// #1027 【設計】Detox 公式の jest ランナー構成（globalSetup/testEnvironment が device 等を初期化する）
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	rootDir: ".",
	testMatch: ["<rootDir>/tests/**/*.test.ts"],
	// #1027 【設計】E2E は実機相当の起動・ネットワークを待つため単体テストより大幅に長くする
	testTimeout: 300000,
	// #1027 【設計】1 台のエミュレータを全テストで共有するため並列化しない
	maxWorkers: 1,
	globalSetup: "detox/runners/jest/globalSetup",
	globalTeardown: "detox/runners/jest/globalTeardown",
	reporters: ["detox/runners/jest/reporter"],
	testEnvironment: "detox/runners/jest/testEnvironment",
	verbose: true,
	transform: {
		"^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
	},
};
