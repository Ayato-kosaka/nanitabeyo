import React from "react";
import { Platform } from "react-native";
import MapViewRN, { Marker as RNMarker, PROVIDER_GOOGLE } from "react-native-maps";
import type { MapViewProps as RNMapViewProps, MapMarkerProps as RNMarkerProps, Region } from "react-native-maps";

export interface MapViewProps extends RNMapViewProps {
	/**
	 * Language code for Google Maps labels.
	 * Web only; ignored on native platforms.
	 */
	language?: string;
}
export type MarkerProps = RNMarkerProps;
export type { Region };

const MapView = React.forwardRef<MapViewRN, MapViewProps>(({ language, ...props }, ref) => {
	// #362 MapView の POI 表示を「飲食系のみに制限」する
	const googleMapId = Platform.OS === "ios" ? "4e9ea5ba5d0c3d10219940cd" : "4e9ea5ba5d0c3d10b89b2316";
	return <MapViewRN ref={ref} provider={PROVIDER_GOOGLE} googleMapId={googleMapId} {...props} />;
});

export const Marker = RNMarker;
export default MapView;
