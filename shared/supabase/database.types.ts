export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  dev: {
    Tables: {
      backend_event_logs: {
        Row: {
          created_at: string
          created_commit_id: string
          error_level:
            | Database["dev"]["Enums"]["backend_event_logs_error_level"]
            | null
          event_name: string | null
          function_name: string | null
          id: string
          payload: Json | null
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at: string
          created_commit_id: string
          error_level?:
            | Database["dev"]["Enums"]["backend_event_logs_error_level"]
            | null
          event_name?: string | null
          function_name?: string | null
          id: string
          payload?: Json | null
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_commit_id?: string
          error_level?:
            | Database["dev"]["Enums"]["backend_event_logs_error_level"]
            | null
          event_name?: string | null
          function_name?: string | null
          id?: string
          payload?: Json | null
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      config: {
        Row: {
          description: string | null
          key: string
          value: string
        }
        Insert: {
          description?: string | null
          key: string
          value: string
        }
        Update: {
          description?: string | null
          key?: string
          value?: string
        }
        Relationships: []
      }
      dish_categories: {
        Row: {
          created_at: string
          cuisine: string[]
          id: string
          image_url: string
          label_en: string
          labels: Json
          lock_no: number
          origin: string[]
          tags: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          cuisine: string[]
          id: string
          image_url: string
          label_en: string
          labels: Json
          lock_no?: number
          origin: string[]
          tags: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          cuisine?: string[]
          id?: string
          image_url?: string
          label_en?: string
          labels?: Json
          lock_no?: number
          origin?: string[]
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      dish_category_variants: {
        Row: {
          created_at: string
          dish_category_id: string
          id: string
          source: string | null
          surface_form: string
        }
        Insert: {
          created_at?: string
          dish_category_id: string
          id?: string
          source?: string | null
          surface_form: string
        }
        Update: {
          created_at?: string
          dish_category_id?: string
          id?: string
          source?: string | null
          surface_form?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_category_variants_dish_category_id_fkey"
            columns: ["dish_category_id"]
            isOneToOne: false
            referencedRelation: "dish_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_likes: {
        Row: {
          created_at: string
          dish_media_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_media_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dish_media_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_likes_dish_media_id_fkey"
            columns: ["dish_media_id"]
            isOneToOne: false
            referencedRelation: "dish_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_media: {
        Row: {
          created_at: string
          dish_id: string
          id: string
          lock_no: number
          media_path: string
          media_type: string
          thumbnail_path: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          dish_id: string
          id?: string
          lock_no?: number
          media_path: string
          media_type: string
          thumbnail_path: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          dish_id?: string
          id?: string
          lock_no?: number
          media_path?: string
          media_type?: string
          thumbnail_path?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dish_media_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_media_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_reviews: {
        Row: {
          comment: string
          comment_tsv: unknown | null
          created_at: string
          created_dish_media_id: string
          currency_code: string | null
          dish_id: string
          id: string
          imported_user_avatar: string | null
          imported_user_name: string | null
          original_language_code: string
          price_cents: number | null
          rating: number
          user_id: string | null
        }
        Insert: {
          comment: string
          comment_tsv?: unknown | null
          created_at?: string
          created_dish_media_id: string
          currency_code?: string | null
          dish_id: string
          id?: string
          imported_user_avatar?: string | null
          imported_user_name?: string | null
          original_language_code: string
          price_cents?: number | null
          rating: number
          user_id?: string | null
        }
        Update: {
          comment?: string
          comment_tsv?: unknown | null
          created_at?: string
          created_dish_media_id?: string
          currency_code?: string | null
          dish_id?: string
          id?: string
          imported_user_avatar?: string | null
          imported_user_name?: string | null
          original_language_code?: string
          price_cents?: number | null
          rating?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dish_reviews_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dishes: {
        Row: {
          category_id: string
          created_at: string
          id: string
          lock_no: number
          name: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          lock_no?: number
          name?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          lock_no?: number
          name?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dishes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "dish_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dishes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      external_api_logs: {
        Row: {
          api_name: string | null
          created_at: string
          created_commit_id: string
          endpoint: string | null
          error_message: string | null
          function_name: string | null
          id: string
          method: string | null
          request_id: string | null
          request_payload: Json | null
          response_payload: Json | null
          response_time_ms: number | null
          status_code: number | null
          user_id: string | null
        }
        Insert: {
          api_name?: string | null
          created_at: string
          created_commit_id: string
          endpoint?: string | null
          error_message?: string | null
          function_name?: string | null
          id: string
          method?: string | null
          request_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          response_time_ms?: number | null
          status_code?: number | null
          user_id?: string | null
        }
        Update: {
          api_name?: string | null
          created_at?: string
          created_commit_id?: string
          endpoint?: string | null
          error_message?: string | null
          function_name?: string | null
          id?: string
          method?: string | null
          request_id?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          response_time_ms?: number | null
          status_code?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      frontend_event_logs: {
        Row: {
          created_app_version: string
          created_at: string
          created_commit_id: string
          error_level:
            | Database["dev"]["Enums"]["frontend_event_logs_error_level"]
            | null
          event_name: string | null
          id: string
          path_name: string | null
          payload: string | null
          user_id: string | null
        }
        Insert: {
          created_app_version: string
          created_at: string
          created_commit_id: string
          error_level?:
            | Database["dev"]["Enums"]["frontend_event_logs_error_level"]
            | null
          event_name?: string | null
          id: string
          path_name?: string | null
          payload?: string | null
          user_id?: string | null
        }
        Update: {
          created_app_version?: string
          created_at?: string
          created_commit_id?: string
          error_level?:
            | Database["dev"]["Enums"]["frontend_event_logs_error_level"]
            | null
          event_name?: string | null
          id?: string
          path_name?: string | null
          payload?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      payouts: {
        Row: {
          amount_cents: number
          bid_id: string
          created_at: string
          currency_code: string | null
          dish_media_id: string
          id: string
          lock_no: number
          status: Database["dev"]["Enums"]["payout_status"]
          transfer_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          bid_id: string
          created_at?: string
          currency_code?: string | null
          dish_media_id: string
          id?: string
          lock_no?: number
          status: Database["dev"]["Enums"]["payout_status"]
          transfer_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          bid_id?: string
          created_at?: string
          currency_code?: string | null
          dish_media_id?: string
          id?: string
          lock_no?: number
          status?: Database["dev"]["Enums"]["payout_status"]
          transfer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "restaurant_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_dish_media_id_fkey"
            columns: ["dish_media_id"]
            isOneToOne: false
            referencedRelation: "dish_media"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_families: {
        Row: {
          description: string
          id: string
          name: string
          purpose: Database["dev"]["Enums"]["prompt_families_purpose"]
          weight: number
        }
        Insert: {
          description: string
          id: string
          name: string
          purpose: Database["dev"]["Enums"]["prompt_families_purpose"]
          weight: number
        }
        Update: {
          description?: string
          id?: string
          name?: string
          purpose?: Database["dev"]["Enums"]["prompt_families_purpose"]
          weight?: number
        }
        Relationships: []
      }
      prompt_usages: {
        Row: {
          created_at: string
          created_request_id: string
          family_id: string
          generated_text: string
          generated_user: string
          id: string
          input_data: Json | null
          llm_model: string
          metadata: Json | null
          target_id: string
          target_type: string
          temperature: number | null
          used_prompt_text: string
          variant_id: string
        }
        Insert: {
          created_at: string
          created_request_id: string
          family_id: string
          generated_text: string
          generated_user: string
          id: string
          input_data?: Json | null
          llm_model: string
          metadata?: Json | null
          target_id: string
          target_type: string
          temperature?: number | null
          used_prompt_text: string
          variant_id: string
        }
        Update: {
          created_at?: string
          created_request_id?: string
          family_id?: string
          generated_text?: string
          generated_user?: string
          id?: string
          input_data?: Json | null
          llm_model?: string
          metadata?: Json | null
          target_id?: string
          target_type?: string
          temperature?: number | null
          used_prompt_text?: string
          variant_id?: string
        }
        Relationships: []
      }
      prompt_variants: {
        Row: {
          created_by: string
          family_id: string
          id: string
          improvement_note: string | null
          metadata: Json | null
          prompt_text: string
          variant_number: number
        }
        Insert: {
          created_by: string
          family_id: string
          id: string
          improvement_note?: string | null
          metadata?: Json | null
          prompt_text: string
          variant_number: number
        }
        Update: {
          created_by?: string
          family_id?: string
          id?: string
          improvement_note?: string | null
          metadata?: Json | null
          prompt_text?: string
          variant_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_variants_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "prompt_families"
            referencedColumns: ["id"]
          },
        ]
      }
      reactions: {
        Row: {
          action_type: string
          created_at: string
          created_version: string
          id: string
          lock_no: number
          meta: Json | null
          target_id: string
          target_type: string
          user_id: string
        }
        Insert: {
          action_type: string
          created_at: string
          created_version: string
          id: string
          lock_no: number
          meta?: Json | null
          target_id: string
          target_type: string
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          created_version?: string
          id?: string
          lock_no?: number
          meta?: Json | null
          target_id?: string
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      restaurant_bids: {
        Row: {
          amount_cents: number
          created_at: string
          currency_code: string
          end_date: string
          id: string
          lock_no: number
          payment_intent_id: string | null
          refund_id: string | null
          restaurant_id: string
          start_date: string
          status: Database["dev"]["Enums"]["restaurant_bid_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency_code: string
          end_date: string
          id?: string
          lock_no?: number
          payment_intent_id?: string | null
          refund_id?: string | null
          restaurant_id: string
          start_date: string
          status: Database["dev"]["Enums"]["restaurant_bid_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency_code?: string
          end_date?: string
          id?: string
          lock_no?: number
          payment_intent_id?: string | null
          refund_id?: string | null
          restaurant_id?: string
          start_date?: string
          status?: Database["dev"]["Enums"]["restaurant_bid_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_bids_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_bids_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          created_at: string
          google_place_id: string
          id: string
          image_url: string
          latitude: number
          longitude: number
          name: string
          name_language_code: string
        }
        Insert: {
          created_at?: string
          google_place_id: string
          id?: string
          image_url: string
          latitude: number
          longitude: number
          name: string
          name_language_code: string
        }
        Update: {
          created_at?: string
          google_place_id?: string
          id?: string
          image_url?: string
          latitude?: number
          longitude?: number
          name?: string
          name_language_code?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar: string | null
          bio: string | null
          created_at: string
          display_name: string | null
          id: string
          last_login_at: string | null
          lock_no: number
          updated_at: string
          username: string
        }
        Insert: {
          avatar?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_login_at?: string | null
          lock_no?: number
          updated_at?: string
          username: string
        }
        Update: {
          avatar?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_login_at?: string | null
          lock_no?: number
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      backend_event_logs_error_level:
        | "verbose"
        | "debug"
        | "log"
        | "warn"
        | "error"
      frontend_event_logs_error_level:
        | "verbose"
        | "debug"
        | "log"
        | "warn"
        | "error"
      payout_status: "pending" | "paid" | "refunded"
      prompt_families_purpose: "spot_guide_manuscript"
      restaurant_bid_status: "pending" | "paid" | "refunded"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  dev: {
    Enums: {
      backend_event_logs_error_level: [
        "verbose",
        "debug",
        "log",
        "warn",
        "error",
      ],
      frontend_event_logs_error_level: [
        "verbose",
        "debug",
        "log",
        "warn",
        "error",
      ],
      payout_status: ["pending", "paid", "refunded"],
      prompt_families_purpose: ["spot_guide_manuscript"],
      restaurant_bid_status: ["pending", "paid", "refunded"],
    },
  },
} as const
