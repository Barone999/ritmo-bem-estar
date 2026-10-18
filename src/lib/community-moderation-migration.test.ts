import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261015190000_add_community_moderation.sql"),
  "utf8",
);

describe("community moderation migration security contract", () => {
  it("separates administrators from moderators and gates moderator management", () => {
    expect(migration).toMatch(/create table if not exists public\.community_admins/i);
    expect(migration).toMatch(/create or replace function public\.set_community_moderator/i);
    expect(migration).toMatch(/from public\.community_admins a where a\.user_id = auth\.uid\(\)/i);
    expect(migration).toMatch(/revoke all on function public\.set_community_moderator\(uuid, boolean\) from public, anon/i);
    expect(migration).toMatch(/grant execute on function public\.set_community_moderator\(uuid, boolean\) to authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.community_moderators from public, anon, authenticated/i);
    expect(migration).toMatch(/uma conta administradora não pode perder o acesso à moderação/i);
    expect(migration).toMatch(/create policy "admins can read moderator roster"/i);
  });

  it("requires moderator membership for moderation actions", () => {
    expect(migration).toMatch(/from public\.community_moderators m where m\.user_id = auth\.uid\(\)/i);
    expect(migration).toMatch(/revoke all on function public\.moderate_community_post\(uuid, text, text\) from public, anon/i);
    expect(migration).toMatch(/grant execute on function public\.moderate_community_post\(uuid, text, text\) to authenticated/i);
  });

  it("does not trust a custom session GUC and restricts protected writes by grants", () => {
    expect(migration).not.toMatch(/current_setting\s*\(\s*'muuvi\.moderation_rpc'/i);
    expect(migration).not.toMatch(/set_config\s*\(\s*'muuvi\.moderation_rpc'/i);
    expect(migration).not.toMatch(/create trigger[^;]*enforce_community_moderation_fields/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.community_admins from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.moderation_actions from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.posts from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.post_reports from public, anon, authenticated/i);
    expect(migration).toMatch(/create or replace function public\.moderate_community_post\([\s\S]*?security definer[\s\S]*?set search_path = public/i);
    expect(migration).toMatch(/create or replace function public\.set_community_moderator\([\s\S]*?security definer[\s\S]*?set search_path = public/i);
  });

  it("blocks new comments and likes on hidden or removed posts for every role", () => {
    const commentPolicy = migration.match(/create policy "own comment ins"[\s\S]*?\);/i)?.[0] ?? "";
    const likePolicy = migration.match(/create policy "own like ins"[\s\S]*?\);/i)?.[0] ?? "";

    expect(commentPolicy).toMatch(/p\.moderation_status = 'visible'/i);
    expect(likePolicy).toMatch(/p\.moderation_status = 'visible'/i);
    expect(commentPolicy).not.toMatch(/community_moderators|community_admins/i);
    expect(likePolicy).not.toMatch(/community_moderators|community_admins/i);
  });

  it("records how many pending reports each action affected", () => {
    expect(migration).toMatch(/reports_affected integer not null default 0/i);
    expect(migration).toMatch(/get diagnostics v_reports_affected = row_count/i);
    expect(migration).toMatch(/set reports_affected = v_reports_affected/i);
  });

  it("limits author-name resolution to inserts and relevant column updates", () => {
    expect(migration).toMatch(/before insert or update of user_id, author_name on public\.posts/i);
  });

  it("uses valid dollar-quoted function bodies and does not leave a single-dollar delimiter", () => {
    expect(migration).toMatch(/create or replace function public\.set_community_moderator\([\s\S]*?as \$\$[\s\S]*?end;\s*\$\$;/i);
    expect(migration).not.toMatch(/as \$\s*\n/);
    expect(migration).not.toMatch(/end;\s*\$;\s*\n/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.posts from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.post_reports from public, anon, authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.moderation_actions from public, anon, authenticated/i);
  });

  it("does not silently seed an administrator with a placeholder identity", () => {
    expect(migration).not.toMatch(/00000000-0000-0000-0000-000000000000/i);
    expect(migration).not.toMatch(/insert into public\.community_admins\s*\(user_id\)\s*values\s*\(/i);
  });
});
