import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, History, ShieldAlert, Trash2, UserPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useUser } from "@/lib/data";
import { moderationDb, type ModeratorRow, type PendingReportRow, type ModeratedPostRow, type ModerationActionRow } from "@/lib/moderation-db";

export const Route = createFileRoute("/_authenticated/comunidade/moderacao")({
  head: () => ({ meta: [{ title: "Moderação — Muuvi" }] }),
  component: ModeracaoComunidade,
});

type Action = "hide" | "restore" | "remove" | "dismiss_reports";

function ModeracaoComunidade() {
  const queryClient = useQueryClient();
  const { data: user } = useUser();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [moderatorUserId, setModeratorUserId] = useState("");
  const [managingModerator, setManagingModerator] = useState(false);

  const { data: membership, isLoading: checkingAccess, error: membershipError } = useQuery({
    queryKey: ["community-moderator", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await moderationDb.from("community_moderators").select("user_id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ModeratorRow | null;
    },
  });

  const { data: adminMembership, isLoading: checkingAdmin } = useQuery({
    queryKey: ["community-admin", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await moderationDb.from("community_admins").select("user_id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ModeratorRow | null;
    },
  });

  const { data: moderators = [], isLoading: loadingModerators, error: moderatorsError } = useQuery({
    queryKey: ["community-moderator-roster"],
    enabled: !!adminMembership,
    queryFn: async () => {
      const { data, error } = await moderationDb.from("community_moderators").select("user_id").order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ModeratorRow[];
    },
  });

  async function setModerator(userId: string, isModerator: boolean) {
    const normalizedId = userId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedId)) {
      toast.error("Informe um UUID válido da conta.");
      return;
    }
    setManagingModerator(true);
    const { error } = await moderationDb.rpc("set_community_moderator", {
      p_user_id: normalizedId,
      p_is_moderator: isModerator,
    });
    setManagingModerator(false);
    if (error) {
      toast.error(error.message || "Não foi possível atualizar a equipe.");
      return;
    }
    toast.success(isModerator ? "Moderador adicionado." : "Moderador removido.");
    setModeratorUserId("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["community-moderator-roster"] }),
      queryClient.invalidateQueries({ queryKey: ["community-moderator"] }),
    ]);
  }

  const { data: reports = [], isLoading: loadingReports, error: reportsError } = useQuery({
    queryKey: ["moderation-reports"],
    enabled: !!membership,
    queryFn: async () => {
      const { data, error } = await moderationDb.from("post_reports").select("*").eq("review_status", "pending").order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PendingReportRow[];
    },
  });

  const reportedPostIds = [...new Set(reports.map((report) => report.post_id))];

  const { data: posts = [] } = useQuery({
    queryKey: ["moderation-posts", reportedPostIds],
    enabled: !!membership,
    queryFn: async () => {
      if (reportedPostIds.length === 0) return [] as ModeratedPostRow[];
      const { data, error } = await moderationDb.from("posts").select("*").in("id", reportedPostIds);
      if (error) throw error;
      return (data ?? []) as ModeratedPostRow[];
    },
  });

  // Keep this list independent from pending reports so reviewed posts remain recoverable.
  const { data: hiddenPosts = [], isLoading: loadingHiddenPosts, error: hiddenPostsError } = useQuery({
    queryKey: ["moderation-hidden-posts"],
    enabled: !!membership,
    queryFn: async () => {
      const { data, error } = await moderationDb
        .from("posts")
        .select("*")
        .neq("moderation_status", "visible")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ModeratedPostRow[];
    },
  });

  const { data: history = [] } = useQuery({
    queryKey: ["moderation-history"],
    enabled: !!membership,
    queryFn: async () => {
      const { data, error } = await moderationDb.from("moderation_actions").select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as ModerationActionRow[];
    },
  });

  const postById = new Map(posts.map((post) => [post.id, post]));
  const grouped = new Map<string, typeof reports>();
  for (const report of reports) {
    grouped.set(report.post_id, [...(grouped.get(report.post_id) ?? []), report]);
  }
  const queue = [...grouped.entries()]
    .map(([postId, items]) => ({ post: postById.get(postId), items }))
    .filter((item) => item.post)
    .sort((a, b) => b.items.length - a.items.length);

  async function act(postId: string, action: Action) {
    const reason = reasons[postId]?.trim();
    if (!reason || reason.length < 3) {
      toast.error("Informe um motivo com pelo menos 3 caracteres.");
      return;
    }
    setBusy(postId);
    const { error } = await moderationDb.rpc("moderate_community_post", {
      p_post_id: postId,
      p_action: action,
      p_reason: reason,
    });
    setBusy(null);
    if (error) {
      toast.error(error.message || "Não foi possível concluir a ação.");
      return;
    }
    toast.success("Ação registrada no histórico.");
    setReasons((prev) => ({ ...prev, [postId]: "" }));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["moderation-reports"] }),
      queryClient.invalidateQueries({ queryKey: ["moderation-posts"] }),
      queryClient.invalidateQueries({ queryKey: ["moderation-hidden-posts"] }),
      queryClient.invalidateQueries({ queryKey: ["moderation-history"] }),
      queryClient.invalidateQueries({ queryKey: ["posts"] }),
    ]);
  }

  if (checkingAccess || checkingAdmin || (!!user && membership === undefined && !membershipError)) {
    return <AppShell title="Moderação"><p className="p-4 text-sm text-foreground/60">Verificando acesso administrativo…</p></AppShell>;
  }

  if (membershipError) {
    return <AppShell title="Moderação"><p className="rounded-2xl bg-destructive/10 p-4 text-sm">Não foi possível verificar a autorização. A migração pode ainda não ter sido aplicada.</p></AppShell>;
  }

  if (!membership) {
    return <AppShell title="Acesso restrito"><div className="space-y-3 rounded-3xl bg-surface p-5"><ShieldAlert className="h-8 w-8 text-bronze" /><p>Esta área é exclusiva para moderadores autorizados.</p><a href="/comunidade" className="text-sm font-semibold text-bronze">Voltar à comunidade</a></div></AppShell>;
  }

  return (
    <AppShell title="Moderação">
      <a href="/comunidade" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-bronze"><ArrowLeft className="h-4 w-4" /> Comunidade</a>
      <p className="mb-4 text-sm text-foreground/70">Denúncias privadas, ações reversíveis e histórico auditável. A prioridade considera o número de denúncias, mas nenhuma ação é automática.</p>
      {adminMembership && (
        <section className="mb-8 space-y-4 rounded-3xl border border-border bg-surface p-4">
          <div>
            <h2 className="text-lg font-bold">Equipe de moderação</h2>
            <p className="mt-1 text-sm text-foreground/70">Área exclusiva da administração. Para adicionar ou remover alguém, use o UUID da conta no Supabase. A permissão é validada novamente no banco.</p>
          </div>
          <label className="block text-sm font-semibold">UUID da conta
            <input value={moderatorUserId} onChange={(e) => setModeratorUserId(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" className="mt-1 w-full rounded-2xl border border-border bg-background p-3 font-mono text-sm font-normal outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={managingModerator || !moderatorUserId.trim()} onClick={() => void setModerator(moderatorUserId, true)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><UserPlus className="h-4 w-4" /> Adicionar</button>
            <button disabled={managingModerator || !moderatorUserId.trim()} onClick={() => void setModerator(moderatorUserId, false)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50"><UserMinus className="h-4 w-4" /> Remover</button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold">Moderadores atuais</h3>
            {loadingModerators && <p className="text-sm text-foreground/60">Carregando equipe…</p>}
            {moderatorsError && <p className="text-sm text-destructive">Não foi possível carregar a equipe.</p>}
            {!loadingModerators && !moderatorsError && moderators.length === 0 && <p className="text-sm text-foreground/60">Nenhum moderador cadastrado.</p>}
            {moderators.map((moderator) => (
              <div key={moderator.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border p-3">
                <code className="break-all text-xs">{moderator.user_id}</code>
                {moderator.user_id === user?.id && <span className="text-xs font-semibold text-foreground/60">Sua conta</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Fila de denúncias</h2><span className="rounded-full bg-blush px-3 py-1 text-sm font-semibold">{reports.length} pendentes</span></div>
        {loadingReports && <p className="text-sm text-foreground/60">Carregando denúncias…</p>}
        {reportsError && <p className="rounded-2xl bg-destructive/10 p-3 text-sm">Não foi possível carregar a fila. Verifique se a migração foi aplicada e se sua conta está autorizada.</p>}
        {!loadingReports && queue.length === 0 && <div className="rounded-3xl bg-surface p-5 text-sm text-foreground/70">Nenhuma denúncia pendente no momento.</div>}
        {queue.map(({ post, items }) => post && (
          <article key={post.id} className="space-y-3 rounded-3xl bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-bold">{post.author_name}</p><p className="text-xs text-foreground/50">{new Date(post.created_at).toLocaleString("pt-BR")}</p></div>
              <span className="shrink-0 rounded-full bg-blush px-3 py-1 text-xs font-bold">{items.length} {items.length === 1 ? "denúncia" : "denúncias"}</span>
            </div>
            <p className="whitespace-pre-line text-sm">{post.content}</p>
            {post.image_path && <p className="text-xs text-foreground/50">Esta publicação contém imagem.</p>}
            <p className="text-xs text-foreground/60">Status: {post.moderation_status}</p>
            <label className="block text-sm font-semibold">Motivo da decisão
              <textarea value={reasons[post.id] ?? ""} onChange={(e) => setReasons((prev) => ({ ...prev, [post.id]: e.target.value }))} rows={2} maxLength={1000} placeholder="Descreva brevemente a decisão…" className="mt-1 w-full rounded-2xl border border-border bg-background p-3 font-normal outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <div className="flex flex-wrap gap-2">
              {post.moderation_status === "visible" && <button disabled={busy === post.id} onClick={() => act(post.id, "hide")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"><EyeOff className="h-4 w-4" /> Ocultar</button>}
              {post.moderation_status !== "visible" && <button disabled={busy === post.id} onClick={() => act(post.id, "restore")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"><Eye className="h-4 w-4" /> Restaurar</button>}
              {post.moderation_status !== "removed" && <button disabled={busy === post.id} onClick={() => act(post.id, "remove")} className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-50"><Trash2 className="h-4 w-4" /> Remover logicamente</button>}
              <button disabled={busy === post.id} onClick={() => act(post.id, "dismiss_reports")} className="rounded-full border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">Arquivar denúncias</button>
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-bold">Publicações ocultas ou removidas</h2>
        {loadingHiddenPosts && <p className="text-sm text-foreground/60">Carregando publicações ocultas…</p>}
        {hiddenPostsError && <p className="rounded-2xl bg-destructive/10 p-3 text-sm">Não foi possível carregar as publicações ocultas ou removidas.</p>}
        {!loadingHiddenPosts && !hiddenPostsError && hiddenPosts.length === 0 && <p className="rounded-3xl bg-surface p-4 text-sm text-foreground/60">Não há publicações ocultas ou removidas.</p>}
        {hiddenPosts.map((post) => (
          <article key={post.id} className="space-y-2 rounded-3xl bg-surface p-4">
            <div className="flex items-center justify-between gap-3"><p className="font-semibold">{post.author_name}</p><span className="rounded-full bg-blush px-3 py-1 text-xs font-bold">{post.moderation_status === "hidden" ? "Oculta" : "Removida logicamente"}</span></div>
            <p className="whitespace-pre-line text-sm">{post.content}</p>
            <label className="block text-sm font-semibold">Motivo para a próxima ação
              <textarea value={reasons[post.id] ?? ""} onChange={(e) => setReasons((prev) => ({ ...prev, [post.id]: e.target.value }))} rows={2} maxLength={1000} placeholder="Informe o motivo…" className="mt-1 w-full rounded-2xl border border-border bg-background p-3 font-normal outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button disabled={busy === post.id} onClick={() => act(post.id, "restore")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"><Eye className="h-4 w-4" /> Restaurar</button>
              {post.moderation_status === "hidden" && <button disabled={busy === post.id} onClick={() => act(post.id, "remove")} className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 px-3 py-2 text-xs font-semibold text-destructive disabled:opacity-50"><Trash2 className="h-4 w-4" /> Remover logicamente</button>}
            </div>
          </article>
        ))}
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold"><History className="h-5 w-5" /> Histórico recente</h2>
        {history.length === 0 && <p className="rounded-3xl bg-surface p-4 text-sm text-foreground/60">As ações de moderação aparecerão aqui.</p>}
        {history.map((entry) => {
          const post = postById.get(entry.post_id);
          return <div key={entry.id} className="rounded-2xl bg-surface p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{({ hide: "Publicação ocultada", restore: "Publicação restaurada", remove: "Publicação removida logicamente", dismiss_reports: "Denúncias arquivadas" } as Record<string, string>)[entry.action] ?? entry.action}</p><span className="text-xs text-foreground/50">{new Date(entry.created_at).toLocaleString("pt-BR")}</span></div><p className="mt-1 text-sm text-foreground/70">{post?.content ?? "Publicação preservada no histórico"}</p><p className="mt-1 text-xs text-foreground/60">Motivo: {entry.reason}</p><p className="mt-1 text-xs text-foreground/60">Denúncias afetadas: {entry.reports_affected}</p></div>;
        })}
      </section>
    </AppShell>
  );
}
