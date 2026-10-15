import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Check, Pencil, Heart } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { cycleDay, endsToClear, fmtDate, FLOW_LEVELS, observedLength, periodStartFor, PHASES, PHASE_BG, phaseForDay, referenceAfterRemoval, toDateOnly, toggleFlow, type Phase } from "@/lib/cycle";
import { uid, useCycle, useCycleLogs, useInvalidate, useProfile, useSessions } from "@/lib/data";
import { PregnancyDisclaimer, PregnancyStatus, PregnancyTip } from "@/components/Pregnancy";
import { TRIMESTERS } from "@/lib/pregnancy";

export const Route = createFileRoute("/_authenticated/ciclo")({
  head: () => ({ meta: [{ title: "Ciclo — Muuvi" }, { name: "description", content: "Seu calendário do ciclo." }] }),
  component: Ciclo,
});

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const ENERGY = ["Baixa", "Média", "Alta"];
const MOOD = ["😔", "😐", "🙂", "😄"];
const SYMPTOMS = ["Cólica", "Dor de cabeça", "Inchaço", "Cansaço", "Sensibilidade", "Nenhum"];

function Ciclo() {
  const { data: profile } = useProfile();
  if (profile?.pregnant && profile.due_date) return <Gestacao due={profile.due_date} />;
  return <CicloView />;
}

function Gestacao({ due }: { due: string }) {
  return (
    <AppShell title="Gestação">
      <PregnancyStatus due={due} />
      <PregnancyTip />
      <section className="mt-4 space-y-3">
        {([1, 2, 3] as const).map((n) => (
          <div key={n} className="rounded-3xl bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-bronze">{TRIMESTERS[n].range}</p>
            <h3 className="text-lg font-bold">{TRIMESTERS[n].name}</h3>
            <p className="mt-1 text-sm text-foreground/80">{TRIMESTERS[n].body}</p>
            <p className="mt-2 text-sm text-foreground/70"><b>Movimento:</b> {TRIMESTERS[n].workout}</p>
          </div>
        ))}
      </section>
      <p className="mt-4 rounded-2xl bg-blush p-3 text-sm">Seus registros de ciclo continuam guardados e voltam quando você desativar o Modo Gestante no Perfil.</p>
      <PregnancyDisclaimer className="mt-4" />
    </AppShell>
  );
}

function CicloView() {
  const { data: cycle } = useCycle();
  const { data: logs = [] } = useCycleLogs();
  const { data: sessions = [] } = useSessions();
  const invalidate = useInvalidate();
  const today = toDateOnly(new Date());
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [monthDirection, setMonthDirection] = useState<"left" | "right">("left");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const changeMonth = (direction: number) => {
    setMonthDirection(direction > 0 ? "left" : "right");
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + direction, 1));
  };

  const workoutDays = useMemo(() => new Set(sessions.map((s) => fmtDate(new Date(s.completed_at)))), [sessions]);
  const logMap = useMemo(() => new Map(logs.map((l) => [l.log_date, l])), [logs]);

  if (!cycle) return <AppShell title="Ciclo"><div className="h-80 animate-pulse rounded-3xl bg-surface" /></AppShell>;
  const s = cycle.settings;

  const first = month.getDay();
  const daysIn = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysIn }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];

  const selDay = cycleDay(selected, s)!;
  const selPhase = phaseForDay(selDay, s);
  const selKey = fmtDate(selected);
  const selLog = logMap.get(selKey);

  return (
    <AppShell title="Ciclo">
      {cycle.isDemo && (
        <p className="mb-3 rounded-2xl bg-blush p-3 text-sm">
          Você está vendo um exemplo. Registre o início da sua menstruação abaixo para personalizar.
        </p>
      )}
      <section
        data-no-page-swipe
        className="touch-pan-y rounded-3xl bg-surface p-4"
        onTouchStart={(e) => {
          const touch = e.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          const touch = e.changedTouches[0];
          touchStart.current = null;
          if (!start || !touch) return;
          const deltaX = touch.clientX - start.x;
          const deltaY = touch.clientY - start.y;
          if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;
          const direction = deltaX < 0 ? 1 : -1;
          changeMonth(direction);
        }}
        onTouchCancel={() => { touchStart.current = null; }}
      >
        <div key={`${month.getFullYear()}-${month.getMonth()}`} className={`calendar-month-transition calendar-month-transition-${monthDirection}`}>
        <div className="mb-3 flex items-center justify-between">
          <button aria-label="Mês anterior" onClick={() => changeMonth(-1)} className="grid h-9 w-9 place-items-center rounded-full bg-background">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-bold">{MONTHS[month.getMonth()]} {month.getFullYear()}</h2>
          <button aria-label="Próximo mês" onClick={() => changeMonth(1)} className="grid h-9 w-9 place-items-center rounded-full bg-background">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-foreground/50">
          {WEEKDAYS.map((w, i) => <span key={i}>{w}</span>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={i} />;
            const ph = phaseForDay(cycleDay(d, s)!, s);
            const key = fmtDate(d);
            const isSel = key === selKey;
            const isToday = key === fmtDate(today);
            const future = d > today;
            return (
              <button
                key={i}
                onClick={() => setSelected(d)}
                className={`relative aspect-square rounded-2xl text-sm font-semibold ${PHASE_BG[ph]} ${future ? "opacity-55" : ""} ${isSel ? "ring-2 ring-ink" : ""}`}
              >
                <span className={isToday ? "underline decoration-2 underline-offset-2" : ""}>{d.getDate()}</span>
                {workoutDays.has(key) && (
                  <span className="absolute right-1 bottom-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-ink">
                    <Check className="h-2.5 w-2.5 text-ink-foreground" />
                  </span>
                )}
                {logMap.get(key)?.period_start && <span className="absolute top-1 left-1 h-1.5 w-1.5 rounded-full bg-ink" />}
                {logMap.get(key)?.sexual_activity === true && <Heart aria-label="Relação sexual registrada" className="absolute bottom-1 left-1 h-3 w-3 fill-current text-rose-500" />}
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          {(Object.keys(PHASES) as Phase[]).map((p) => (
            <span key={p} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${PHASE_BG[p]}`} />{PHASES[p].short}</span>
          ))}
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-ink" />Treino feito</span>
          <span className="flex items-center gap-2"><Heart className="h-3 w-3 fill-current text-rose-500" />Relação sexual</span>
          <span className="flex items-center gap-2 opacity-60">Dias claros = previsão</span>
        </div>
        </div>
      </section>

      <section className={`mt-4 rounded-3xl p-5 ${PHASE_BG[selPhase]}`}>
        <p className="text-sm font-semibold text-ink/70">
          {selected.getDate()} de {MONTHS[selected.getMonth()]!.toLowerCase()} · dia {selDay} do ciclo
        </p>
        <h3 className="mt-1 text-2xl font-bold">{PHASES[selPhase].name}</h3>
        <p className="mt-2 text-sm"><strong>Como o corpo pode estar:</strong> {PHASES[selPhase].feeling}</p>
        <p className="mt-2 text-sm"><strong>Sugestão de treino:</strong> {PHASES[selPhase].recommendation}</p>
        <p className="mt-2 text-xs text-ink/60">É só uma sugestão — você sempre pode escolher outro treino.</p>
      </section>

      {selected <= today && (
        <LogForm
          key={selKey}
          dateKey={selKey}
          initial={selLog}
          starts={logs.filter((l) => l.period_start).map((l) => l.log_date)}
          ends={logs.filter((l) => l.period_ended).map((l) => l.log_date)}
          onSaved={() => invalidate("cycle_logs", "cycle")}
        />
      )}
    </AppShell>
  );
}

type Log = { period_start: boolean; period_ended: boolean; flow: string | null; energy: string | null; mood: string | null; symptoms: string[]; sexual_activity: boolean | null };

function LogForm({ dateKey, initial, starts, ends, onSaved }: { dateKey: string; initial?: Log | undefined; starts: string[]; ends: string[]; onSaved: () => void }) {
  const [periodStart, setPeriodStart] = useState(initial?.period_start ?? false);
  const [periodEnded, setPeriodEnded] = useState(initial?.period_ended ?? false);
  const [flow, setFlow] = useState<string | null>(initial?.flow ?? null);
  const [energy, setEnergy] = useState(initial?.energy ?? "");
  const [mood, setMood] = useState(initial?.mood ?? "");
  const [symptoms, setSymptoms] = useState<string[]>(initial?.symptoms ?? []);
  const [sexualActivity, setSexualActivity] = useState<boolean | null>(initial?.sexual_activity ?? null);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(!initial);
  const [hasSaved, setHasSaved] = useState(!!initial);
  const realStart = periodStart ? dateKey : periodStartFor(dateKey, starts.filter((d) => d !== dateKey));
  const canEnd = !!realStart && !periodStart;
  const nextStart = realStart ? starts.filter((d) => d > realStart).sort()[0] : undefined;
  const recordedEnd = realStart
    ? ends.filter((d) => d >= realStart && (!nextStart || d < nextStart)).sort()[0]
    : undefined;
  const periodEnd = periodEnded ? dateKey : recordedEnd;
  // Show flow only for dates covered by an explicitly recorded menstrual period.
  // Hiding the control does not clear the saved flow value.
  const isPeriodDay =
    !!realStart &&
    dateKey >= realStart &&
    (!periodEnd || dateKey <= periodEnd) &&
    (!nextStart || dateKey < nextStart);

  async function save() {
    setSaving(true);
    const id = await uid();
    const ended = canEnd && periodEnded;
    const { error } = await supabase.from("cycle_logs").upsert(
      { user_id: id, log_date: dateKey, period_start: periodStart, period_ended: ended, flow, energy: energy || null, mood: mood || null, symptoms, sexual_activity: sexualActivity },
      { onConflict: "user_id,log_date" },
    );
    if (!error && ended && realStart) {
      await supabase.from("cycle_settings").update({
        period_length: observedLength(realStart, dateKey),
      }).eq("user_id", id);
      const clear = endsToClear(realStart, dateKey, starts, ends);
      if (clear.length) await supabase.from("cycle_logs").update({ period_ended: false }).eq("user_id", id).in("log_date", clear);
    }
    if (!error && periodStart) {
      const { data: cur } = await supabase.from("cycle_settings").select("*").eq("user_id", id).maybeSingle();
      if (!cur?.last_period_start || cur.last_period_start < dateKey) {
        await supabase.from("cycle_settings").upsert({
          user_id: id,
          last_period_start: dateKey,
          cycle_length: cur?.cycle_length ?? 28,
          period_length: cur?.period_length ?? 5,
        });
      }
    }
    if (!error && !periodStart && initial?.period_start) {
      // Unmarked by mistake: move the reference back to the latest remaining start.
      const [{ data: cur }, { data: starts }] = await Promise.all([
        supabase.from("cycle_settings").select("*").eq("user_id", id).maybeSingle(),
        supabase.from("cycle_logs").select("log_date").eq("user_id", id).eq("period_start", true),
      ]);
      if (cur) {
        const next = referenceAfterRemoval(cur.last_period_start, dateKey, (starts ?? []).map((r) => r.log_date));
        if (next !== cur.last_period_start) {
          await supabase.from("cycle_settings").update({ last_period_start: next }).eq("user_id", id);
        }
      }
    }
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar."); return; }
    toast.success("Registro salvo 💛");
    setHasSaved(true);
    setIsEditing(false);
    onSaved();
  }

  const chip = (on: boolean) => `rounded-full px-4 py-2 text-sm font-semibold ${on ? "bg-ink text-ink-foreground" : "bg-background"}`;

  return (
    <section className="mt-4 rounded-3xl bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Como você se sentiu?</h3>
          {!isEditing && <p className="mt-1 text-sm text-foreground/60">Registro salvo para este dia.</p>}
        </div>
        {!isEditing && <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-ink-foreground"><Check className="h-4 w-4" /></span>}
      </div>
      {!isEditing && canEnd && !periodEnded && (
        <button
          type="button"
          onClick={() => { setPeriodEnded(true); setIsEditing(true); }}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl bg-sage px-4 py-3 text-left font-semibold text-ink"
        >
          <span>Minha menstruação terminou neste dia</span>
          <span className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-bold">Registrar</span>
        </button>
      )}
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${isEditing ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="mt-4 space-y-4">
      <label className="flex items-center justify-between rounded-2xl bg-blush px-4 py-3">
        <span className="font-semibold">Minha menstruação começou neste dia</span>
        <input type="checkbox" disabled={!isEditing} checked={periodStart} onChange={(e) => setPeriodStart(e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" />
      </label>
      {canEnd ? (
        <div>
          <label className="flex items-center justify-between rounded-2xl bg-sage px-4 py-3">
            <span className="font-semibold">Minha menstruação terminou neste dia</span>
            <input type="checkbox" disabled={!isEditing} checked={periodEnded} onChange={(e) => setPeriodEnded(e.target.checked)} className="h-5 w-5 accent-[var(--primary)]" />
          </label>
          {periodEnded && realStart && (
            <p className="mt-2 text-xs text-foreground/70">
              Duração observada: {observedLength(realStart, dateKey)} dias (início em {realStart.split("-").reverse().join("/")}). Se a data estiver errada, desmarque aqui e marque o dia certo.
            </p>
          )}
        </div>
      ) : !periodStart && (
        <p className="rounded-2xl bg-background px-4 py-3 text-xs text-foreground/70">
          Para registrar o fim da menstruação, primeiro marque o dia em que ela começou.
        </p>
      )}
      {isPeriodDay && (
        <div>
          <p className="text-sm font-semibold">Fluxo menstrual</p>
          <p className="mb-2 text-xs text-foreground/60">Qual foi a intensidade do seu fluxo hoje? Toque de novo para remover.</p>
          <div className="flex flex-wrap gap-2">{FLOW_LEVELS.map((f) => <button key={f} disabled={!isEditing} onClick={() => setFlow(toggleFlow(flow, f))} className={`${chip(flow === f)} disabled:cursor-default disabled:opacity-80`}>{f}</button>)}</div>
        </div>
      )}
      <div>
        <p className="mb-2 text-sm font-semibold">Energia</p>
        <div className="flex flex-wrap gap-2">{ENERGY.map((e) => <button key={e} disabled={!isEditing} onClick={() => setEnergy(e)} className={`${chip(energy === e)} disabled:cursor-default disabled:opacity-80`}>{e}</button>)}</div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Humor</p>
        <div className="flex gap-2">{MOOD.map((m) => <button key={m} disabled={!isEditing} onClick={() => setMood(m)} className={`${chip(mood === m)} text-xl disabled:cursor-default disabled:opacity-80`}>{m}</button>)}</div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold">Sintomas</p>
        <div className="flex flex-wrap gap-2">
          {SYMPTOMS.map((x) => (
            <button key={x} disabled={!isEditing} onClick={() => setSymptoms(symptoms.includes(x) ? symptoms.filter((y) => y !== x) : [...symptoms, x])} className={`${chip(symptoms.includes(x))} disabled:cursor-default disabled:opacity-80`}>{x}</button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl bg-blush/60 p-4">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-rose-500" />
          <p className="text-sm font-semibold">Relação sexual</p>
        </div>
        <p className="mb-3 mt-1 text-xs text-foreground/60">Registre se houve relação neste dia. Você também pode preencher ou corrigir datas anteriores.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!isEditing} onClick={() => setSexualActivity(true)} className={`${chip(sexualActivity === true)} disabled:cursor-default disabled:opacity-80`}>Sim</button>
          <button type="button" disabled={!isEditing} onClick={() => setSexualActivity(false)} className={`${chip(sexualActivity === false)} disabled:cursor-default disabled:opacity-80`}>Não</button>
          <button type="button" disabled={!isEditing} onClick={() => setSexualActivity(null)} className={`${chip(sexualActivity === null)} disabled:cursor-default disabled:opacity-80`}>Não registrado</button>
        </div>
      </div>
      <button disabled={saving} onClick={() => {
        if (hasSaved && !isEditing) { setIsEditing(true); return; }
        void save();
      }} className={`mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 font-bold transition disabled:opacity-60 ${hasSaved && !isEditing ? "bg-ink text-ink-foreground" : "bg-primary text-primary-foreground"}`}>
        {saving ? "Salvando..." : hasSaved && !isEditing ? <><Pencil className="h-4 w-4" /> Editar registro</> : <><Check className="h-4 w-4" /> {hasSaved ? "Salvar alterações" : "Salvar registro"}</>}
      </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-foreground/60">🔒 Seus dados do ciclo são privados e nunca aparecem na comunidade.</p>
    </section>
  );
}
