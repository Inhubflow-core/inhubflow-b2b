import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useTheme } from "@/lib/context/ThemeContext";
import {
  RiMoonLine,
  RiSunLine,
  RiLogoutBoxRLine,
  RiUserLine,
  RiMenuFoldLine,
  RiMenuUnfoldLine,
  RiCheckLine,
  RiSendPlaneLine,
  RiNotification3Line,
  RiVolumeUpLine,
  RiVolumeMuteLine,
} from "react-icons/ri";
import { useNotifications } from "@/components/notifications/NotificationProvider";
import { SlotsIndicator } from "./SlotsIndicator";

interface HeaderProps {
  onToggleSidebar?: () => void;
  isSidebarCollapsed?: boolean;
  isEmbedded?: boolean;
}

type SessionUserWithSlots = {
  role?: string;
  slots_limit?: number;
};

export default function Header({
  onToggleSidebar,
  isSidebarCollapsed,
  isEmbedded,
}: HeaderProps) {
  const { data: session } = useSession();
  const sessionUser = session?.user as SessionUserWithSlots | undefined;
  const { locale, setLocale, supportedLocales, t } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isUserOpen, setIsUserOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    pushAvailable,
    pushSubscribed,
    soundEnabled,
    openNotification,
    markAllRead,
    enablePush,
    setSoundEnabled,
    testBeep,
  } = useNotifications();

  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setIsLangOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setIsUserOpen(false);
      }
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (isEmbedded) return null;

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-gray-300 bg-white/80 px-4 backdrop-blur-md transition-colors dark:border-gray-700 dark:bg-gray-900/80 sm:px-6">
        {/* Left: Sidebar Toggle & Title */}
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white shadow-2xs"
            title={isSidebarCollapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
          >
            {isSidebarCollapsed ? <RiMenuUnfoldLine size={18} /> : <RiMenuFoldLine size={18} />}
          </button>
        )}

        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-500/10 text-brand-500 text-xs font-semibold">
            <RiSendPlaneLine size={13} />
            <span>InHub Outreach</span>
          </div>
        </div>

        {/* Live Slots Capacity Indicator */}
        <SlotsIndicator />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Notification center */}
        <div className="relative" ref={notificationRef}>
          <button
            type="button"
            onClick={() => setIsNotificationsOpen((open) => !open)}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white shadow-xs"
            title="Notificaciones"
            aria-label={`Notificaciones${unreadCount ? ` (${unreadCount} sin leer)` : ""}`}
          >
            <RiNotification3Line size={19} />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-5 text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>

          {isNotificationsOpen && (
            <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] origin-top-right overflow-hidden rounded-2xl border border-gray-300 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Notificaciones</p>
                  <p className="text-[11px] text-gray-500">{unreadCount} sin leer</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSoundEnabled(!soundEnabled);
                      if (!soundEnabled) testBeep();
                    }}
                    className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    title={soundEnabled ? "Desactivar sonido" : "Activar sonido"}
                  >
                    {soundEnabled ? <RiVolumeUpLine size={16} /> : <RiVolumeMuteLine size={16} />}
                  </button>
                  {pushAvailable && !pushSubscribed && (
                    <button
                      type="button"
                      onClick={() => void enablePush()}
                      className="rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 dark:text-brand-400"
                    >
                      Activar Push
                    </button>
                  )}
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void markAllRead()}
                      className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      Leer todas
                    </button>
                  )}
                </div>
              </div>
              <div className="max-h-[420px] overflow-y-auto p-2">
                {notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center text-xs text-gray-500">No tienes notificaciones.</div>
                ) : notifications.map((notification) => (
                  <button
                    type="button"
                    key={notification.id}
                    onClick={() => {
                      setIsNotificationsOpen(false);
                      void openNotification(notification);
                    }}
                    className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      notification.state === "unread"
                        ? "border-brand-500/20 bg-brand-500/5 hover:bg-brand-500/10"
                        : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-semibold text-gray-900 dark:text-white">{notification.title}</p>
                      {notification.priority !== "normal" && (
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-red-500">
                          {notification.priority}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{notification.body}</p>
                    <p className="mt-2 text-[10px] text-gray-400">{new Date(notification.createdAt).toLocaleString()}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white shadow-xs"
          title={theme === "dark" ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
        >
          {theme === "dark" ? (
            <RiSunLine size={18} className="text-amber-400" />
          ) : (
            <RiMoonLine size={18} className="text-gray-700" />
          )}
        </button>

        {/* Language Dropdown */}
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setIsLangOpen(!isLangOpen)}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-gray-300 px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 shadow-xs"
          >
            <span className="text-sm">
              {supportedLocales.find((l) => l.code === locale)?.flag}
            </span>
            <span className="hidden sm:inline uppercase font-bold text-[11px]">
              {locale}
            </span>
          </button>

          {isLangOpen && (
            <div className="absolute right-0 mt-2 w-44 origin-top-right rounded-2xl border border-gray-300 bg-white p-1.5 shadow-xl backdrop-blur-md dark:border-gray-700 dark:bg-gray-900 z-50">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                {t("settings.selectLanguage")}
              </div>
              {supportedLocales.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLocale(l.code);
                    setIsLangOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs transition-colors ${
                    locale === l.code
                      ? "bg-brand-500/10 font-semibold text-brand-600 dark:text-brand-400"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{l.flag}</span>
                    <span>{l.label}</span>
                  </div>
                  {locale === l.code && <RiCheckLine size={14} className="text-brand-500" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User Profile Dropdown */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setIsUserOpen(!isUserOpen)}
            className="flex items-center gap-2 rounded-xl border border-gray-300 p-1.5 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 shadow-xs"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-brand-500 to-indigo-500 text-xs font-bold text-white shadow-sm">
              {session?.user?.email ? session.user.email[0].toUpperCase() : "U"}
            </div>
            <span className="hidden md:inline max-w-[120px] truncate text-xs font-medium text-gray-700 dark:text-gray-300">
              {session?.user?.email ?? "Usuario"}
            </span>
          </button>

          {isUserOpen && (
            <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-2xl border border-gray-300 bg-white p-2 shadow-xl backdrop-blur-md dark:border-gray-700 dark:bg-gray-900 z-50">
              <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 mb-1">
                <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                  {session?.user?.email ?? "Usuario"}
                </p>
                <p className="text-[11px] text-gray-400">InHub Administrator</p>
              </div>

              <Link
                href="/settings"
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
                onClick={() => setIsUserOpen(false)}
              >
                <RiUserLine size={15} />
                <span>{t("nav.settings")}</span>
              </Link>

              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors"
              >
                <RiLogoutBoxRLine size={15} />
                <span>{t("nav.logout")}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
