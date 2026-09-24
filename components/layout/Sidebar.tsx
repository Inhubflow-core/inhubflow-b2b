import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  MdOutlineDashboard,
  MdOutlineAccountTree,
  MdOutlineFormatListBulleted,
  MdOutlineLogout,
  MdOutlineManageAccounts,
  MdOutlineArrowCircleUp,
  MdOutlineBusiness,
  MdOutlinePeople,
  MdOutlineViewKanban,
  MdOutlineInbox,
  MdOutlineMarkEmailRead,
  MdOutlineEvent,
  MdOutlineHelpOutline,
  MdOutlineExplore,
  MdOutlineSupportAgent,
  MdOutlineLanguage,
  MdOutlinePersonSearch,
  MdOutlineSmartToy,
  MdOutlineChevronLeft,
  MdOutlineChevronRight,
  MdOutlineAdminPanelSettings,
  MdOutlineGroups,
  MdOutlineOndemandVideo,
  MdOutlineSensors,
  MdOutlineCampaign,
  MdOutlineKeyboardArrowDown,
  MdOutlineKeyboardArrowRight,
  MdOutlineContactPage,
} from "react-icons/md";
import { pathToTourPage, replayPageTour } from "@/lib/tour";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import { useTheme } from "@/lib/context/ThemeContext";

type NavChild = {
  href: string;
  labelKey: string;
  icon: any;
  color?: string;
  tour?: string;
};

type NavItem =
  | {
      type: "link";
      href: string;
      labelKey: string;
      icon: any;
      color?: string;
      tour?: string;
    }
  | {
      type: "group";
      id: "leads" | "campaigns";
      labelKey: string;
      icon: any;
      color?: string;
      children: NavChild[];
    };

const mainNav: NavItem[] = [
  { type: "link", href: "/", labelKey: "nav.dashboard", icon: MdOutlineDashboard, color: "#465fff", tour: "nav-dashboard" },
  { type: "link", href: "/lead-finder", labelKey: "nav.leadFinder", icon: MdOutlinePersonSearch, color: "#465fff", tour: "nav-lead-finder" },
  { type: "link", href: "/signals", labelKey: "nav.signalRadar", icon: MdOutlineSensors, color: "#465fff", tour: "nav-signals" },
  {
    type: "group",
    id: "leads",
    labelKey: "nav.leads",
    icon: MdOutlineContactPage,
    color: "#12b76a",
    children: [
      { href: "/lists", labelKey: "nav.lists", icon: MdOutlineFormatListBulleted, color: "#12b76a", tour: "nav-lists" },
      { href: "/contacts", labelKey: "nav.contacts", icon: MdOutlinePeople, color: "#0ba5ec", tour: "nav-contacts" },
      { href: "/companies", labelKey: "nav.companies", icon: MdOutlineBusiness, color: "#7a5af8", tour: "nav-companies" },
    ],
  },
  { type: "link", href: "/pipeline", labelKey: "nav.pipeline", icon: MdOutlineViewKanban, color: "#ec4899", tour: "nav-pipeline" },
  { type: "link", href: "/calendar", labelKey: "nav.calendar", icon: MdOutlineEvent, color: "#8b5cf6", tour: "nav-calendar" },
  {
    type: "group",
    id: "campaigns",
    labelKey: "nav.campaigns",
    icon: MdOutlineAccountTree,
    color: "#f79009",
    children: [
      { href: "/workflows", labelKey: "nav.sequences", icon: MdOutlineAccountTree, color: "#f79009", tour: "nav-workflows" },
      { href: "/social-selling", labelKey: "nav.socialSelling", icon: MdOutlineCampaign, color: "#8b5cf6", tour: "nav-social-selling" },
    ],
  },
  { type: "link", href: "/inbox", labelKey: "nav.inbox", icon: MdOutlineInbox, color: "#0086c9", tour: "nav-inbox" },
  { type: "link", href: "/sdr", labelKey: "nav.sdrAgent", icon: MdOutlineSmartToy, color: "#8b5cf6", tour: "nav-sdr" },
  { type: "link", href: "/email-health", labelKey: "nav.emailHealth", icon: MdOutlineMarkEmailRead, color: "#fb6514", tour: "nav-email-health" },
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
  const [leadsOpen, setLeadsOpen] = useState(false);
  const [campaignsOpen, setCampaignsOpen] = useState(false);

  useEffect(() => {
    if (["/lists", "/contacts", "/companies"].some((p) => router.pathname.startsWith(p))) {
      setLeadsOpen(true);
    }
    if (["/workflows", "/social-selling"].some((p) => router.pathname.startsWith(p))) {
      setCampaignsOpen(true);
    }
  }, [router.pathname]);

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
              <MdOutlineAdminPanelSettings size={17} />
            </div>
            {!isCollapsed && <span className="truncate font-semibold">SuperAdmin</span>}
            {!isCollapsed && (
              <span className="ml-auto text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                MASTER
              </span>
            )}
          </Link>
        )}

        {/* Team Link for Workspace Owners */}
        {!((session?.user as any)?.owner_id) && (
          <Link
            href="/team"
            title={isCollapsed ? "Admin" : undefined}
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
              <MdOutlineGroups size={16} />
            </div>
            {!isCollapsed && <span className="truncate font-semibold">Admin</span>}
            {!isCollapsed && (
              <span className="ml-auto text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                TEAM
              </span>
            )}
          </Link>
        )}

        {nav.map((item) => {
          if (item.type === "link") {
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
          }

          // Collapsible group (Leads, Campañas)
          const isOpen = item.id === "leads" ? leadsOpen : campaignsOpen;
          const setOpen = item.id === "leads" ? setLeadsOpen : setCampaignsOpen;
          const isGroupActive = item.children.some((child) => isActive(child.href));
          const label = t(item.labelKey);

          if (isCollapsed) {
            return (
              <div key={item.id} className="relative group">
                <button
                  type="button"
                  title={label}
                  onClick={() => setOpen((v) => !v)}
                  className={`flex items-center justify-center w-full rounded-xl px-0 py-1.5 text-sm transition-all cursor-pointer ${
                    isGroupActive
                      ? "bg-brand-500/10 text-brand-600 dark:text-brand-400"
                      : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                  }`}
                >
                  <div
                    className={`flex h-6.5 w-6.5 items-center justify-center rounded-lg transition-colors ${
                      isGroupActive
                        ? "bg-brand-500 text-white shadow-xs"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    <item.icon size={17} />
                  </div>
                </button>

                {/* Popover desplegable al hover en modo colapsado */}
                <div className="hidden group-hover:block absolute left-full top-0 ml-2 w-48 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-1.5 z-50">
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-800 mb-1">
                    {label}
                  </div>
                  <div className="space-y-0.5">
                    {item.children.map((child) => {
                      const childActive = isActive(child.href);
                      const childLabel = t(child.labelKey);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                            childActive
                              ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
                              : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 font-normal"
                          }`}
                        >
                          <child.icon size={16} className={childActive ? "text-brand-600 dark:text-brand-400" : "text-gray-400"} />
                          <span className="truncate">{childLabel}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={item.id} className="space-y-0.5">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`flex items-center gap-3 w-full rounded-xl px-3 py-1.5 text-sm font-normal transition-all cursor-pointer ${
                  isGroupActive
                    ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
                    : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                }`}
              >
                <div
                  className={`flex h-6.5 w-6.5 items-center justify-center rounded-lg transition-colors ${
                    isGroupActive
                      ? "bg-brand-500 text-white shadow-xs"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  <item.icon size={17} />
                </div>
                <span className="truncate">{label}</span>
                <div className="ml-auto flex items-center pr-0.5">
                  <MdOutlineKeyboardArrowDown
                    size={16}
                    className={`text-gray-400 transition-transform duration-200 ${
                      isOpen ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="pl-3 py-0.5 space-y-0.5 border-l-2 border-gray-200 dark:border-gray-800 ml-6 my-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  {item.children.map((child) => {
                    const childActive = isActive(child.href);
                    const childLabel = t(child.labelKey);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        data-tour={child.tour}
                        className={`flex items-center gap-3 rounded-xl px-2.5 py-1.5 text-sm font-normal transition-all ${
                          childActive
                            ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 font-medium"
                            : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                        }`}
                      >
                        <div
                          className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
                            childActive
                              ? "text-brand-600 dark:text-brand-400"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          <child.icon size={16} />
                        </div>
                        <span className="truncate">{childLabel}</span>
                        {childActive && (
                          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Update Banner */}
      {updateAvailable && !isCollapsed && (
        <div className="mx-3 mb-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MdOutlineArrowCircleUp size={16} />
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
            <MdOutlineManageAccounts size={17} />
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
            <MdOutlineSupportAgent size={17} />
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
              <MdOutlineHelpOutline size={17} />
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
                  <MdOutlineExplore size={14} className="text-gray-400 shrink-0" />
                  {t("nav.replayTour")}
                </button>
              )}
              <Link
                href="/tutorials"
                onClick={() => setHelpOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 transition-colors"
              >
                <MdOutlineOndemandVideo size={14} className="text-gray-400 shrink-0" />
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
            {isCollapsed ? <MdOutlineChevronRight size={17} /> : <MdOutlineChevronLeft size={17} />}
          </div>
          {!isCollapsed && <span className="text-sm font-normal truncate">{t("nav.collapseMenu")}</span>}
        </button>
      </div>
    </aside>
  );
}
