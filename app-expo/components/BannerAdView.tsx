import React from "react";
import { Platform } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";

import { Env } from "@/constants/Env";

export const BannerAdView = () => {
	const adUnitID: string = Platform.select<string>({
		ios: Env.ADMOB_ANDROID_BANNER_UNIT_ID,
		android: Env.ADMOB_IOS_BANNER_UNIT_ID,
	})!;
	return (
		<BannerAd
			unitId={adUnitID}
			size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
			requestOptions={{
				requestNonPersonalizedAdsOnly: true,
			}}
		/>
	);
};
