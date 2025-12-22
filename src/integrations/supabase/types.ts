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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          channel_description: string | null
          channel_name: string | null
          created_at: string
          grace_period_days: number | null
          id: string
          payment_link: string | null
          reminder_days_before: number | null
          robokassa_merchant_login: string | null
          robokassa_password1: string | null
          robokassa_password2: string | null
          robokassa_result_url: string | null
          robokassa_test_mode: boolean | null
          telegram_bot_token: string | null
          telegram_channel_id: string | null
          updated_at: string
          welcome_message_button_text: string | null
          welcome_message_image_url: string | null
          welcome_message_text: string | null
        }
        Insert: {
          channel_description?: string | null
          channel_name?: string | null
          created_at?: string
          grace_period_days?: number | null
          id?: string
          payment_link?: string | null
          reminder_days_before?: number | null
          robokassa_merchant_login?: string | null
          robokassa_password1?: string | null
          robokassa_password2?: string | null
          robokassa_result_url?: string | null
          robokassa_test_mode?: boolean | null
          telegram_bot_token?: string | null
          telegram_channel_id?: string | null
          updated_at?: string
          welcome_message_button_text?: string | null
          welcome_message_image_url?: string | null
          welcome_message_text?: string | null
        }
        Update: {
          channel_description?: string | null
          channel_name?: string | null
          created_at?: string
          grace_period_days?: number | null
          id?: string
          payment_link?: string | null
          reminder_days_before?: number | null
          robokassa_merchant_login?: string | null
          robokassa_password1?: string | null
          robokassa_password2?: string | null
          robokassa_result_url?: string | null
          robokassa_test_mode?: boolean | null
          telegram_bot_token?: string | null
          telegram_channel_id?: string | null
          updated_at?: string
          welcome_message_button_text?: string | null
          welcome_message_image_url?: string | null
          welcome_message_text?: string | null
        }
        Relationships: []
      }
      payment_history: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string | null
          payment_date: string
          payment_method: string
          payment_note: string | null
          robokassa_data: Json | null
          status: string | null
          subscriber_id: string
          tier_id: string | null
          transaction_type: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          payment_date?: string
          payment_method?: string
          payment_note?: string | null
          robokassa_data?: Json | null
          status?: string | null
          subscriber_id: string
          tier_id?: string | null
          transaction_type?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string | null
          payment_date?: string
          payment_method?: string
          payment_note?: string | null
          robokassa_data?: Json | null
          status?: string | null
          subscriber_id?: string
          tier_id?: string | null
          transaction_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_history_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "subscription_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          auto_renewal: boolean | null
          auto_renewal_consent_date: string | null
          created_at: string
          first_name: string | null
          id: string
          is_in_channel: boolean | null
          last_name: string | null
          next_payment_notification_sent: boolean | null
          robokassa_invoice_id: string | null
          status: string | null
          subscriber_payment_method: string | null
          subscription_end: string | null
          subscription_start: string | null
          telegram_user_id: number
          telegram_username: string | null
          tier_id: string | null
          updated_at: string
        }
        Insert: {
          auto_renewal?: boolean | null
          auto_renewal_consent_date?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          is_in_channel?: boolean | null
          last_name?: string | null
          next_payment_notification_sent?: boolean | null
          robokassa_invoice_id?: string | null
          status?: string | null
          subscriber_payment_method?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          telegram_user_id: number
          telegram_username?: string | null
          tier_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_renewal?: boolean | null
          auto_renewal_consent_date?: string | null
          created_at?: string
          first_name?: string | null
          id?: string
          is_in_channel?: boolean | null
          last_name?: string | null
          next_payment_notification_sent?: boolean | null
          robokassa_invoice_id?: string | null
          status?: string | null
          subscriber_payment_method?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          telegram_user_id?: number
          telegram_username?: string | null
          tier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "subscription_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_consent_log: {
        Row: {
          consent_date: string
          consent_type: string
          created_at: string
          id: string
          ip_address: string | null
          subscriber_id: string
          user_agent: string | null
        }
        Insert: {
          consent_date?: string
          consent_type: string
          created_at?: string
          id?: string
          ip_address?: string | null
          subscriber_id: string
          user_agent?: string | null
        }
        Update: {
          consent_date?: string
          consent_type?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          subscriber_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_consent_log_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_tiers: {
        Row: {
          created_at: string
          description: string | null
          duration_days: number
          id: string
          is_active: boolean | null
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_days: number
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_days?: number
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      payment_status: "pending" | "processing" | "completed" | "failed"
      payment_transaction_type: "initial" | "recurring"
      subscriber_payment_method:
        | "manual"
        | "robokassa_single"
        | "robokassa_recurring"
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
    Enums: {
      app_role: ["admin", "user"],
      payment_status: ["pending", "processing", "completed", "failed"],
      payment_transaction_type: ["initial", "recurring"],
      subscriber_payment_method: [
        "manual",
        "robokassa_single",
        "robokassa_recurring",
      ],
    },
  },
} as const
