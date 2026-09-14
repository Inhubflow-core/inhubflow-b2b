import { ReactNode, useState, useEffect } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import Header from "./Header";
import TourGate from "@/components/onboarding/TourGate";

const NO_LAYOUT_PATHS = ["/login", "/live-chat", "/book"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isEmbed = router.query?.embed === "true";
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Initialize and persist sidebar collapse preference
  useEffect(() => {
    const saved = localStorage.getItem("inhubflow_sidebar_collapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "1");
    } else if (window.innerWidth < 1024) {
      setIsCollapsed(true);
    }

    function handleResize() {
      if (window.innerWidth < 768) {
        setIsCollapsed(true);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleCollapse = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    try {
      localStorage.setItem("inhubflow_sidebar_collapsed", collapsed ? "1" : "0");
    } catch {}
  };

  const toggleSidebar = () => {
    handleCollapse(!isCollapsed);
  };

  const pathname = router.pathname || "";
  const isNoLayout = NO_LAYOUT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (isNoLayout) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-[#0c111d] dark:text-gray-100 flex font-sans transition-colors duration-200">
      <TourGate />

      {/* Sidebar */}
      {!isEmbed && (
        <Sidebar
          isCollapsed={isCollapsed}
          onCollapse={handleCollapse}
          isEmbedded={isEmbed}
        />
      )}

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${
          isEmbed ? "ml-0" : isCollapsed ? "ml-16" : "ml-64"
        }`}
      >
        {!isEmbed && (
          <Header
            onToggleSidebar={toggleSidebar}
            isSidebarCollapsed={isCollapsed}
            isEmbedded={isEmbed}
          />
        )}

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
