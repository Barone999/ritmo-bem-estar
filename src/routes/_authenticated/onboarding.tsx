import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Disclaimer } from "@/components/AppShell";
import { PregnancyDisclaimer, PregnancyFields } from "@/components/Pregnancy";
import { uid, useInvalidate } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Boas-vindas — Muuvi" }, { name: "description", content: "Personalize seu Muuvi." }] }),
  component: Onboarding,
});

const GOALS = [
  { v: "comecar", l: "Começar a correr", e: "🌱" },
  { v: "disciplina", l: "Criar disciplina", e: "🗓️" },
  { v: "bem-estar", l: "Bem-estar", e: "🌸" },
];
const LEVELS = [
  { v: "nunca", l: "Nunca corri" },
  { v: "ja-tentei", l: "Já tentei antes" },
];

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-3xl border-2 p-4 text-left font-semibold transition ${
        active ? "border-primary bg-blush" : "border-transparent bg-surface"
      }`}
    >
      {children}
    </button>
  );
}

function Onboarding() {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("comecar");
  const [days, setDays] = useState(3);
  const [level, setLevel] = useState("nunca");
  const [last, setLast] = useState("");
  const [cycleLen, setCycleLen] = useState(28);
  const [periodLen, setPeriodLen] = useState(5);
  const [pregnant, setPregnant] = useState(false);
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const invalidate = useInvalidate();

  async function finish(withCycle: boolean) {
    setSaving(true);
    try {
      const id = await uid();
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ goal, days_per_week: days, level, onboarded: true, pregnant: pregnant && !!due, due_date: pregnant && due ? due : null })
        .eq("id", id);
      if (profileError) {
        toast.error("Não foi possível salvar seu perfil. Tente novamente.");
        return;
      }

      if (withCycle && last) {
        const { error: cycleError } = await supabase.from("cycle_settings").upsert({
          user_id: id,
          last_period_start: last,
          cycle_length: cycleLen,
          period_length: periodLen,
        });
        if (cycleError) {
          toast.error("Perfil salvo, mas não foi possível salvar os dados do ciclo. Tente novamente.");
          return;
        }
      }

      invalidate("profile", "cycle");
      navigate({ to: "/inicio", replace: true });
    } catch {
      toast.error("Ocorreu um erro ao salvar. Verifique sua conexão e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  const steps = [
    <div key="g" className="space-y-3">
      <h1 className="text-3xl font-bold">Qual é o seu objetivo?</h1>
      <p className="text-foreground/70">Não existe resposta certa. É só para a gente te conhecer.</p>
      {GOALS.map((g) => (
        <Option key={g.v} active={goal === g.v} onClick={() => setGoal(g.v)}>
          <span className="mr-2">{g.e}</span>
          {g.l}
        </Option>
      ))}
    </div>,
    <div key="d" className="space-y-3">
      <h1 className="text-3xl font-bold">Quantos dias por semana?</h1>
      <p className="text-foreground/70">Escolha o que cabe na sua rotina. Dá para mudar depois.</p>
      <div className="grid grid-cols-7 gap-2">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <button
            key={n}
            onClick={() => setDays(n)}
            className={`rounded-2xl py-3.5 text-lg font-bold ${days === n ? "bg-primary text-primary-foreground" : "bg-surface"}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>,
    <div key="l" className="space-y-3">
      <h1 className="text-3xl font-bold">Como você está hoje?</h1>
      {LEVELS.map((l) => (
        <Option key={l.v} active={level === l.v} onClick={() => setLevel(l.v)}>
          {l.l}
        </Option>
      ))}
    </div>,
    <div key="p" className="space-y-3">
      <h1 className="text-3xl font-bold">Você está grávida?</h1>
      <p className="text-foreground/70">Se sim, ativamos o Modo Gestante: acompanhamos suas semanas e sugerimos movimentos leves e confortáveis.</p>
      <Option active={!pregnant} onClick={() => setPregnant(false)}>Não</Option>
      <Option active={pregnant} onClick={() => setPregnant(true)}>🤰 Sim, estou grávida</Option>
      {pregnant && (
        <>
          <PregnancyFields due={due} onChange={setDue} inputClass="w-full rounded-2xl bg-surface px-4 py-3.5" />
          <PregnancyDisclaimer />
        </>
      )}
    </div>,
    <div key="c" className="space-y-4">
      <h1 className="text-3xl font-bold">Seu ciclo</h1>
      <p className="text-foreground/70">
        Com esses dados, adaptamos as sugestões à sua fase. É opcional — você pode pular e preencher quando quiser.
        Seus dados do ciclo são privados e só você vê.
      </p>
      <label className="block">
        <span className="text-sm font-semibold">Data da última menstruação</span>
        <input type="date" value={last} onChange={(e) => setLast(e.target.value)} className="mt-1 w-full rounded-2xl bg-surface px-4 py-3.5" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-semibold">Duração do ciclo</span>
          <input type="number" min={20} max={45} value={cycleLen} onChange={(e) => setCycleLen(+e.target.value)} className="mt-1 w-full rounded-2xl bg-surface px-4 py-3.5" />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Dias de menstruação</span>
          <input type="number" min={2} max={10} value={periodLen} onChange={(e) => setPeriodLen(+e.target.value)} className="mt-1 w-full rounded-2xl bg-surface px-4 py-3.5" />
        </label>
      </div>
      <Disclaimer />
    </div>,
  ];

  const lastStep = step === steps.length - 1;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-8">
      <div className="mb-8 flex gap-2">
        {steps.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      <div className="flex-1">{steps[step]}</div>
      <div className="mt-8 space-y-2">
        <button
          disabled={saving}
          onClick={() => (lastStep ? finish(true) : setStep(step + 1))}
          className="w-full rounded-full bg-primary py-4 font-bold text-primary-foreground disabled:opacity-60"
        >
          {lastStep ? "Concluir" : "Continuar"}
        </button>
        {lastStep && (
          <button disabled={saving} onClick={() => finish(false)} className="w-full py-2 text-sm font-semibold text-bronze">
            Pular esta parte
          </button>
        )}
        {step > 0 && !lastStep && (
          <button onClick={() => setStep(step - 1)} className="w-full py-2 text-sm font-semibold text-foreground/60">
            Voltar
          </button>
        )}
      </div>
    </div>
  );
}
