import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";
import { Env } from "@/constants/Env";

/**
 * Insert impression record to dish_media_impressions table
 * This is done directly through Supabase since it needs to happen immediately
 * and the backend API is for view tracking
 */
export const insertDishMediaImpression = async ({
	dish_media_id,
	session_id,
	source,
}: {
	dish_media_id: string;
	session_id?: string;
	source?: string;
}): Promise<string | null> => {
	try {
		const { data: sessionData } = await supabase.auth.getSession();
		const userId = sessionData.session?.user.id || null;

		const { data, error } = await supabase
			.from("dish_media_impressions")
			.insert({
				id: Crypto.randomUUID(),
				dish_media_id,
				user_id: userId,
				session_id: session_id || null,
				source: source || null,
				created_at: new Date().toISOString(),
			})
			.select("id")
			.single();

		if (error) {
			console.error("Failed to insert impression:", error);
			return null;
		}

		return data?.id || null;
	} catch (error) {
		console.error("Exception inserting impression:", error);
		return null;
	}
};

/**
 * Send view completion data to backend API
 * This updates dish_media_views and dish_media_analysis_results
 */
export const sendDishMediaView = async ({
	impression_id,
	dish_media_id,
	watch_ms,
	is_completed,
	is_skipped,
	rewatch_count,
	started_at,
}: {
	impression_id?: string | null;
	dish_media_id: string;
	watch_ms: number;
	is_completed: boolean;
	is_skipped: boolean;
	rewatch_count: number;
	started_at?: string;
}): Promise<boolean> => {
	try {
		const { data: sessionData } = await supabase.auth.getSession();
		const accessToken = sessionData.session?.access_token;
		const userId = sessionData.session?.user.id || null;

		const endpoint = `${Env.BACKEND_BASE_URL}/v1/dish-media/view`;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"x-app-version": Env.APP_VERSION,
		};

		// Add auth header if available
		if (accessToken) {
			headers["Authorization"] = `Bearer ${accessToken}`;
		}

		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify({
				impression_id: impression_id || null,
				dish_media_id,
				user_id: userId,
				started_at: started_at || new Date().toISOString(),
				watch_ms,
				is_completed,
				is_skipped,
				rewatch_count,
			}),
		});

		if (!response.ok) {
			console.error(`Failed to send view: ${response.status}`);
			return false;
		}

		return true;
	} catch (error) {
		console.error("Exception sending view:", error);
		return false;
	}
};
