import React, { createContext, useContext, useEffect, useState, useMemo } from "react";
import { Locale, SUPPORTED_LOCALES, LocaleOption, TranslationParams } from "./types";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ptBR from "./locales/pt-BR.json";

const translations: Record<Locale, any> = {
  en,
  es,
  "pt-BR": ptBR,
};

interface LanguageContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocaleOption[];
}

const LanguageContext = createContext<LanguageContextType>({
  locale: "es",
  setLocale: () => {},
  t: (key) => key,
  supportedLocales: SUPPORTED_LOCALES,
});

const STORAGE_KEY = "inhubflow_locale";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("es");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
      if (saved && ["es", "pt-BR", "en"].includes(saved)) {
        setLocaleState(saved);
        return;
      }

      // Detect browser language
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith("pt")) {
        setLocaleState("pt-BR");
      } else if (browserLang.startsWith("es")) {
        setLocaleState("es");
      } else {
        setLocaleState("es"); // Default to Spanish as requested
      }
    } catch {
      setLocaleState("es");
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem(STORAGE_KEY, newLocale);
      document.documentElement.lang = newLocale;
    } catch {
      // ignore localStorage errors in private modes
    }
  };

  const t = useMemo(() => {
    return (key: string, params?: TranslationParams): string => {
      const keys = key.split(".");
      let val: any = translations[locale];

      for (const k of keys) {
        if (val && typeof val === "object" && k in val) {
          val = val[k];
        } else {
          val = undefined;
          break;
        }
      }

      // Fallback to English
      if (typeof val !== "string") {
        let fallbackVal: any = translations["en"];
        for (const k of keys) {
          if (fallbackVal && typeof fallbackVal === "object" && k in fallbackVal) {
            fallbackVal = fallbackVal[k];
          } else {
            fallbackVal = undefined;
            break;
          }
        }
        val = typeof fallbackVal === "string" ? fallbackVal : key;
      }

      // Interpolate parameters {var}
      if (params && typeof val === "string") {
        return Object.entries(params).reduce((acc, [pKey, pVal]) => {
          return acc.replace(new RegExp(`{${pKey}}`, "g"), String(pVal));
        }, val);
      }

      return val;
    };
  }, [locale]);

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t, supportedLocales: SUPPORTED_LOCALES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  return useContext(LanguageContext);
}
