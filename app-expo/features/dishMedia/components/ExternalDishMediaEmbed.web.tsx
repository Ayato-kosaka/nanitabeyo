import React, { useMemo } from "react";
import { buildExternalEmbedDocument, type ExternalDishMediaEmbedProps } from "./externalEmbed";

/** Web: srcDoc + sandboxで、アプリDOMと別originのiframeへ隔離する。 */
export const ExternalDishMediaEmbed = ({ embed, isActive }: ExternalDishMediaEmbedProps) => {
	const srcDoc = useMemo(() => buildExternalEmbedDocument(embed), [embed]);
	return React.createElement("iframe", {
		title: `${embed.provider} external dish media`,
		srcDoc,
		// srcDocは親originを継承し得るため allow-same-origin を付けない。
		// scriptを許可してもopaque originに閉じ込め、アプリDOMへ触れさせない。
		sandbox: "allow-scripts",
		allow: isActive ? "autoplay; encrypted-media; picture-in-picture" : "encrypted-media; picture-in-picture",
		referrerPolicy: "strict-origin-when-cross-origin",
		style: {
			position: "absolute",
			inset: 0,
			width: "100%",
			height: "100%",
			border: 0,
			background: "#000",
			pointerEvents: isActive ? "auto" : "none",
		},
	});
};
