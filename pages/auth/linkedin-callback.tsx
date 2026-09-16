import { useEffect, useState } from "react";
import Head from "next/head";
import { RiCheckboxCircleFill } from "react-icons/ri";

export default function LinkedInCallbackPage() {
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    // Notificar a la ventana padre (Modal en Settings) que el login culminó con éxito
    if (typeof window !== "undefined") {
      try {
        window.parent.postMessage({ type: "LINKEDIN_AUTH_SUCCESS", status: "success" }, "*");
      } catch (err) {
        console.error("Error enviando postMessage:", err);
      }
      setSynced(true);
    }
  }, []);

  return (
    <div className="min-h-[480px] bg-white dark:bg-gray-900 flex flex-col items-center justify-center p-6 text-center">
      <Head>
        <title>Conexión Exitosa — InHubFlow</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="w-16 h-16 bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
        <RiCheckboxCircleFill size={40} className="text-emerald-500" />
      </div>

      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
        ¡Conexión Exitosa!
      </h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mb-6 leading-relaxed">
        Tu cuenta de LinkedIn ha sido autenticada y sincronizada correctamente. Cerrando el asistente...
      </p>

      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        Sincronizando con InHubFlow...
      </div>
    </div>
  );
}
