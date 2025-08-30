import React, { useMemo } from "react";
import { View, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { X } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import FoodContentMap from "@/components/FoodContentMap";
import { Env } from "@/constants/Env";
import type { BaseResponse, QueryDishMediaByIdsResponse } from "@shared/api/v1/res";

export default function PostsScreen() {
  const { ids } = useLocalSearchParams<{ ids?: string | string[] }>();

  const dishesPromise = useMemo(() => {
    const idArray =
      typeof ids === "string" ? ids.split(",") : Array.isArray(ids) ? ids.flatMap((v) => v.split(",")) : [];
    const params = new URLSearchParams();
    idArray.forEach((id) => params.append("ids", id));
    return fetch(`${Env.BACKEND_BASE_URL}/v1/dish-media?${params.toString()}`)
      .then((res) => res.json() as Promise<BaseResponse<QueryDishMediaByIdsResponse>>)
      .then((json) => json.data.items);
  }, [ids]);

  const handleClose = () => router.back();

  return (
    <LinearGradient colors={["#FFFFFF", "#F8F9FA"]} style={styles.container}>
      <View style={{ ...styles.closeButtonContainer, top: Platform.OS === "ios" ? 40 : 0 }}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <X size={24} color="#000" />
        </TouchableOpacity>
      </View>
      <FoodContentMap itemsPromise={dishesPromise} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  closeButtonContainer: {
    position: "absolute",
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    zIndex: 10,
  },
  closeButton: {
    padding: 8,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
});
