import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  API_COMMIT_ID: z.string(),
  API_NODE_ENV: z.string(),
  API_GOOGLE_PLACE_API_KEY: z.string(),
});

function loadValidatedEnv(): z.infer<typeof envSchema> {
  const parsedEnv = envSchema.safeParse(process.env);

  if (!parsedEnv.success) {
    console.error("❌ Failed to validate environment variables:");
    console.table(parsedEnv.error.flatten().fieldErrors);
    throw new Error(
      "Invalid environment variables. Please check your .env file or runtime environment."
    );
  }

  return parsedEnv.data;
}

export const env = loadValidatedEnv();

