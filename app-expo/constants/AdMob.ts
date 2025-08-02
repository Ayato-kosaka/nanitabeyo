import { Platform } from "react-native";
import { Env } from "./Env";

/**
 * 📱 Interstitial 広告ユニットIDを環境とプラットフォームから取得
 */
export const getAdMobInterstitialUnitId = (): string => {
	return Platform.OS === "ios" ? Env.ADMOB_IOS_INTERSTITIAL_UNIT_ID : Env.ADMOB_ANDROID_INTERSTITIAL_UNIT_ID;
};
