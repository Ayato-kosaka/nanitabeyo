import { Dimensions } from "react-native";

// Obtain device dimensions to calculate card size
const { width, height } = Dimensions.get("window");

// Width of each topic card within the carousel
export const CARD_WIDTH = width - 32;
// Height of each topic card within the carousel
export const CARD_HEIGHT = height * 0.85;

export { width, height };
