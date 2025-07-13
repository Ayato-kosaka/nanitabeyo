import { z } from "zod";

export const remoteConfigSchema = z.object({
	is_maintenance: z.string(),
	minimum_supported_version: z.string(),
});

export type RemoteConfigValues = z.infer<typeof remoteConfigSchema>;
