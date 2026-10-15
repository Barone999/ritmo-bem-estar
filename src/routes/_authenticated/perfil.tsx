import { PregnancyDisclaimer, PregnancyFields } from "@/components/Pregnancy";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Flame, Pencil, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";
import { AppShell, Disclaimer } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/cycle";
import { uid, useCycle, useInvalidate, useProfile, useSessions } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/perfil")({
  head: () => ({ meta: [{ title: "Perfil — Muuvi" }, { name: "description", content: "Seu progresso e ajustes." }] }),
  component: Perfil,
});

function streak(dates: string[]) {
  const set = new Set(dates);
  const d = new Date();
  if (!set.has(fmtDate(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(fmtDate(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function Perfil() {
  const { data: profile } = useProfile();
  const { data: sessions = [] } = useSessions();
  const { data: cycle } = useCycle();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [days, setDays] = useState(3);
  const [cycleLen, setCycleLen] = useState(28);
  const [periodLen, setPeriodLen] = useState(5);
  const [pregnant, setPregnant] = useState(false);
  const [due, setDue] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  useEffect(() => { if (profile) { setName(profile.display_name); setDays(profile.days_per_week); setPregnant(profile.pregnant); setDue(profile.due_date ?? ""); setIsEditing(false); } }, [profile]);
  useEffect(() => { if (cycle) { setCycleLen(cycle.settings.cycle_length); setPeriodLen(cycle.settings.period_length); } }, [cycle]);

  const minutes = sessions.reduce((a, s) => a + s.minutes, 0);
  const st = streak(sessions.map((s) => fmtDate(new Date(s.completed_at))));

  async function save() {
    if (pregnant && !due) { toast.error("Informe as semanas ou a data prevista do parto."); return; }
    const id = await uid();
    // Cycle data is never touched here, so it is still there when she turns the mode off.
    await supabase.from("profiles").update({ display_name: name, days_per_week: days, pregnant, due_date: pregnant ? due : null }).eq("id", id);
    if (cycle && !cycle.isDemo) {
      await supabase.from("cycle_settings").update({ cycle_length: cycleLen, period_length: periodLen }).eq("user_id", id);
    }
    invalidate("profile", "cycle");
    toast.success("Ajustes salvos");
    setIsEditing(false);
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const input = "mt-1 w-full rounded-2xl bg-background px-4 py-3";

  return (
    <AppShell title="Perfil">
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: Flame, v: st, l: "dias seguidos", bg: "bg-blush" },
          { icon: Timer, v: minutes, l: "minutos", bg: "bg-sage" },
          { icon: Trophy, v: sessions.length, l: "treinos", bg: "bg-surface" },
        ].map(({ icon: I, v, l, bg }) => (
          <div key={l} className={`rounded-3xl p-4 text-center ${bg}`}>
            <I className="mx-auto h-5 w-5 text-bronze" />
            <p className="mt-1 font-display text-3xl font-bold text-ink">{v}</p>
            <p className="text-xs text-foreground/70">{l}</p>
          </div>
        ))}
      </div>

      <section className="mt-6 space-y-3 rounded-3xl bg-surface p-5">
        <h2 className="text-lg font-bold">Ajustes da conta</h2>
        <label className="block text-sm font-semibold">Nome<input className={input} value={name} onChange={(e) => setName(e.target.value)} disabled={!isEditing} /></label>
        <div>
          <p className="text-sm font-semibold">Treinos por semana</p>
          <div className="mt-1 grid grid-cols-7 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} onClick={() => setDays(n)} disabled={!isEditing} className={`rounded-xl py-2.5 text-sm font-bold disabled:cursor-default disabled:opacity-80 ${days === n ? "bg-primary text-primary-foreground" : "bg-background"}`}>{n}</button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-background p-4">
          <label className="flex items-center justify-between gap-3 font-semibold">
            <span>🤰 Estou grávida (Modo Gestante)</span>
            <input type="checkbox" className="h-6 w-6 accent-primary" checked={pregnant} onChange={(e) => setPregnant(e.target.checked)} disabled={!isEditing} />
          </label>
          {pregnant ? (
            <div className="mt-3 space-y-2">
              <PregnancyFields due={due} onChange={setDue} inputClass="w-full rounded-2xl bg-surface px-4 py-3" disabled={!isEditing} />
              <PregnancyDisclaimer />
            </div>
          ) : (
            profile?.pregnant && <p className="mt-2 text-xs text-foreground/70">Ao salvar, seu calendário do ciclo volta com os registros anteriores.</p>
          )}
        </div>
        {cycle && !cycle.isDemo && !pregnant && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold">Duração do ciclo<input type="number" className={input} value={cycleLen} onChange={(e) => setCycleLen(+e.target.value)} disabled={!isEditing} /></label>
            <label className="block text-sm font-semibold">Dias de menstruação<input type="number" className={input} value={periodLen} onChange={(e) => setPeriodLen(+e.target.value)} disabled={!isEditing} /></label>
          </div>
        )}
        <button onClick={() => { if (isEditing) void save(); else setIsEditing(true); }} className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground">{isEditing ? "Salvar alterações" : <><Pencil className="h-4 w-4" />Editar perfil</>}</button>
      </section>

      <Disclaimer className="mt-4" />
      <button onClick={signOut} className="mt-4 w-full rounded-full bg-ink py-3.5 font-bold text-ink-foreground">Sair</button>
    </AppShell>
  );
}
