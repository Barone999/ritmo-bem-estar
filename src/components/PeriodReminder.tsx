import { useState } from "react";
import { CalendarHeart, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, observedLength } from "@/lib/cycle";
import { uid, useCycle, useCycleLogs, useInvalidate } from "@/lib/data";

export function PeriodReminder() {
  const { data: cycle } = useCycle();
  const { data: logs = [] } = useCycleLogs();
  const invalidate = useInvalidate();
  const [saving, setSaving] = useState(false);
  const todayKey = fmtDate(new Date());

  if (!cycle || cycle.isDemo) return null;

  const starts = logs
    .filter((log) => log.period_start && log.log_date <= todayKey)
    .map((log) => log.log_date)
    .sort();
  const latestStart = starts[starts.length - 1];

  if (!latestStart) return null;

  const hasEnded = logs.some(
    (log) => log.period_ended && log.log_date >= latestStart && log.log_date <= todayKey,
  );
  const elapsedDays = observedLength(latestStart, todayKey);

  if (hasEnded || elapsedDays <= cycle.settings.period_length) return null;
  const startKey: string = latestStart;
  const cycleLength = cycle.settings.cycle_length;

  async function confirmOngoingPeriod() {
    setSaving(true);
    try {
      const id = await uid();
      const { error } = await supabase.from("cycle_settings").upsert({
        user_id: id,
        last_period_start: startKey,
        cycle_length: cycleLength,
        period_length: elapsedDays,
      });
      if (error) {
        toast.error("Não foi possível atualizar seu ciclo. Tente novamente.");
        return;
      }
      await invalidate("cycle");
      toast.success("Registro atualizado 💛");
    } catch {
      toast.error("Não foi possível atualizar seu ciclo. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 rounded-3xl border border-primary/20 bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-blush text-ink">
          <CalendarHeart className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Sua menstruação já terminou?</h2>
          <p className="mt-1 text-sm text-foreground/70">
            A previsão passou. Se você ainda estiver menstruando, atualize seu registro.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void confirmOngoingPeriod()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {saving ? "Atualizando..." : "Ainda estou menstruando"}
          </button>
          <p className="mt-2 text-xs text-foreground/60">
            Você pode registrar o fim da menstruação ou corrigir datas a qualquer momento no calendário do ciclo.
          </p>
        </div>
      </div>
    </section>
  );
}
