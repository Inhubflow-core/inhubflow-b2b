import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  RiLayoutGridLine,
  RiFlowChart,
  RiFileList3Line,
  RiLogoutBoxLine,
  RiUserSettingsLine,
  RiArrowUpCircleLine,
  RiBuildingLine,
  RiContactsLine,
  RiKanbanView,
  RiInboxLine,
  RiMailCheckLine,
  RiCalendarEventLine,
  RiQuestionLine,
  RiCompassLine,
  RiCustomerService2Line,
  RiGlobalLine,
  RiUserSearchLine,
  RiRobotLine,
  RiMenuFoldLine,
  RiMenuUnfoldLine,
  RiShieldCheckLine,
  RiTeamLine,
  RiVideoLine,
  RiRadarLine,
} from "react-icons/ri";
import { pathToTourPage, replayPageTour } from "@/lib/tour";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useTheme } from "@/lib/context/ThemeContext";

const mainNav = [
  { href: "/", labelKey: "nav.dashboard", icon: RiLayoutGridLine, color: "#465fff", tour: "nav-dashboard" },
  { href: "/lead-finder", labelKey: "nav.leadFinder", icon: RiUserSearchLine, color: "#465fff", tour: "nav-lead-finder" },
  { href: "/signals", labelKey: "nav.signalRadar", icon: RiRadarLine, color: "#465fff", tour: "nav-signals" },
  { href: "/lists", labelKey: "nav.lists", icon: RiFileList3Line, color: "#12b76a", tour: "nav-lists" },
  { href: "/contacts", labelKey: "nav.contacts", icon: RiContactsLine, color: "#0ba5ec", tour: "nav-contacts" },
  { href: "/pipeline", labelKey: "nav.pipeline", icon: RiKanbanView, color: "#ec4899", tour: "nav-pipeline" },
  { href: "/calendar", labelKey: "nav.calendar", icon: RiCalendarEventLine, color: "#8b5cf6", tour: "nav-calendar" },
  { href: "/companies", labelKey: "nav.companies", icon: RiBuildingLine, color: "#7a5af8", tour: "nav-companies" },
  { href: "/workflows", labelKey: "nav.campaigns", icon: RiFlowChart, color: "#f79009", tour: "nav-workflows" },
  { href: "/inbox", labelKey: "nav.inbox", icon: RiInboxLine, color: "#0086c9", tour: "nav-inbox" },
  { href: "/sdr", labelKey: "nav.sdrAgent", icon: RiRobotLine, color: "#8b5cf6", tour: "nav-sdr" },
  { href: "/email-health", labelKey: "nav.emailHealth", icon: RiMailCheckLine, color: "#fb6514", tour: "nav-email-health" },
];

interface SidebarProps {
  onCollapse?: (collapsed: boolean) => void;
  isEmbedded?: boolean;
  isCollapsed?: boolean;
}

export default function Sidebar({
  onCollapse,
  isEmbedded = false,
  isCollapsed = false,
}: SidebarProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const userEmail = session?.user?.email?.trim().toLowerCase();
  const isAdmin = userEmail === "inhubflow@gmail.com" || (session?.user as { role?: string })?.role === "admin";
  const { t, locale, setLocale, supportedLocales } = useTranslation();
  const { theme } = useTheme();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const helpRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const tourPage = pathToTourPage(router.pathname);
  const nav = mainNav;

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (helpOpen && helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setHelpOpen(false);
      }
      if (langOpen && langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [helpOpen, langOpen]);


  useEffect(() => {
    fetch("/api/system/update")
      .then((r) => r.json())
      .then((d) => {
        if (d?.updateAvailable) {
          setUpdateAvailable(true);
          setLatestVersion(d.latest);
        }
      })
      .catch(() => {});
  }, []);

  function isActive(href: string) {
    if (href === "/") return router.pathname === "/";
    if (href === "/settings") {
      return ["/settings", "/accounts"].some((p) => router.pathname.startsWith(p));
    }
    return router.pathname.startsWith(href);
  }

  const currentLocaleOption = supportedLocales.find((l) => l.code === locale) ?? supportedLocales[0];

  return (
    <aside
      className={`fixed top-0 left-0 h-screen z-50 flex flex-col border-r border-gray-300 bg-white transition-all duration-300 dark:border-gray-700 dark:bg-gray-900 ${
        isCollapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className={`flex shrink-0 items-center border-b border-gray-200 dark:border-gray-800 transition-all duration-300 ${
        isCollapsed ? "h-16 justify-center px-2" : "h-20 justify-start px-5"
      }`}>
        <Link href="/" className="flex items-center w-full">
          {isCollapsed ? (
            <div className="relative flex h-10 w-10 mx-auto items-center justify-center rounded-xl bg-transparent">
              <Image
                src="/logo-icon.png?v=2"
                alt="InHubFlow"
                width={38}
                height={38}
                className="h-10 w-10 object-contain"
                unoptimized
                priority
              />
            </div>
          ) : (
            <div className="flex flex-col items-start justify-center w-full py-1">
              <Image
                src="/logo-master-light.png?v=3"
                alt="InHubFlow"
                width={200}
                height={44}
                className="block dark:hidden w-[200px] h-[44px] object-contain transition-all duration-200"
                unoptimized
                priority
              />
              <Image
                src="/logo-master-dark.png?v=3"
                alt="InHubFlow"
                width={200}
                height={44}
                className="hidden dark:block w-[200px] h-[44px] object-contain transition-all duration-200"
                unoptimized
                priority
              />
              <span className="text-[10px] font-extrabold text-brand-500 uppercase tracking-widest pl-1 mt-1">
                B2B OUTREACH ENGINE
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {!isCollapsed && (
          <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
            {t("nav.navigation")}
          </p>
        )}

        {/* SuperAdmin Link for Admins */}
        {isAdmin && (
          <Link
            href="/admin"
            title={isCollapsed ? "SuperAdmin" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-normal transition-all mb-2 ${
              isActive("/admin")
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                : "text-amber-600/90 hover:bg-amber-500/10 dark:text-amber-400/90 hover:text-amber-600 dark:hover:text-amber-300"
            } ${isCollapsed ? "justify-center px-0" : ""}`}
          >
            <div
              className={`flex h-6.5 w-6.5 items-center justify-center rounded-lg transition-colors ${
                isActive("/admin")
                  ? "bg-amber-500 text-white shadow-xs"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              }`}
            >
              <RiShieldCheckLine size={17} />
            </div>
            {!isCollapsed && <span className="truncate font-semibold">SuperAdmin</span>}
            {!isCollapsed && (
              <span className="ml-auto text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                PRO
              </span>
            )}
          </Link>
        )}

        {/* Team Link for Workspace Owners */}
        {!((session?.user as any)?.owner_id) && (
          <Link
            href="/team"
            title={isCollapsed ? "Mi Equipo" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-normal transition-all mb-2 ${
              isActive("/team")
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold"
                : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/60 dark:hover:text-white"
            } ${isCollapsed ? "justify-center px-0" : ""}`}
          >
            <div
              className={`flex h-6.5 w-6.5 items-center justify-center rounded-lg transition-colors ${
                isActive("/team")
                  ? "bg-emerald-500 text-white shadow-xs"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              <RiTeamLine size={16} />
            </div>
            {!isCollapsed && <span className="truncate font-semibold">Mi Equipo</span>}
            {!isCollapsed && (
              <span className="ml-auto text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                TEAM
              </span>
            )}
          </Link>
        )}

        {nav.map((item) => {
          const active = isActive(item.href);
          const label = t(item.labelKey);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-tour={item.tour}
              title={isCollapsed ? label : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-normal transition-all ${
                active
                  ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
                  : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              } ${isCollapsed ? "justify-center px-0" : ""}`}
            >
              <div
                className={`flex h-6.5 w-6.5 items-center justify-center rounded-lg transition-colors ${
                  active
                    ? "bg-brand-500 text-white shadow-xs"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                <item.icon size={17} />
              </div>
              {!isCollapsed && <span className="truncate">{label}</span>}
              {!isCollapsed && active && (
                <div className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />
              )}
            </Link>
          );
        })}
      </div>

      {/* Update Banner */}
      {updateAvailable && !isCollapsed && (
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RiArrowUpCircleLine size={16} />
            <span>v{latestVersion} disponible</span>
          </div>
          <Link href="/settings" className="font-bold underline text-xs">
            Actualizar
          </Link>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="border-t border-gray-200 dark:border-gray-800 p-3 space-y-0.5">
        {/* Settings link */}
        <Link
          href="/settings"
          title={isCollapsed ? t("nav.settings") : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-normal transition-colors ${
            isActive("/settings")
              ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
              : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          } ${isCollapsed ? "justify-center px-0" : ""}`}
        >
          <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400">
            <RiUserSettingsLine size={17} />
          </div>
          {!isCollapsed && <span>{t("nav.settings")}</span>}
        </Link>

        {/* Support link */}
        <Link
          href="/support"
          title={isCollapsed ? t("nav.support") : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-normal transition-colors ${
            isActive("/support")
              ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
              : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          } ${isCollapsed ? "justify-center px-0" : ""}`}
        >
          <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400">
            <RiCustomerService2Line size={17} />
          </div>
          {!isCollapsed && <span>{t("nav.support")}</span>}
        </Link>

        {/* Tour & Help Guide */}
        <div className="relative" ref={helpRef}>
          <button
            onClick={() => setHelpOpen((v) => !v)}
            title={isCollapsed ? t("nav.help") : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-normal text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white transition-colors ${
              isCollapsed ? "justify-center px-0" : ""
            }`}
          >
            <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400">
              <RiQuestionLine size={17} />
            </div>
            {!isCollapsed && <span>{t("nav.help")}</span>}
          </button>

          {helpOpen && (
            <div className="absolute left-full bottom-0 ml-2 w-52 rounded-2xl border border-gray-300 bg-white p-2 shadow-xl backdrop-blur-md dark:border-gray-700 dark:bg-gray-900 z-50">
              {tourPage && (
                <button
                  onClick={() => {
                    replayPageTour(tourPage);
                    setHelpOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors text-left"
                >
                  <RiCompassLine size={14} className="text-gray-400 shrink-0" />
                  {t("nav.replayTour")}
                </button>
              )}
              <Link
                href="/tutorials"
                onClick={() => setHelpOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
              >
                <RiVideoLine size={14} className="text-gray-400 shrink-0" />
                {t("nav.tutorials")}
              </Link>
            </div>
          )}
        </div>

        {/* WordPress-Style Collapse Toggle Button */}
        <button
          type="button"
          onClick={() => onCollapse?.(!isCollapsed)}
          title={isCollapsed ? t("nav.expandMenu") : t("nav.collapseMenu")}
          className={`flex items-center gap-3 w-full rounded-xl px-3 py-1.5 text-sm font-normal text-gray-500 hover:bg-gray-100/80 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white transition-colors ${
            isCollapsed ? "justify-center px-0" : ""
          }`}
        >
          <div className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400">
            {isCollapsed ? <RiMenuUnfoldLine size={17} /> : <RiMenuFoldLine size={17} />}
          </div>
          {!isCollapsed && <span className="text-xs font-medium truncate">{t("nav.collapseMenu")}</span>}
        </button>
      </div>
    </aside>
  );
}
