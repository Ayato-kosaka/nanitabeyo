/*
責務:
- ログイン UI（LoginForm）を BlurModal の中身として描くだけの薄いラッパ。

#1359 【設計】ログイン UI の実体は features/auth/components/LoginForm.tsx へ移した。
このファイルを残しているのは、呼び出し 4 箇所（ProfileTabsLayout / features/map の
SelectedRestaurantDetails / features/review の SelectedRestaurantDetails / (tabs)/review）の
import と testID を «この PR では一切変えない» ためで、振る舞いは移設前と同一である。

呼び出し側を `router.push("/[locale]/auth/login")` へ切り替えるのは次の PR で、
そのときにこのファイルごと消える。新しい実装をここへ足さないこと。
*/
import React from "react";
import { LoginForm } from "@/features/auth/components/LoginForm";

interface LoginbackModalProps {
	onClose: () => void;
}

export function LoginbackModal({ onClose }: LoginbackModalProps) {
	// testID はモーダル時代のまま。E2E（e2e-web の login-modal 可視判定）が依存している
	return <LoginForm testID="login-modal" onClose={onClose} />;
}
