import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// The community moderation migration (supabase/migrations/20261015190000_add_community_moderation.sql)
// is pending review and is not applied to the database yet, so the generated types do not
// include its tables/columns. Moderation queries go through this loosely typed client with
// explicit row types; until the migration is applied they return an error that the UI handles.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const moderationDb = supabase as unknown as SupabaseClient<any>;

export type ModerationStatus = "visible" | "hidden" | "removed";

export type ModeratorRow = { user_id: string };

export type PendingReportRow = {
  id: string;
  post_id: string;
  user_id: string;
  reason: string | null;
  created_at: string;
  review_status: "pending" | "reviewed" | "dismissed";
};

export type ModeratedPostRow = {
  id: string;
  user_id: string;
  author_name: string;
  content: string;
  image_path: string | null;
  image_url: string | null;
  created_at: string;
  moderation_status: ModerationStatus;
};

export type ModerationActionRow = {
  id: string;
  post_id: string;
  action: string;
  reason: string;
  reports_affected: number;
  created_at: string;
};
