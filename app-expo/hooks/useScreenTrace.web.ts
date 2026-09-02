/**
 * #1016 【設計】native版(useScreenTrace.ts)のWeb実装。
 * Web は web-vitals による RUM(#957)で計測基盤が完結済みのため、
 * Firebase Performance Monitoring(native専用SDK)は使わずno-opにする。
 * 呼び出し側のimport解決・typecheck・buildを妨げないためだけにシグネチャを揃えている。
 */
export function useScreenTrace(_screenName: string): void {
	// no-op
}
