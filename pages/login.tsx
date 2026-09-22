import Head from "next/head";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";
import {
  RiLockPasswordLine,
  RiMailLine,
  RiSunLine,
  RiMoonLine,
} from "react-icons/ri";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useTheme } from "@/lib/context/ThemeContext";

export default function LoginPage() {
  const router = useRouter();
  const { t, locale, setLocale, supportedLocales } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);

    if (res?.ok) {
      router.replace("/");
    } else {
      setError(t("auth.invalidCredentials"));
    }
  }

  return (
    <>
      <Head>
        <title>InHubFlow — Plataforma de Prospección B2B & SDR con IA</title>
        <meta
          name="description"
          content="Automatiza tu prospección en LinkedIn y Cold Email con agentes de inteligencia artificial, pipelines comerciales y CRM integrado."
        />
        <meta property="og:site_name" content="InHubFlow" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://inhubflow.online/login" />
        <meta property="og:title" content="InHubFlow — Plataforma de Prospección B2B & SDR con IA" />
        <meta
          property="og:description"
          content="Automatiza tu prospección en LinkedIn y Cold Email con agentes de inteligencia artificial, pipelines comerciales y CRM integrado."
        />
        <meta property="og:image" content="https://inhubflow.online/og-image.png" />
        <meta property="og:image:secure_url" content="https://inhubflow.online/og-image.png" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="https://inhubflow.online/og-image.png" />
        <link rel="image_src" href="https://inhubflow.online/og-image.png" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-gray-100 to-gray-200 dark:from-[#0c111d] dark:via-[#101828] dark:to-[#080d1a] flex items-center justify-center relative p-4 font-sans transition-colors">
        {/* Top-right controls: Theme & Language */}
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-2">
          {/* Theme Switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white/80 dark:border-gray-800 dark:bg-gray-900/80 text-gray-700 dark:text-gray-300 backdrop-blur-sm shadow-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            title={theme === "dark" ? "Modo Claro" : "Modo Oscuro"}
          >
            {theme === "dark" ? (
              <RiSunLine size={16} className="text-amber-400" />
            ) : (
              <RiMoonLine size={16} className="text-gray-700" />
            )}
          </button>

          {/* Language Selector */}
          <div className="flex items-center gap-1 bg-white/80 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-800 rounded-xl p-1 backdrop-blur-sm shadow-sm">
            {supportedLocales.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLocale(l.code)}
                title={l.label}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  locale === l.code
                    ? "bg-brand-500 text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                }`}
              >
                <span>{l.flag}</span>
                <span className="uppercase text-[11px]">{l.code.split("-")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Auth Card */}
        <div className="w-full max-w-md">
          {/* Brand Header */}
          <div className="flex flex-col items-center gap-3 mb-6 text-center">
            <Image
              src="/logo-master-light.png?v=2"
              alt="InHubFlow Logo"
              width={220}
              height={60}
              className="block dark:hidden h-14 w-auto object-contain transition-all duration-300"
              unoptimized
              priority
            />
            <Image
              src="/logo-master-dark.png?v=2"
              alt="InHubFlow Logo"
              width={220}
              height={60}
              className="hidden dark:block h-14 w-auto object-contain transition-all duration-300"
              unoptimized
              priority
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("auth.signInTitle")}
            </p>
          </div>

          {/* Card Container */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl p-6 sm:p-8 shadow-xl dark:shadow-2xl">
            <form onSubmit={handleSignIn} className="flex flex-col gap-4">
              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("auth.email")}
                </label>
                <div className="relative">
                  <RiMailLine
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="email"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 dark:border-gray-700/80 dark:bg-gray-800/50 pl-10 pr-3.5 py-2.5 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all"
                    placeholder={t("auth.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("auth.password")}
                </label>
                <div className="relative">
                  <RiLockPasswordLine
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="password"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 dark:border-gray-700/80 dark:bg-gray-800/50 pl-10 pr-3.5 py-2.5 text-xs text-gray-900 dark:text-white placeholder-gray-400 focus:border-brand-500 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all"
                    placeholder={t("auth.passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-400 text-xs text-center font-medium">
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex h-11 w-full items-center justify-center rounded-xl bg-brand-500 px-4 text-xs font-bold text-white shadow-lg shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-[0.99] disabled:opacity-50"
              >
                {loading ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  t("auth.signInBtn")
                )}
              </button>
            </form>
          </div>

          <div className="mt-6 flex flex-col items-center gap-2 text-center text-xs text-gray-400 dark:text-gray-500">
            <div className="flex items-center gap-3">
              <a
                href="https://inhubflow.online/terms"
                target="_blank"
                rel="noreferrer"
                className="hover:text-gray-600 dark:hover:text-gray-300 transition underline underline-offset-2"
              >
                {locale === 'pt-BR' ? 'Termos de Serviço' : locale === 'en' ? 'Terms of Service' : 'Términos y Condiciones'}
              </a>
              <span>•</span>
              <a
                href="https://inhubflow.online/privacy"
                target="_blank"
                rel="noreferrer"
                className="hover:text-gray-600 dark:hover:text-gray-300 transition underline underline-offset-2"
              >
                {locale === 'pt-BR' ? 'Política de Privacidade' : locale === 'en' ? 'Privacy Policy' : 'Política de Privacidad'}
              </a>
            </div>
            <p>InHubFlow Suite &copy; 2026</p>
          </div>
        </div>
      </div>
    </>
  );
}
