export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      content_reports: {
        Row: {
          created_at: string
          created_version: string
          id: string
          lock_no: number
          reason_code: string
          reason_text: string | null
          reporter_user_id: string
          resolution_note: string | null
          resolved_at: string | null
          status: string
          target_id: string
          target_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_version?: string
          id?: string
          lock_no?: number
          reason_code: string
          reason_text?: string | null
          reporter_user_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: string
          target_id: string
          target_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_version?: string
          id?: string
          lock_no?: number
          reason_code?: string
          reason_text?: string | null
          reporter_user_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      contribution_tasks: {
        Row: {
          created_at: string
          id: string
          payload: Json
          result: Json
          target_id: string
          target_type: string
          task_key: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          result?: Json
          target_id: string
          target_type: string
          task_key: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          result?: Json
          target_id?: string
          target_type?: string
          task_key?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      dish_categories: {
        Row: {
          created_at: string
          id: string
          image_url: string
          label_en: string
          labels: Json
          macro_genre_qid: string | null
          synced_at: string | null
          tags: string[]
        }
        Insert: {
          created_at?: string
          id: string
          image_url: string
          label_en: string
          labels: Json
          macro_genre_qid?: string | null
          synced_at?: string | null
          tags: string[]
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          label_en?: string
          labels?: Json
          macro_genre_qid?: string | null
          synced_at?: string | null
          tags?: string[]
        }
        Relationships: []
      }
      dish_category_features: {
        Row: {
          dish_category_id: string
          feature_key: string
          feature_type: string
          score: number
          synced_at: string
        }
        Insert: {
          dish_category_id: string
          feature_key: string
          feature_type: string
          score: number
          synced_at: string
        }
        Update: {
          dish_category_id?: string
          feature_key?: string
          feature_type?: string
          score?: number
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_category_features_dish_category_id_fkey"
            columns: ["dish_category_id"]
            isOneToOne: false
            referencedRelation: "dish_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_category_group_vote_candidate_votes: {
        Row: {
          candidate_id: string
          created_at: string
          participant_id: string
          reaction: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          participant_id: string
          reaction: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          participant_id?: string
          reaction?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_category_group_vote_candidate_votes_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "dish_category_group_vote_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_category_group_vote_candidate_votes_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "dish_category_group_vote_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_category_group_vote_candidates: {
        Row: {
          created_at: string
          deleted_at: string | null
          dish_category_id: string
          dish_media_ids: string[]
          dish_media_search_status: string
          display_name: string
          display_order: number
          id: string
          image_url: string
          session_id: string
          tagline: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dish_category_id: string
          dish_media_ids?: string[]
          dish_media_search_status?: string
          display_name: string
          display_order: number
          id?: string
          image_url: string
          session_id: string
          tagline: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dish_category_id?: string
          dish_media_ids?: string[]
          dish_media_search_status?: string
          display_name?: string
          display_order?: number
          id?: string
          image_url?: string
          session_id?: string
          tagline?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_category_group_vote_candidates_dish_category_id_fkey"
            columns: ["dish_category_id"]
            isOneToOne: false
            referencedRelation: "dish_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_category_group_vote_candidates_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dish_category_group_vote_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_category_group_vote_participants: {
        Row: {
          comment: string | null
          created_at: string
          display_name: string
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          display_name: string
          id?: string
          session_id: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          display_name?: string
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_category_group_vote_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "dish_category_group_vote_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_category_group_vote_sessions: {
        Row: {
          created_at: string
          host_user_id: string
          id: string
          idempotency_key: string | null
          search_context: Json
          share_token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_user_id: string
          id?: string
          idempotency_key?: string | null
          search_context?: Json
          share_token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_user_id?: string
          id?: string
          idempotency_key?: string | null
          search_context?: Json
          share_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      dish_category_localized_text: {
        Row: {
          dish_category_id: string
          locale: string
          synced_at: string
          tagline: string
          topic_title: string
        }
        Insert: {
          dish_category_id: string
          locale: string
          synced_at: string
          tagline: string
          topic_title: string
        }
        Update: {
          dish_category_id?: string
          locale?: string
          synced_at?: string
          tagline?: string
          topic_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_category_localized_text_dish_category_id_fkey"
            columns: ["dish_category_id"]
            isOneToOne: false
            referencedRelation: "dish_categories"
            referencedColumns: ["id"]
          },
        ]
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
      dish_media: {
        Row: {
          created_at: string
          deleted_at: string | null
          dish_id: string
          id: string
          lock_no: number
          media_path: string | null
          media_processing_status: string
          media_type: string
          render_type: string
          thumbnail_path: string
          thumbnail_processing_status: string
          updated_at: string
          user_id: string | null
          video_duration_ms: number | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          dish_id: string
          id?: string
          lock_no?: number
          media_path?: string | null
          media_processing_status: string
          media_type: string
          render_type?: string
          thumbnail_path: string
          thumbnail_processing_status: string
          updated_at?: string
          user_id?: string | null
          video_duration_ms?: number | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          dish_id?: string
          id?: string
          lock_no?: number
          media_path?: string | null
          media_processing_status?: string
          media_type?: string
          render_type?: string
          thumbnail_path?: string
          thumbnail_processing_status?: string
          updated_at?: string
          user_id?: string | null
          video_duration_ms?: number | null
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
      dish_media_analysis_results: {
        Row: {
          completion_total: number
          created_at: string
          dish_media_id: string
          impr_total: number
          like_total: number
          open_map_total: number
          save_total: number
          skip_total: number
          updated_at: string
          view_total: number
          watch_ms_total: number
        }
        Insert: {
          completion_total?: number
          created_at?: string
          dish_media_id: string
          impr_total?: number
          like_total?: number
          open_map_total?: number
          save_total?: number
          skip_total?: number
          updated_at?: string
          view_total?: number
          watch_ms_total?: number
        }
        Update: {
          completion_total?: number
          created_at?: string
          dish_media_id?: string
          impr_total?: number
          like_total?: number
          open_map_total?: number
          save_total?: number
          skip_total?: number
          updated_at?: string
          view_total?: number
          watch_ms_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "dish_media_analysis_results_dish_media_id_fkey"
            columns: ["dish_media_id"]
            isOneToOne: true
            referencedRelation: "dish_media"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_media_external_embeddings: {
        Row: {
          canonical_url: string
          created_at: string
          dish_id: string
          dish_media_id: string
          embed_status: string
          external_content_id: string
          last_verified_at: string | null
          provider: string
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          canonical_url: string
          created_at?: string
          dish_id: string
          dish_media_id: string
          embed_status?: string
          external_content_id: string
          last_verified_at?: string | null
          provider: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          canonical_url?: string
          created_at?: string
          dish_id?: string
          dish_media_id?: string
          embed_status?: string
          external_content_id?: string
          last_verified_at?: string | null
          provider?: string
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dmee_dish_media_dish_fk"
            columns: ["dish_media_id", "dish_id"]
            isOneToOne: true
            referencedRelation: "dish_media"
            referencedColumns: ["id", "dish_id"]
          },
        ]
      }
      dish_media_impressions: {
        Row: {
          created_at: string
          dish_media_id: string
          id: string
          session_id: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_media_id: string
          id?: string
          session_id?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          dish_media_id?: string
          id?: string
          session_id?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_media_impressions_dish_media_id_fkey"
            columns: ["dish_media_id"]
            isOneToOne: false
            referencedRelation: "dish_media"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_media_likes: {
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
            foreignKeyName: "dish_media_likes_dish_media_id_fkey"
            columns: ["dish_media_id"]
            isOneToOne: false
            referencedRelation: "dish_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_media_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_media_views: {
        Row: {
          dish_media_id: string
          id: string
          impression_id: string | null
          is_completed: boolean
          is_skipped: boolean
          rewatch_count: number
          started_at: string
          user_id: string
          watch_ms: number
        }
        Insert: {
          dish_media_id: string
          id?: string
          impression_id?: string | null
          is_completed: boolean
          is_skipped: boolean
          rewatch_count: number
          started_at: string
          user_id: string
          watch_ms: number
        }
        Update: {
          dish_media_id?: string
          id?: string
          impression_id?: string | null
          is_completed?: boolean
          is_skipped?: boolean
          rewatch_count?: number
          started_at?: string
          user_id?: string
          watch_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "dish_media_views_dish_media_id_fkey"
            columns: ["dish_media_id"]
            isOneToOne: false
            referencedRelation: "dish_media"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_media_views_impression_id_fkey"
            columns: ["impression_id"]
            isOneToOne: false
            referencedRelation: "dish_media_impressions"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_reviews: {
        Row: {
          comment: string
          comment_tsv: unknown
          created_at: string
          created_dish_media_id: string | null
          currency_code: string | null
          deleted_at: string | null
          dish_id: string
          eaten_at: string | null
          id: string
          imported_user_avatar: string | null
          imported_user_name: string | null
          lock_no: number
          original_language_code: string
          price_cents: number | null
          rating: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          comment: string
          comment_tsv?: unknown
          created_at?: string
          created_dish_media_id?: string | null
          currency_code?: string | null
          deleted_at?: string | null
          dish_id: string
          eaten_at?: string | null
          id?: string
          imported_user_avatar?: string | null
          imported_user_name?: string | null
          lock_no?: number
          original_language_code: string
          price_cents?: number | null
          rating: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          comment?: string
          comment_tsv?: unknown
          created_at?: string
          created_dish_media_id?: string | null
          currency_code?: string | null
          deleted_at?: string | null
          dish_id?: string
          eaten_at?: string | null
          id?: string
          imported_user_avatar?: string | null
          imported_user_name?: string | null
          lock_no?: number
          original_language_code?: string
          price_cents?: number | null
          rating?: number
          updated_at?: string
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
          data_origin: string
          id: string
          lock_no: number
          name: string | null
          restaurant_id: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          data_origin?: string
          id?: string
          lock_no?: number
          name?: string | null
          restaurant_id: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          data_origin?: string
          id?: string
          lock_no?: number
          name?: string | null
          restaurant_id?: string
          synced_at?: string | null
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
      notification_recipients: {
        Row: {
          created_at: string
          last_pushed_actor_id: string | null
          last_pushed_at: string | null
          notification_id: string
          recipient_id: string
          thread_updated_at: string
        }
        Insert: {
          created_at?: string
          last_pushed_actor_id?: string | null
          last_pushed_at?: string | null
          notification_id: string
          recipient_id: string
          thread_updated_at: string
        }
        Update: {
          created_at?: string
          last_pushed_actor_id?: string | null
          last_pushed_at?: string | null
          notification_id?: string
          recipient_id?: string
          thread_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_recipients_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_type: string
          actor_ids: string[]
          created_at: string
          id: string
          idempotency_key: string
          target_id: string
          target_table: string
          updated_at: string
        }
        Insert: {
          action_type: string
          actor_ids: string[]
          created_at?: string
          id?: string
          idempotency_key: string
          target_id: string
          target_table: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          actor_ids?: string[]
          created_at?: string
          id?: string
          idempotency_key?: string
          target_id?: string
          target_table?: string
          updated_at?: string
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
      permissions: {
        Row: {
          description: string
          id: string
          name: string
        }
        Insert: {
          description: string
          id: string
          name: string
        }
        Update: {
          description?: string
          id?: string
          name?: string
        }
        Relationships: []
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
          id?: string
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
          address_components: Json
          created_at: string
          created_by_source: string
          google_place_id: string
          id: string
          image_path: string | null
          image_url: string
          latitude: number
          location: unknown
          longitude: number
          name: string
          name_language_code: string
          plus_code: Json | null
          source_names: string[]
          source_row_hash: string | null
          source_seed_id: string | null
          synced_at: string | null
        }
        Insert: {
          address_components: Json
          created_at?: string
          created_by_source?: string
          google_place_id: string
          id?: string
          image_path?: string | null
          image_url: string
          latitude: number
          location?: unknown
          longitude: number
          name: string
          name_language_code: string
          plus_code?: Json | null
          source_names?: string[]
          source_row_hash?: string | null
          source_seed_id?: string | null
          synced_at?: string | null
        }
        Update: {
          address_components?: Json
          created_at?: string
          created_by_source?: string
          google_place_id?: string
          id?: string
          image_path?: string | null
          image_url?: string
          latitude?: number
          location?: unknown
          longitude?: number
          name?: string
          name_language_code?: string
          plus_code?: Json | null
          source_names?: string[]
          source_row_hash?: string | null
          source_seed_id?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          description: string
          id: string
          name: string
        }
        Insert: {
          description: string
          id: string
          name: string
        }
        Update: {
          description?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      share_links: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          preview_description: string
          preview_image_path: string
          preview_locale: string
          preview_title: string
          schema_version: number
          status: string
          target_id: string
          target_params: Json
          target_type: string
          token_digest: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          preview_description: string
          preview_image_path: string
          preview_locale: string
          preview_title: string
          schema_version?: number
          status?: string
          target_id: string
          target_params?: Json
          target_type: string
          token_digest: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          preview_description?: string
          preview_image_path?: string
          preview_locale?: string
          preview_title?: string
          schema_version?: number
          status?: string
          target_id?: string
          target_params?: Json
          target_type?: string
          token_digest?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_device_tokens: {
        Row: {
          expo_push_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          expo_push_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          expo_push_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notification_cursors: {
        Row: {
          last_read_at: string
          user_id: string
        }
        Insert: {
          last_read_at: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notification_preferences: {
        Row: {
          category: string
          created_at: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          enabled: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          role_id: string
          user_id: string
        }
        Insert: {
          role_id: string
          user_id: string
        }
        Update: {
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_path: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          id: string
          last_login_at: string | null
          lock_no: number
          preferred_locale: string
          updated_at: string
          username: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          last_login_at?: string | null
          lock_no?: number
          preferred_locale: string
          updated_at?: string
          username: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          id?: string
          last_login_at?: string | null
          lock_no?: number
          preferred_locale?: string
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

