import { LoadScript } from "@react-google-maps/api";
import { ReactNode } from "react";
import { Env } from "@/constants/Env";

export const AppProvider = ({ children }: { children: ReactNode }) => (
	<LoadScript
		googleMapsApiKey={Env.GOOGLE_MAPS_WEB_API_KEY}
		// language={language}
	>
		{children}
	</LoadScript>
);
