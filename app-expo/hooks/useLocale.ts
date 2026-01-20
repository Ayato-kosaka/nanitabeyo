import { usePathname } from "expo-router";
import { useMemo } from "react";

export const useLocale = () => {
	const pathname = usePathname();

	const pathnameSegments = pathname.split("/");
	const locale = pathnameSegments[1];
	const isJapanese = useMemo(() => ["ja-JP", "ja"].includes(locale), [locale]);

	return { locale, isJapanese };
};
