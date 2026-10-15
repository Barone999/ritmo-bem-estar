import { Link } from "@tanstack/react-router";
import { Clock, Droplets, Play, Sparkles } from "lucide-react";
import { useState } from "react";
import { dailyTip, dueDateFromWeeks, gestation, TRIMESTERS, type Trimester } from "@/lib/pregnancy";
import { describeWeek, pregnancyWeek, totalMinutes } from "@/lib/program";

export function PregnancyDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`rounded-2xl bg-sage p-3 text-xs text-ink/80 ${className}`}>
      Na gestação, faça exercícios apenas com liberação do seu obstetra. As sugestões do Muuvi são informativas e não substituem orientação médica.
    </p>
  );
}

export function PregnancyStatus({ due }: { due: string }) {
  const g = gestation(due);
  const t = TRIMESTERS[g.trimester];
  return (
    <section className={`rounded-3xl p-6 ${t.bg}`}>
      <p className="text-sm font-semibold text-ink/70">Modo Gestante · {t.name}</p>
      <h2 className="mt-1 text-3xl font-bold">Semana {g.week}</h2>
      <p className="text-sm text-ink/70">Dia {g.dayOfWeek} da semana · faltam cerca de {Math.ceil(g.daysLeft / 7)} semanas</p>
      <p className="mt-3 text-sm text-ink/80">{t.body}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {([1, 2, 3] as Trimester[]).map((n) => (
          <div key={n} className={`rounded-2xl px-2 py-2 text-center text-xs font-bold ${n === g.trimester ? "bg-ink text-ink-foreground" : "bg-background/70 text-ink/70"}`}>
            {n}º tri
          </div>
        ))}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background/60">
        <div className="h-full rounded-full bg-bronze" style={{ width: `${Math.min(100, (g.week / 40) * 100)}%` }} />
      </div>
    </section>
  );
}

export function PregnancyTip() {
  return (
    <p className="mt-4 flex items-start gap-3 rounded-3xl bg-blush p-5 text-sm text-ink">
      <Droplets className="mt-0.5 h-5 w-5 shrink-0 text-bronze" />
      <span><b>Para hoje:</b> {dailyTip()}</span>
    </p>
  );
}

export function PregnancyWorkout({ due }: { due: string }) {
  const g = gestation(due);
  const w = pregnancyWeek(g.trimester);
  return (
    <section className="mt-4 rounded-3xl bg-ink p-6 text-ink-foreground">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
        <Sparkles className="h-3.5 w-3.5" /> Sugestão para hoje
      </p>
      <h3 className="mt-2 text-2xl font-bold text-ink-foreground">Caminhada no seu ritmo</h3>
      <p className="mt-1 text-sm text-ink-foreground/75">{describeWeek(w)}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-ink-foreground/60"><Clock className="h-3.5 w-3.5" /> {totalMinutes(w)} min</p>
      <p className="mt-3 text-sm text-ink-foreground/85">{TRIMESTERS[g.trimester].workout}</p>
      <Link to="/treino/$week/$session" params={{ week: String(w), session: "1" }} className="mt-5 flex items-center justify-center gap-2 rounded-full bg-primary py-4 font-bold text-primary-foreground">
        <Play className="h-5 w-5 fill-current" /> Começar
      </Link>
      <div className="mt-3 flex justify-center text-sm font-semibold">
        <Link to="/treinos" className="text-ink-foreground/70 underline">Escolher outro treino</Link>
      </div>
    </section>
  );
}

/** Input for gestational weeks or due date; always reports a due date (YYYY-MM-DD) or "". */
export function PregnancyFields({ due, onChange, inputClass, disabled = false }: { due: string; onChange: (d: string) => void; inputClass: string; disabled?: boolean }) {
  const [mode, setMode] = useState<"weeks" | "date">("weeks");
  const weeks = due ? gestation(due).week - 1 : "";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {(["weeks", "date"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} disabled={disabled} className={`rounded-2xl py-2.5 text-sm font-bold disabled:opacity-70 ${mode === m ? "bg-ink text-ink-foreground" : "bg-background"}`}>
            {m === "weeks" ? "Semanas de gestação" : "Data prevista do parto"}
          </button>
        ))}
      </div>
      {mode === "weeks" ? (
        <input type="number" min={1} max={41} placeholder="Ex.: 12" className={inputClass} value={weeks} disabled={disabled}
          onChange={(e) => { const n = +e.target.value; onChange(n >= 1 && n <= 41 ? dueDateFromWeeks(n) : ""); }} />
      ) : (
        <input type="date" className={inputClass} value={due} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      )}
    </div>
  );
}
