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
      _backup_mt_step1_invite_links: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string | null
          invite_link: string | null
          revoked: boolean | null
          revoked_at: string | null
          subscriber_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          invite_link?: string | null
          revoked?: boolean | null
          revoked_at?: string | null
          subscriber_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          invite_link?: string | null
          revoked?: boolean | null
          revoked_at?: string | null
          subscriber_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      _backup_mt_step1_system_logs: {
        Row: {
          created_at: string | null
          event_type: string | null
          id: string | null
          level: string | null
          message: string | null
          payload: Json | null
          request_id: string | null
          source: string | null
          subscriber_id: string | null
          telegram_user_id: number | null
          tenant_id: string | null
          tier_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          level?: string | null
          message?: string | null
          payload?: Json | null
          request_id?: string | null
          source?: string | null
          subscriber_id?: string | null
          telegram_user_id?: number | null
          tenant_id?: string | null
          tier_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string | null
          id?: string | null
          level?: string | null
          message?: string | null
          payload?: Json | null
          request_id?: string | null
          source?: string | null
          subscriber_id?: string | null
          telegram_user_id?: number | null
          tenant_id?: string | null
          tier_id?: string | null
        }
        Relationships: []
      }
      admin_notification_log: {
        Row: {
          created_at: string
          event_type: string
          id: number
          payload: Json | null
          payment_id: string | null
          related_at: string | null
          subscriber_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: number
          payload?: Json | null
          payment_id?: string | null
          related_at?: string | null
          subscriber_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: number
          payload?: Json | null
          payment_id?: string | null
          related_at?: string | null
          subscriber_id?: string | null
        }
        Relationships: []
      }
      admin_settings: {
        Row: {
          channel_description: string | null
          channel_name: string | null
          created_at: string
          grace_period_days: number | null
          id: string
          logo_url: string | null
          notification_grace_period_warning: string | null
          notification_payment_failed: string | null
          notification_payment_reminder: string | null
          notification_payment_success: string | null
          notification_subscription_expired: string | null
          notification_subscription_expiring_single: string | null
          payment_link: string | null
          reminder_days_before: number | null
          robokassa_merchant_login: string | null
          robokassa_password1: string | null
          robokassa_password2: string | null
          robokassa_result_url: string | null
          robokassa_test_mode: boolean | null
          single_reminder_days_before: number | null
          telegram_admin_notifications_channel_id: string | null
          telegram_admin_notifications_enabled: boolean
          telegram_bot_token: string | null
          telegram_channel_id: string | null
          tenant_id: string | null
          updated_at: string
          welcome_message_button_text: string | null
          welcome_message_button_url: string | null
          welcome_message_image_url: string | null
          welcome_message_text: string | null
        }
        Insert: {
          channel_description?: string | null
          channel_name?: string | null
          created_at?: string
          grace_period_days?: number | null
          id?: string
          logo_url?: string | null
          notification_grace_period_warning?: string | null
          notification_payment_failed?: string | null
          notification_payment_reminder?: string | null
          notification_payment_success?: string | null
          notification_subscription_expired?: string | null
          notification_subscription_expiring_single?: string | null
          payment_link?: string | null
          reminder_days_before?: number | null
          robokassa_merchant_login?: string | null
          robokassa_password1?: string | null
          robokassa_password2?: string | null
          robokassa_result_url?: string | null
          robokassa_test_mode?: boolean | null
          single_reminder_days_before?: number | null
          telegram_admin_notifications_channel_id?: string | null
          telegram_admin_notifications_enabled?: boolean
          telegram_bot_token?: string | null
          telegram_channel_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          welcome_message_button_text?: string | null
          welcome_message_button_url?: string | null
          welcome_message_image_url?: string | null
          welcome_message_text?: string | null
        }
        Update: {
          channel_description?: string | null
          channel_name?: string | null
          created_at?: string
          grace_period_days?: number | null
          id?: string
          logo_url?: string | null
          notification_grace_period_warning?: string | null
          notification_payment_failed?: string | null
          notification_payment_reminder?: string | null
          notification_payment_success?: string | null
          notification_subscription_expired?: string | null
          notification_subscription_expiring_single?: string | null
          payment_link?: string | null
          reminder_days_before?: number | null
          robokassa_merchant_login?: string | null
          robokassa_password1?: string | null
          robokassa_password2?: string | null
          robokassa_result_url?: string | null
          robokassa_test_mode?: boolean | null
          single_reminder_days_before?: number | null
          telegram_admin_notifications_channel_id?: string | null
          telegram_admin_notifications_enabled?: boolean
          telegram_bot_token?: string | null
          telegram_channel_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          welcome_message_button_text?: string | null
          welcome_message_button_url?: string | null
          welcome_message_image_url?: string | null
          welcome_message_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          created_at: string
          direction: string
          file_name: string | null
          file_url: string | null
          id: string
          is_read_by_admin: boolean
          message_type: string
          mime_type: string | null
          read_by_admin_at: string | null
          sender_type: string
          telegram_message_id: number | null
          telegram_status: string | null
          tenant_id: string
          text_content: string | null
          thread_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          is_read_by_admin?: boolean
          message_type?: string
          mime_type?: string | null
          read_by_admin_at?: string | null
          sender_type: string
          telegram_message_id?: number | null
          telegram_status?: string | null
          tenant_id: string
          text_content?: string | null
          thread_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          is_read_by_admin?: boolean
          message_type?: string
          mime_type?: string | null
          read_by_admin_at?: string | null
          sender_type?: string
          telegram_message_id?: number | null
          telegram_status?: string | null
          tenant_id?: string
          text_content?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          admin_unread_count: number
          bot_blocked: boolean
          bot_id: string | null
          channel_id: string | null
          created_at: string
          group_id: string | null
          id: string
          last_message_at: string | null
          last_message_direction: string | null
          last_message_preview: string | null
          source_type: string
          status: string
          subscriber_id: string | null
          telegram_user_id: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          admin_unread_count?: number
          bot_blocked?: boolean
          bot_id?: string | null
          channel_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          source_type?: string
          status?: string
          subscriber_id?: string | null
          telegram_user_id: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          admin_unread_count?: number
          bot_blocked?: boolean
          bot_id?: string | null
          channel_id?: string | null
          created_at?: string
          group_id?: string | null
          id?: string
          last_message_at?: string | null
          last_message_direction?: string | null
          last_message_preview?: string | null
          source_type?: string
          status?: string
          subscriber_id?: string | null
          telegram_user_id?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_links: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invite_link: string
          revoked: boolean
          revoked_at: string | null
          subscriber_id: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          invite_link: string
          revoked?: boolean
          revoked_at?: string | null
          subscriber_id: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invite_link?: string
          revoked?: boolean
          revoked_at?: string | null
          subscriber_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invite_links_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invite_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            foreignKeyName: "payment_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      subscriber_messages: {
        Row: {
          created_at: string
          direction: string
          error_message: string | null
          id: string
          message_text: string
          parse_mode: string | null
          sent_by_user_id: string
          status: string
          subscriber_id: string
          telegram_message_id: number | null
          telegram_user_id: number
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          message_text: string
          parse_mode?: string | null
          sent_by_user_id: string
          status?: string
          subscriber_id: string
          telegram_message_id?: number | null
          telegram_user_id: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          message_text?: string
          parse_mode?: string | null
          sent_by_user_id?: string
          status?: string
          subscriber_id?: string
          telegram_message_id?: number | null
          telegram_user_id?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriber_messages_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriber_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          auto_renewal: boolean | null
          auto_renewal_consent_date: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          is_in_channel: boolean | null
          last_name: string | null
          next_payment_notification_sent: boolean | null
          phone_number: string | null
          robokassa_invoice_id: string | null
          single_expiry_notification_sent: boolean
          status: string | null
          subscriber_payment_method: string | null
          subscription_end: string | null
          subscription_start: string | null
          telegram_user_id: number
          telegram_username: string | null
          tenant_id: string | null
          tier_id: string | null
          updated_at: string
        }
        Insert: {
          auto_renewal?: boolean | null
          auto_renewal_consent_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_in_channel?: boolean | null
          last_name?: string | null
          next_payment_notification_sent?: boolean | null
          phone_number?: string | null
          robokassa_invoice_id?: string | null
          single_expiry_notification_sent?: boolean
          status?: string | null
          subscriber_payment_method?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          telegram_user_id: number
          telegram_username?: string | null
          tenant_id?: string | null
          tier_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_renewal?: boolean | null
          auto_renewal_consent_date?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          is_in_channel?: boolean | null
          last_name?: string | null
          next_payment_notification_sent?: boolean | null
          phone_number?: string | null
          robokassa_invoice_id?: string | null
          single_expiry_notification_sent?: boolean
          status?: string | null
          subscriber_payment_method?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          telegram_user_id?: number
          telegram_username?: string | null
          tenant_id?: string | null
          tier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
          billing_timezone: string
          created_at: string
          description: string | null
          duration_days: number
          grace_period_enabled: boolean
          id: string
          interval_count: number
          interval_unit: string
          is_active: boolean | null
          name: string
          price: number
          purchase_once_only: boolean
          show_in_dashboard: boolean
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          billing_timezone?: string
          created_at?: string
          description?: string | null
          duration_days: number
          grace_period_enabled?: boolean
          id?: string
          interval_count?: number
          interval_unit?: string
          is_active?: boolean | null
          name: string
          price: number
          purchase_once_only?: boolean
          show_in_dashboard?: boolean
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_timezone?: string
          created_at?: string
          description?: string | null
          duration_days?: number
          grace_period_enabled?: boolean
          id?: string
          interval_count?: number
          interval_unit?: string
          is_active?: boolean | null
          name?: string
          price?: number
          purchase_once_only?: boolean
          show_in_dashboard?: boolean
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_tiers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          level: string
          message: string | null
          payload: Json
          request_id: string | null
          source: string
          subscriber_id: string | null
          telegram_user_id: number | null
          tenant_id: string | null
          tier_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          level?: string
          message?: string | null
          payload?: Json
          request_id?: string | null
          source: string
          subscriber_id?: string | null
          telegram_user_id?: number | null
          tenant_id?: string | null
          tier_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          level?: string
          message?: string | null
          payload?: Json
          request_id?: string | null
          source?: string
          subscriber_id?: string | null
          telegram_user_id?: number | null
          tenant_id?: string | null
          tier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_logs_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "subscription_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          slug?: string
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
      current_tenant_id: { Args: never; Returns: string }
      default_admin_id: { Args: never; Returns: string }
      ensure_admin_bootstrap: {
        Args: { p_user_id: string }
        Returns: {
          created_settings: boolean
          created_tenant: boolean
          tenant_id: string
          tenant_slug: string
        }[]
      }
      ensure_current_admin_bootstrap: {
        Args: never
        Returns: {
          created_settings: boolean
          created_tenant: boolean
          tenant_id: string
          tenant_slug: string
        }[]
      }
      generate_tenant_slug: { Args: never; Returns: string }
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
