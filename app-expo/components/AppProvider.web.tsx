import { ReactNode } from "react";
import { MapsLoaderProvider } from "@/contexts/MapsLoaderContext";

export const AppProvider = ({ children }: { children: ReactNode }) => {
	return <MapsLoaderProvider>{children}</MapsLoaderProvider>;
};
