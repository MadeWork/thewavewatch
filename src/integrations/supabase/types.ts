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
      articles: {
        Row: {
          ai_summary: string | null
          fetched_at: string
          id: string
          language: string | null
          matched_keywords: string[] | null
          published_at: string
          sentiment: string | null
          sentiment_score: number | null
          snippet: string | null
          source_id: string | null
          title: string
          url: string
        }
        Insert: {
          ai_summary?: string | null
          fetched_at?: string
          id?: string
          language?: string | null
          matched_keywords?: string[] | null
          published_at?: string
          sentiment?: string | null
          sentiment_score?: number | null
          snippet?: string | null
          source_id?: string | null
          title: string
          url: string
        }
        Update: {
          ai_summary?: string | null
          fetched_at?: string
          id?: string
          language?: string | null
          matched_keywords?: string[] | null
          published_at?: string
          sentiment?: string | null
          sentiment_score?: number | null
          snippet?: string | null
          source_id?: string | null
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
      keywords: {
        Row: {
          active: boolean
          color_tag: string | null
          created_at: string
          id: string
          logic_operator: string
          match_count: number
          text: string
        }
        Insert: {
          active?: boolean
          color_tag?: string | null
          created_at?: string
          id?: string
          logic_operator?: string
          match_count?: number
          text: string
        }
        Update: {
          active?: boolean
          color_tag?: string | null
          created_at?: string
          id?: string
          logic_operator?: string
          match_count?: number
          text?: string
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
          country_code: string | null
          created_at: string
          health_status: string
          id: string
          last_fetched_at: string | null
          name: string
          region: string
          rss_url: string
        }
        Insert: {
          active?: boolean
          country_code?: string | null
          created_at?: string
          health_status?: string
          id?: string
          last_fetched_at?: string | null
          name: string
          region?: string
          rss_url: string
        }
        Update: {
          active?: boolean
          country_code?: string | null
          created_at?: string
          health_status?: string
          id?: string
          last_fetched_at?: string | null
          name?: string
          region?: string
          rss_url?: string
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
