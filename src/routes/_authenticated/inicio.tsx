import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Play, Clock, Sparkles, Heart, Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cycleDay, fmtDate, MOTIVATION, PHASES, PHASE_BG, phaseForDay, type Phase } from "@/lib/cycle";
import { uid, useCycle, useCycleLogs, useInvalidate, useProfile, useSessions } from "@/lib/data";
import { supabase } from "@/integrations/supabase/client";
import { describeWeek, LIGHT_WALK_WEEK, programProgress, totalMinutes } from "@/lib/program";
import { RECIPES } from "@/lib/recipes";
import { PregnancyDisclaimer, PregnancyStatus, PregnancyTip, PregnancyWorkout } from "@/components/Pregnancy";
import { PeriodReminder } from "@/components/PeriodReminder";

export const Route = createFileRoute("/_authenticated/inicio")({
  head: () => ({ meta: [{ title: "Início — Muuvi" }, { name: "description", content: "Seu treino de hoje, no seu ritmo." }] }),
  component: Inicio,
});

const ENERGY = ["Baixa", "Média", "Alta"] as const;
const MOODS = ["😔", "😐", "🙂", "😄"] as const;

const SYMPTOMS = ["Cólica", "Dor de cabeça", "Inchaço", "Cansaço", "Sensibilidade", "Nenhum"] as const;

function getRecipeSuggestions(phase: Phase | null, seed: number, pregnancyOnly = false) {
  const candidates = RECIPES.filter((recipe) => !pregnancyOnly || recipe.pregnancy);
  const matching = phase ? candidates.filter((recipe) => recipe.phases.includes(phase)) : candidates;
  const remaining = phase ? candidates.filter((recipe) => !recipe.phases.includes(phase)) : [];

  const rotate = <T,>(items: T[]) => {
    if (!items.length) return items;
    const offset = seed % items.length;
    return [...items.slice(offset), ...items.slice(0, offset)];
  };

  return [...rotate(matching), ...rotate(remaining)].slice(0, 5);
}

function RecipeCarousel({ recipes, title, subtitle }: { recipes: typeof RECIPES; title: string; subtitle: string }) {
  return (
    <section className="mt-5">
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
          <p className="mt-1 text-xs text-foreground/60">{subtitle}</p>
        </div>
        <Link to="/receitas" className="shrink-0 text-sm font-bold text-bronze underline">Ver todas</Link>
      </div>
      <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-3">
        {recipes.map((recipe) => (
          <Link
            key={recipe.id}
            to="/receitas"
            className="w-40 shrink-0 snap-start overflow-hidden rounded-3xl bg-surface transition active:scale-[0.98]"
          >
            <img src={recipe.image} alt={recipe.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            <div className="p-3">
              <p className="text-[11px] font-semibold text-bronze">{recipe.moment === "pre" ? "Pré-treino" : "Pós-treino"}</p>
              <p className="mt-1 line-clamp-2 min-h-10 font-display text-sm font-bold leading-tight text-ink">{recipe.title}</p>
              <p className="mt-2 flex items-center gap-1 text-xs text-foreground/60"><Clock className="h-3 w-3" /> {recipe.minutes} min</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Inicio() {
  const { data: profile } = useProfile();
  const { data: cycle } = useCycle();
  const { data: logs = [] } = useCycleLogs();
  const { data: sessions = [] } = useSessions();
  const invalidate = useInvalidate();
  const todayKey = fmtDate(new Date());
  const todayLog = logs.find((log) => log.log_date === todayKey);
  const [energy, setEnergy] = useState<string>("");
  const [mood, setMood] = useState<string>("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [savingCheckIn, setSavingCheckIn] = useState(false);
  const [isEditingCheckIn, setIsEditingCheckIn] = useState(true);

  useEffect(() => {
    setEnergy(todayLog?.energy ?? "");
    setMood(todayLog?.mood ?? "");
    setSymptoms(todayLog?.symptoms ?? []);
    if (todayLog) setIsEditingCheckIn(false);
  }, [todayLog?.log_date, todayLog?.energy, todayLog?.mood, todayLog?.symptoms?.join("|")]);

  if (!cycle || !profile) return <AppShell><div className="h-40 animate-pulse rounded-3xl bg-surface" /></AppShell>;

  const day = cycle.isDemo ? null : cycleDay(new Date(), cycle.settings);
  const phase = day == null ? null : phaseForDay(day, cycle.settings);
  const info = phase ? PHASES[phase] : null;
  const recipeSeed = Number(todayKey.replaceAll("-", ""));
  const recipeSuggestions = getRecipeSuggestions(phase, recipeSeed, !!profile.pregnant);

  if (profile.pregnant && profile.due_date) {
    return (
      <AppShell title={`Oi, ${profile.display_name} 👋`}>
        <PregnancyStatus due={profile.due_date} />
        <PregnancyTip />
        <PregnancyWorkout due={profile.due_date} />
        <RecipeCarousel recipes={recipeSuggestions} title="Ideias para nutrir seu dia" subtitle="Sugestões para a gestação" />
        <PregnancyDisclaimer className="mt-4" />
      </AppShell>
    );
  }
  const perWeek = profile.days_per_week ?? 3;
  const { current, nextSession } = programProgress(sessions, perWeek);
  const reportedSymptoms = symptoms.filter((s) => s !== "Nenhum");
  const lowEnergy = energy === "Baixa" || reportedSymptoms.some((s) => ["Cólica", "Dor de cabeça", "Cansaço"].includes(s));
  const hasReadinessCheckIn = !!energy || reportedSymptoms.length > 0;
  const light = lowEnergy || (!hasReadinessCheckIn && info?.workoutHint === "light");
  const quote = MOTIVATION[new Date().getDate() % MOTIVATION.length];

  async function saveCheckIn() {
    setSavingCheckIn(true);
    try {
      const id = await uid();
      const { error } = await supabase.from("cycle_logs").upsert({
      user_id: id,
      log_date: todayKey,
      period_start: todayLog?.period_start ?? false,
      period_ended: todayLog?.period_ended ?? false,
      flow: todayLog?.flow ?? null,
      energy: energy || null,
      mood: mood || null,
      symptoms,
      }, { onConflict: "user_id,log_date" });
      if (error) {
        toast.error("Não foi possível salvar seu check-in. Tente novamente.");
        return;
      }
      invalidate("cycle_logs");
      setIsEditingCheckIn(false);
      toast.success("Check-in salvo 💛");
    } catch {
      toast.error("Não foi possível salvar seu check-in. Tente novamente.");
    } finally {
      setSavingCheckIn(false);
    }
  }

  function handleCheckInButton() {
    if (!isEditingCheckIn) {
      setIsEditingCheckIn(true);
      return;
    }
    void saveCheckIn();
  }

  function toggleSymptom(value: string) {
    setSymptoms((current) => {
      if (value === "Nenhum") return current.includes("Nenhum") ? [] : ["Nenhum"];
      const withoutNone = current.filter((s) => s !== "Nenhum");
      return withoutNone.includes(value) ? withoutNone.filter((s) => s !== value) : [...withoutNone, value];
    });
  }

  const chip = (active: boolean) =>
    `rounded-full px-3.5 py-2 text-sm font-semibold transition ${active ? "bg-ink text-ink-foreground" : "bg-background text-foreground"}`;

  const suggestionText = lowEnergy
    ? "Seu check-in sugere pegar mais leve hoje. Uma caminhada tranquila é uma opção; se precisar, descansar também conta."
    : hasReadinessCheckIn
      ? "Vamos considerar como você se sente hoje. Siga no seu ritmo e ajuste ou pare se sentir desconforto."
      : info?.recommendation ?? "Registre sua energia e seus sintomas para receber uma sugestão mais alinhada ao seu dia.";

  return (
    <AppShell title={`Oi, ${profile.display_name ?? ""} 👋`}>
      {info ? (
        <section className={`rounded-3xl p-5 ${PHASE_BG[phase!]}`}>
          <p className="text-sm font-semibold text-ink/70">Dia {day} do ciclo</p>
          <h2 className="mt-1 text-2xl font-bold">{info.name}</h2>
          <p className="mt-2 text-sm text-ink/80">{info.feeling}</p>
          <Link to="/ciclo" className="mt-3 inline-block text-xs font-bold text-ink underline">Ver meu calendário</Link>
        </section>
      ) : (
        <section className="rounded-3xl bg-blush p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Heart className="h-4 w-4" /> Seu ritmo, suas escolhas</p>
          <h2 className="mt-1 text-xl font-bold text-ink">Seu ciclo é opcional</h2>
          <p className="mt-2 text-sm text-ink/80">Você pode usar o Muuvi sem registrar seu ciclo. Por enquanto, vamos personalizar suas sugestões pelo que você conta sobre como está hoje.</p>
          <Link to="/ciclo" className="mt-3 inline-block text-xs font-bold text-ink underline">Conhecer o acompanhamento do ciclo</Link>
        </section>
      )}

      <PeriodReminder />

      <section className="mt-4 rounded-3xl bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-bronze"><Heart className="h-4 w-4" /> Check-in de hoje</p>
        <h2 className="mt-1 text-xl font-bold">Como você está se sentindo?</h2>
        <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isEditingCheckIn ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
          <div className="min-h-0 overflow-hidden">
            <p className="mt-1 text-sm text-foreground/70">Sua resposta ajuda a adaptar a sugestão. É rapidinho e só você vê.</p>
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Energia</p>
              <div className="flex flex-wrap gap-2">{ENERGY.map((value) => <button key={value} disabled={!isEditingCheckIn} onClick={() => setEnergy(energy === value ? "" : value)} className={`${chip(energy === value)} disabled:cursor-default disabled:opacity-80`}>{value}</button>)}</div>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Humor</p>
              <div className="flex gap-2">{MOODS.map((value) => <button key={value} disabled={!isEditingCheckIn} aria-label={`Humor ${value}`} onClick={() => setMood(mood === value ? "" : value)} className={`${chip(mood === value)} text-xl disabled:cursor-default disabled:opacity-80`}>{value}</button>)}</div>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Algum sintoma hoje?</p>
              <div className="flex flex-wrap gap-2">{SYMPTOMS.map((value) => <button key={value} disabled={!isEditingCheckIn} onClick={() => toggleSymptom(value)} className={`${chip(symptoms.includes(value))} disabled:cursor-default disabled:opacity-80`}>{value}</button>)}</div>
            </div>
            <button disabled={savingCheckIn} onClick={handleCheckInButton} className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground transition disabled:opacity-60">
              <Check className="h-4 w-4" />
              {savingCheckIn ? "Salvando..." : todayLog ? "Salvar alterações" : "Salvar registro"}
            </button>
          </div>
        </div>
        {!isEditingCheckIn && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-ink-foreground"><Check className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Registro salvo para hoje</p>
                <p className="truncate text-xs text-foreground/60">
                  {[energy && `Energia ${energy.toLowerCase()}`, mood, symptoms.filter((s) => s !== "Nenhum").join(", ")].filter(Boolean).join(" · ") || "Check-in registrado"}
                </p>
              </div>
            </div>
            <button onClick={handleCheckInButton} className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-ink-foreground transition">
              <Pencil className="h-4 w-4" /> Editar
            </button>
          </div>
        )}
      </section>

      <section className="mt-4 rounded-3xl bg-ink p-6 text-ink-foreground">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-3.5 w-3.5" /> Sugestão para hoje
        </p>
        <h3 className="mt-2 text-2xl font-bold text-ink-foreground">
          {light ? "Caminhada leve" : `Semana ${current.week} · Treino ${nextSession}`}
        </h3>
        <p className="mt-1 text-sm text-ink-foreground/75">
          {light ? describeWeek(LIGHT_WALK_WEEK) : describeWeek(current.week)}
        </p>
        <p className="mt-1 flex items-center gap-1 text-sm text-ink-foreground/60">
          <Clock className="h-3.5 w-3.5" /> {totalMinutes(light ? 0 : current.week)} min
        </p>
        <p className="mt-3 text-sm text-ink-foreground/85">{suggestionText}</p>
        <Link
          to="/treino/$week/$session"
          params={{ week: String(light ? 0 : current.week), session: String(light ? 0 : nextSession) }}
          className="mt-5 flex items-center justify-center gap-2 rounded-full bg-primary py-4 font-bold text-primary-foreground"
        >
          <Play className="h-5 w-5 fill-current" /> Começar
        </Link>
        <div className="mt-3 flex justify-center gap-4 text-sm font-semibold">
          {light && (
            <Link to="/treino/$week/$session" params={{ week: String(current.week), session: String(nextSession) }} className="text-ink-foreground/70 underline">
              Fazer o treino do programa
            </Link>
          )}
          <Link to="/treinos" className="text-ink-foreground/70 underline">Escolher outro treino</Link>
        </div>
      </section>

      <RecipeCarousel
        recipes={recipeSuggestions}
        title="Ideias para nutrir seu dia"
        subtitle={phase ? `Sugestões para a fase ${info?.short ?? info?.name ?? "atual"}` : "Deslize para descobrir opções rápidas"}
      />

      <p className="mt-6 rounded-3xl bg-sage p-5 text-center font-display text-lg font-semibold text-ink">“{quote}”</p>
    </AppShell>
  );
}
