// Utility helpers for bid status presentation
export const getBidStatusColor = (status: string): string => {
        switch (status) {
                case "active":
                        return "#4CAF50";
                case "completed":
                        return "#2196F3";
                case "refunded":
                        return "#FF9800";
                default:
                        return "#666";
        }
};

export const getBidStatusText = (status: string): string => {
        switch (status) {
                case "active":
                        return "アクティブ";
                case "completed":
                        return "完了";
                case "refunded":
                        return "返金済み";
                default:
                        return status;
        }
};
