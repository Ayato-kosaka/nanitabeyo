import * as Crypto from "expo-crypto";

export function generateUUID(): string {
	return Crypto.randomUUID();
}
