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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      alert_rules: {
        Row: {
          active: boolean
          conditions: Json
          created_at: string
          digest_schedule: string | null
          id: string
          last_triggered_at: string | null
          name: string
          rule_type: string
          updated_at: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          active?: boolean
          conditions?: Json
          created_at?: string
          digest_schedule?: string | null
          id?: string
          last_triggered_at?: string | null
          name: string
          rule_type?: string
          updated_at?: string
          user_id: string
          webhook_url?: string | null
        }
        Update: {
          active?: boolean
          conditions?: Json
          created_at?: string
          digest_schedule?: string | null
          id?: string
          last_triggered_at?: string | null
          name?: string
          rule_type?: string
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      app_notifications: {
        Row: {
          body: string
          created_at: string
          fetch_run_id: string | null
          id: string
          kind: string
          payload: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          fetch_run_id?: string | null
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          fetch_run_id?: string | null
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_notifications_fetch_run_id_fkey"
            columns: ["fetch_run_id"]
            isOneToOne: false
            referencedRelation: "fetch_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      approved_domains: {
        Row: {
          active: boolean | null
          approval_status: string
          auto_discovered: boolean | null
          country_code: string | null
          created_at: string
          domain: string
          feed_url: string | null
          id: string
          language: string | null
          name: string
          priority: number | null
          region: string | null
          sitemap_url: string | null
          source_type: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          approval_status?: string
          auto_discovered?: boolean | null
          country_code?: string | null
          created_at?: string
          domain: string
          feed_url?: string | null
          id?: string
          language?: string | null
          name: string
          priority?: number | null
          region?: string | null
          sitemap_url?: string | null
          source_type?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          approval_status?: string
          auto_discovered?: boolean | null
          country_code?: string | null
          created_at?: string
          domain?: string
          feed_url?: string | null
          id?: string
          language?: string | null
          name?: string
          priority?: number | null
          region?: string | null
          sitemap_url?: string | null
          source_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      article_bookmarks: {
        Row: {
          article_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_bookmarks_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_enrichments: {
        Row: {
          article_id: string
          author_bio: string | null
          author_email: string | null
          author_name: string | null
          author_social: Json | null
          author_url: string | null
          comments: Json | null
          enriched_at: string
          full_text: string | null
          id: string
          key_quotes: string[] | null
        }
        Insert: {
          article_id: string
          author_bio?: string | null
          author_email?: string | null
          author_name?: string | null
          author_social?: Json | null
          author_url?: string | null
          comments?: Json | null
          enriched_at?: string
          full_text?: string | null
          id?: string
          key_quotes?: string[] | null
        }
        Update: {
          article_id?: string
          author_bio?: string | null
          author_email?: string | null
          author_name?: string | null
          author_social?: Json | null
          author_url?: string | null
          comments?: Json | null
          enriched_at?: string
          full_text?: string | null
          id?: string
          key_quotes?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "article_enrichments_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_notes: {
        Row: {
          article_id: string
          content: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id: string
          content: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          article_id?: string
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_notes_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_tags: {
        Row: {
          article_id: string
          created_at: string
          id: string
          tag: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          id?: string
          tag: string
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          id?: string
          tag?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_tags_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          ai_summary: string | null
          author_email: string | null
          author_name: string | null
          author_url: string | null
          discovery_method: string | null
          fetched_at: string
          id: string
          language: string | null
          matched_keywords: string[] | null
          matched_via: string | null
          primary_entity: string | null
          published_at: string
          relevance_score: number | null
          sentiment: string | null
          sentiment_score: number | null
          snippet: string | null
          source_domain: string | null
          source_id: string | null
          source_name: string | null
          title: string
          url: string
        }
        Insert: {
          ai_summary?: string | null
          author_email?: string | null
          author_name?: string | null
          author_url?: string | null
          discovery_method?: string | null
          fetched_at?: string
          id?: string
          language?: string | null
          matched_keywords?: string[] | null
          matched_via?: string | null
          primary_entity?: string | null
          published_at?: string
          relevance_score?: number | null
          sentiment?: string | null
          sentiment_score?: number | null
          snippet?: string | null
          source_domain?: string | null
          source_id?: string | null
          source_name?: string | null
          title: string
          url: string
        }
        Update: {
          ai_summary?: string | null
          author_email?: string | null
          author_name?: string | null
          author_url?: string | null
          discovery_method?: string | null
          fetched_at?: string
          id?: string
          language?: string | null
          matched_keywords?: string[] | null
          matched_via?: string | null
          primary_entity?: string | null
          published_at?: string
          relevance_score?: number | null
          sentiment?: string | null
          sentiment_score?: number | null
          snippet?: string | null
          source_domain?: string | null
          source_id?: string | null
          source_name?: string | null
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      fetch_runs: {
        Row: {
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          initiated_by: string | null
          result_stats: Json
          scheduled_for: string | null
          started_at: string | null
          status: string
          summary: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          result_stats?: Json
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          result_stats?: Json
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      keyword_groups: {
        Row: {
          created_at: string
          description: string | null
          group_type: string | null
          id: string
          keyword_ids: string[]
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          group_type?: string | null
          id?: string
          keyword_ids?: string[]
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          group_type?: string | null
          id?: string
          keyword_ids?: string[]
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      keywords: {
        Row: {
          active: boolean
          color_tag: string | null
          created_at: string
          expanded_terms: string[] | null
          favorite: boolean
          id: string
          logic_operator: string
          match_count: number
          text: string
        }
        Insert: {
          active?: boolean
          color_tag?: string | null
          created_at?: string
          expanded_terms?: string[] | null
          favorite?: boolean
          id?: string
          logic_operator?: string
          match_count?: number
          text: string
        }
        Update: {
          active?: boolean
          color_tag?: string | null
          created_at?: string
          expanded_terms?: string[] | null
          favorite?: boolean
          id?: string
          logic_operator?: string
          match_count?: number
          text?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_fetch_complete: boolean
          id: string
          in_app_fetch_complete: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_fetch_complete?: boolean
          id?: string
          in_app_fetch_complete?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_fetch_complete?: boolean
          id?: string
          in_app_fetch_complete?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      report_templates: {
        Row: {
          created_at: string
          description: string | null
          filters: Json
          id: string
          last_generated_at: string | null
          name: string
          schedule: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          last_generated_at?: string | null
          name: string
          schedule?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          last_generated_at?: string | null
          name?: string
          schedule?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      saved_searches: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_preset: boolean
          name: string
          preset_type: string | null
          query: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_preset?: boolean
          name: string
          preset_type?: string | null
          query?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_preset?: boolean
          name?: string
          preset_type?: string | null
          query?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          company_logo_url: string | null
          company_name: string | null
          created_at: string
          digest_email: string | null
          fetch_frequency_minutes: number | null
          fetch_schedule: string | null
          id: string
          language_filter: string[] | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string
          digest_email?: string | null
          fetch_frequency_minutes?: number | null
          fetch_schedule?: string | null
          id?: string
          language_filter?: string[] | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string
          digest_email?: string | null
          fetch_frequency_minutes?: number | null
          fetch_schedule?: string | null
          id?: string
          language_filter?: string[] | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          active: boolean
          approval_status: string
          consecutive_failures: number
          country_code: string | null
          crawl_delay_ms: number
          created_at: string
          domain: string | null
          fetch_priority: number
          health_status: string
          id: string
          language: string | null
          last_fetched_at: string | null
          last_success_at: string | null
          name: string
          parser_config: Json | null
          region: string
          robots_checked_at: string | null
          rss_url: string
          source_type: string
        }
        Insert: {
          active?: boolean
          approval_status?: string
          consecutive_failures?: number
          country_code?: string | null
          crawl_delay_ms?: number
          created_at?: string
          domain?: string | null
          fetch_priority?: number
          health_status?: string
          id?: string
          language?: string | null
          last_fetched_at?: string | null
          last_success_at?: string | null
          name: string
          parser_config?: Json | null
          region?: string
          robots_checked_at?: string | null
          rss_url: string
          source_type?: string
        }
        Update: {
          active?: boolean
          approval_status?: string
          consecutive_failures?: number
          country_code?: string | null
          crawl_delay_ms?: number
          created_at?: string
          domain?: string | null
          fetch_priority?: number
          health_status?: string
          id?: string
          language?: string | null
          last_fetched_at?: string | null
          last_success_at?: string | null
          name?: string
          parser_config?: Json | null
          region?: string
          robots_checked_at?: string | null
          rss_url?: string
          source_type?: string
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
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
