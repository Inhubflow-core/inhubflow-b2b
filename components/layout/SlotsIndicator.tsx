import React, { useState, useEffect } from "react";
import { RiFlashlightLine, RiAddLine, RiCheckLine, RiArrowRightSLine } from "react-icons/ri";

interface InstanceSettings {
  companyName: string;
  slotsLimit: number;
  accountsUsed: number;
  emailsUsed: number;
  slotsRemaining: number;
}

export function SlotsIndicator() {
  const [settings, setSettings] = useState<InstanceSettings | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetch("/api/instance/settings")
      .then((res) => res.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  if (!settings) return null;

  const used = settings.accountsUsed;
  const limit = settings.slotsLimit;
  const isFull = used >= limit;
  const percentage = Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer shadow-sm ${
          isFull
            ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            : "border-brand-500/20 bg-brand-500/5 text-brand-600 hover:bg-brand-500/10 dark:border-brand-500/30 dark:text-brand-400 dark:hover:bg-brand-500/20"
        }`}
        title="Capacidad de Slots / Cuentas de Prospección"
      >
        <RiFlashlightLine size={14} className={isFull ? "text-amber-600" : "text-brand-500"} />
        <span>
          <strong className="font-bold">{used}</strong> / {limit} Slots
        </span>
        <div className="w-10 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden hidden sm:block">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              isFull ? "bg-amber-500" : "bg-brand-500"
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 origin-top-left rounded-2xl border border-gray-200 bg-white p-4 shadow-xl backdrop-blur-md dark:border-gray-800 dark:bg-gray-900 z-50 animate-fade-in text-gray-900 dark:text-white">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-brand-500">
                Capacidad del Plan
              </p>
              <h4 className="text-sm font-bold truncate max-w-[170px]">
                {settings.companyName || "InHubFlow B2B"}
              </h4>
            </div>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isFull
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
              }`}
            >
              {isFull ? "Plan Completo" : "Slots Libres"}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Cuentas LinkedIn:</span>
              <span className="font-semibold">
                {used} de {limit} activas
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isFull ? "bg-amber-500" : "bg-gradient-to-r from-brand-500 to-indigo-600"
                }`}
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {isFull
                ? `Has alcanzado el límite de ${limit} slots de tu suscripción.`
                : `Tienes ${settings.slotsRemaining} slot(s) disponible(s) para conectar cuentas.`}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
            {!isFull ? (
              <a
                href="/settings"
                className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-xl transition-colors shadow-sm"
              >
                <RiAddLine size={14} />
                <span>Conectar Cuenta</span>
              </a>
            ) : (
              <a
                href="https://inhubflow.online#pricing"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1 w-full py-2 px-3 text-xs font-bold text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl transition-colors shadow-sm"
              >
                <span>Mejorar Plan</span>
                <RiArrowRightSLine size={14} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
