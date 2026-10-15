import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Heart, MessageCircle, Flag, ImagePlus, Send, X, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { moderationDb, type ModeratorRow } from "@/lib/moderation-db";
import { uid, useInvalidate, useProfile, useUser } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/comunidade")({
  head: () => ({ meta: [{ title: "Comunidade — Muuvi" }, { name: "description", content: "Relatos e apoio entre corredoras." }] }),
  component: Comunidade,
});

function usePosts() {
  return useQuery({
    queryKey: ["posts"],
    queryFn: async () => {
      // Moderators can read hidden posts for review, so explicitly keep the public feed visible-only.
      const { data: moderatedPosts, error: moderationFilterError } = await moderationDb
        .from("posts")
        .select("*")
        .eq("moderation_status", "visible")
        .order("created_at", { ascending: false })
        .limit(50);

      let posts = moderatedPosts as Array<{
        id: string; user_id: string; author_name: string; content: string;
        created_at: string; image_path: string | null; image_url: string | null;
      }> | null;

      // Keep the community usable before the reviewed migration is deployed. Only fall back
      // when the moderation column itself is missing; other errors must not bypass the filter.
      if (
        moderationFilterError &&
        (moderationFilterError.code === "42703" ||
          moderationFilterError.message?.includes("moderation_status"))
      ) {
        const fallback = await supabase
          .from("posts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        if (fallback.error) throw fallback.error;
        posts = fallback.data;
      } else if (moderationFilterError) {
        throw moderationFilterError;
      }
      const ids = (posts ?? []).map((p) => p.id);
      const [{ data: likes }, { data: comments }] = await Promise.all([
        supabase.from("post_likes").select("*").in("post_id", ids),
        supabase.from("post_comments").select("*").in("post_id", ids).order("created_at"),
      ]);
      const paths = (posts ?? []).filter((p) => p.image_path).map((p) => p.image_path!);
      const signed = paths.length ? (await supabase.storage.from("post-images").createSignedUrls(paths, 3600)).data ?? [] : [];
      const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl]));
      return (posts ?? []).map((p) => ({
        ...p,
        img: p.image_path ? urlFor.get(p.image_path) ?? null : p.image_url,
        likes: (likes ?? []).filter((l) => l.post_id === p.id),
        comments: (comments ?? []).filter((c) => c.post_id === p.id),
      }));
    },
  });
}

function timeAgo(s: string) {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

function Comunidade() {
  const { data: posts = [] } = usePosts();
  const { data: user } = useUser();
  const { data: profile } = useProfile();
  const { data: moderator } = useQuery({
    queryKey: ["community-moderator", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await moderationDb.from("community_moderators").select("user_id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return (data ?? null) as ModeratorRow | null;
    },
  });
  const invalidate = useInvalidate();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const name = profile?.display_name ?? "Corredora";

  async function publish() {
    if (!text.trim()) return;
    setPosting(true);
    const user_id = await uid();
    let image_path: string | null = null;
    if (file) {
      const path = `${user_id}/${Date.now()}-${file.name.replace(/[^\w.]/g, "")}`;
      const { error } = await supabase.storage.from("post-images").upload(path, file);
      if (error) { setPosting(false); toast.error("Falha ao enviar a imagem."); return; }
      image_path = path;
    }
    const { error } = await supabase.from("posts").insert({ user_id, author_name: name, content: text.trim(), image_path });
    setPosting(false);
    if (error) { toast.error("Não foi possível publicar."); return; }
    setText(""); setFile(null);
    invalidate("posts");
  }

  async function like(postId: string, liked: boolean) {
    const user_id = await uid();
    if (liked) await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", user_id);
    else await supabase.from("post_likes").insert({ post_id: postId, user_id });
    invalidate("posts");
  }

  async function report(postId: string) {
    const user_id = await uid();
    const { error } = await supabase.from("post_reports").insert({ post_id: postId, user_id, reason: "inadequado" });
    toast(error ? "Você já denunciou esta publicação." : "Obrigada por avisar. Vamos analisar com cuidado.");
  }

  return (
    <AppShell title="Comunidade">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-foreground/70">Um espaço de apoio. Celebre cada passo — o seu e o das outras. 💛</p>
        {moderator && <a href="/comunidade/moderacao" className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-semibold text-bronze"><ShieldCheck className="h-4 w-4" /> Moderação</a>}
      </div>
      <section className="rounded-3xl bg-surface p-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Conte como foi seu treino..." className="w-full resize-none bg-transparent outline-none placeholder:text-foreground/50" />
        {file && (
          <div className="mb-2 flex items-center gap-2 rounded-2xl bg-sage px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button aria-label="Remover imagem" onClick={() => setFile(null)}><X className="h-4 w-4" /></button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-sm font-semibold text-bronze"><ImagePlus className="h-5 w-5" /> Foto</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button disabled={posting || !text.trim()} onClick={publish} className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50">
            {posting ? "Publicando..." : "Publicar"}
          </button>
        </div>
      </section>

      <div className="mt-4 space-y-4">
        {posts.map((p) => (
          <PostCard key={p.id} post={p} me={user?.id} myName={name} onLike={like} onReport={report} onComment={() => invalidate("posts")} />
        ))}
      </div>
    </AppShell>
  );
}

type Post = ReturnType<typeof usePosts>["data"] extends (infer T)[] | undefined ? T : never;

function PostCard({ post, me, myName, onLike, onReport, onComment }: {
  post: Post; me?: string | undefined; myName: string;
  onLike: (id: string, liked: boolean) => void; onReport: (id: string) => void; onComment: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState("");
  const liked = post.likes.some((l) => l.user_id === me);

  async function send() {
    if (!c.trim()) return;
    const user_id = await uid();
    await supabase.from("post_comments").insert({ post_id: post.id, user_id, author_name: myName, content: c.trim() });
    setC(""); onComment();
  }

  return (
    <article className="overflow-hidden rounded-3xl bg-surface">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-blush font-bold text-ink">{post.author_name[0]}</span>
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{post.author_name}</p>
          <p className="text-xs text-foreground/50">há {timeAgo(post.created_at)}</p>
        </div>
        {post.user_id !== me && (
          <button aria-label="Denunciar" onClick={() => onReport(post.id)} className="text-foreground/40"><Flag className="h-4 w-4" /></button>
        )}
      </div>
      <p className="px-4 pb-3 whitespace-pre-line">{post.content}</p>
      {post.img && <img src={post.img} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />}
      <div className="flex gap-5 px-4 py-3 text-sm font-semibold">
        <button onClick={() => onLike(post.id, liked)} className="flex items-center gap-1.5">
          <Heart className={`h-5 w-5 ${liked ? "fill-primary text-primary" : ""}`} /> {post.likes.length}
        </button>
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5">
          <MessageCircle className="h-5 w-5" /> {post.comments.length}
        </button>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {post.comments.map((cm) => (
            <p key={cm.id} className="text-sm"><strong className="text-ink">{cm.author_name}</strong> {cm.content}</p>
          ))}
          <div className="flex gap-2">
            <input value={c} onChange={(e) => setC(e.target.value)} placeholder="Deixe uma palavra de apoio..." className="min-w-0 flex-1 rounded-full bg-background px-4 py-2 text-sm outline-none" />
            <button aria-label="Enviar" onClick={send} className="grid h-9 w-9 place-items-center rounded-full bg-primary"><Send className="h-4 w-4 text-primary-foreground" /></button>
          </div>
        </div>
      )}
    </article>
  );
}
