import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="es" data-theme="light">
      <Head>
        <link rel="icon" type="image/png" href="/logo-icon.png?v=2" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico?v=2" />
        <link rel="shortcut icon" href="/favicon.ico?v=2" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/logo-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/logo-icon.png" />
        <meta name="theme-color" content="#4f46e5" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="InHubFlow" />

        {/* ── OpenGraph & Social Sharing Meta Tags (WhatsApp, LinkedIn, Telegram, Twitter) ── */}
        <meta name="title" content="InHubFlow — Plataforma de Prospección B2B & SDR con IA" />
        <meta
          name="description"
          content="Automatiza tu prospección en LinkedIn y Cold Email con agentes de inteligencia artificial, pipelines comerciales y CRM integrado."
        />
        <meta property="og:site_name" content="InHubFlow" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://inhubflow.online/" />
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
        <meta property="og:image:alt" content="InHubFlow — Plataforma de Prospección B2B & SDR con IA" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="InHubFlow — Plataforma de Prospección B2B & SDR con IA" />
        <meta
          name="twitter:description"
          content="Automatiza tu prospección en LinkedIn y Cold Email con agentes de inteligencia artificial, pipelines comerciales y CRM integrado."
        />
        <meta name="twitter:image" content="https://inhubflow.online/og-image.png" />
        <link rel="image_src" href="https://inhubflow.online/og-image.png" />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="min-h-screen bg-base-100 text-base-content antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
