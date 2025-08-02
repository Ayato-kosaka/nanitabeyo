import React from "react";
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
	return <MapViewRN ref={ref} provider={PROVIDER_GOOGLE} {...props} />;
});

export const Marker = RNMarker;
export default MapView;
