import { v4 as uuidv4 } from "uuid";
import { supabase } from "./supabase";
import { Env } from "@/constants/Env";
import type { DeepNonNullable } from "@shared/utils/types";
import type { SupabaseReactions } from "@shared/converters/convert_reactions";

export type ReactionInput = DeepNonNullable<
	Omit<SupabaseReactions, "id" | "user_id" | "created_at" | "created_version" | "lock_no">
>;

export const insertReaction = async ({ target_type, target_id, action_type }: ReactionInput) => {
	const { data } = await supabase.auth.getSession();
	const userId = data.session?.user.id;
	if (!userId) throw new Error("No authenticated user");

	const { error } = await supabase.from("reactions").insert({
		id: uuidv4(),
		user_id: userId,
		target_type,
		target_id,
		action_type,
		created_at: new Date().toISOString(),
		created_version: Env.APP_VERSION,
		lock_no: 0,
	});

	if (error) throw new Error(error.message);
};

export const deleteReaction = async ({ target_type, target_id, action_type }: ReactionInput) => {
	const { data } = await supabase.auth.getSession();
	const userId = data.session?.user.id;
	if (!userId) throw new Error("No authenticated user");

	const { error } = await supabase
		.from("reactions")
		.delete()
		.eq("user_id", userId)
		.eq("target_type", target_type)
		.eq("target_id", target_id)
		.eq("action_type", action_type);

	if (error) throw new Error(error.message);
};

export const toggleReaction = async ({ willReact, ...input }: ReactionInput & { willReact: boolean }) => {
	if (willReact) {
		await insertReaction(input);
	} else {
		await deleteReaction(input);
	}
};
