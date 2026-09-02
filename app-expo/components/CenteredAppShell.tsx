import { ReactNode } from "react";

// #958 【設計】native は画面幅そのものが既に妥当なカラム幅のため何もしない(no-op)。
// web 側の実装は CenteredAppShell.web.tsx を参照
export function CenteredAppShell({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
