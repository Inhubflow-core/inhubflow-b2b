import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import Layout from "@/components/layout/Layout";
import { Toaster } from "sonner";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { ThemeProvider, useTheme } from "@/lib/context/ThemeContext";
import { NotificationProvider } from "@/components/notifications/NotificationProvider";

const PUBLIC_PATHS = ["/login", "/book"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session && !isPublicPath(router.pathname || "")) {
      router.replace("/login");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <span className="loading loading-spinner loading-sm text-base-content/40" />
      </div>
    );
  }

  if (!session && !isPublicPath(router.pathname || "")) return null;

  return <>{children}</>;
}

function AppWithToaster({ Component, pageProps }: Pick<AppProps, "Component" | "pageProps">) {
  const { theme } = useTheme();
  return (
    <>
      <Component {...pageProps} />
      <Toaster theme={theme === "light" ? "light" : "dark"} position="bottom-right" />
    </>
  );
}

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <SessionProvider session={session}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthGuard>
            <NotificationProvider>
              <Layout>
                <AppWithToaster Component={Component} pageProps={pageProps} />
              </Layout>
            </NotificationProvider>
          </AuthGuard>
        </LanguageProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
