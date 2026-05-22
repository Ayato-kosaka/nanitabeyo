// web 版: crypto.randomUUID() が使えない環境（HTTP等）向けにフォールバックを提供
export function generateUUID(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	// RFC 4122 v4 UUID via getRandomValues（より広くサポートされている）
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	return [
		bytes.slice(0, 4),
		bytes.slice(4, 6),
		bytes.slice(6, 8),
		bytes.slice(8, 10),
		bytes.slice(10, 16),
	]
		.map((seg) => Array.from(seg).map((b) => b.toString(16).padStart(2, "0")).join(""))
		.join("-");
}
