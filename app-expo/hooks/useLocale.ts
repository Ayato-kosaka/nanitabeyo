import { usePathname } from "expo-router";

export const useLocale = (): string => {
	const pathname = usePathname();

	const pathnameSegments = pathname.split("/");
	const locale = pathnameSegments[1];

	return locale;
};
