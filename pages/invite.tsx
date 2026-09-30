import Head from "next/head";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import {
  RiTeamLine,
  RiCheckLine,
  RiLockPasswordLine,
  RiUserLine,
  RiShieldCheckLine,
  RiErrorWarningLine,
  RiArrowRightLine,
} from "react-icons/ri";

export default function AcceptInvitePage() {
  const router = useRouter();
  const { code } = router.query;

  const [loading, setLoading] = useState(true);
  const [inviteData, setInviteData] = useState<{
    email: string;
    role: string;
    company_name: string;
    owner_email: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;

    if (!code) {
      setError("No se proporcionó ningún código de invitación.");
      setLoading(false);
      return;
    }

    // Validate invite code
    fetch(`/api/team/invite/${code}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Invitación no válida.");
        }
        setInviteData(data);
        setName(data.email.split("@")[0]);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router.isReady, code]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Las contraseñas no coinciden.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch(`/api/team/invite/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Error al completar el registro.");
      }

      toast.success("¡Cuenta activada con éxito! Iniciando sesión...");

      // Auto sign-in
      const signInResult = await signIn("credentials", {
        redirect: false,
        email: inviteData!.email,
        password,
      });

      if (signInResult?.ok) {
        router.push("/");
      } else {
        router.push("/login");
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Aceptar Invitación de Equipo | InHubFlow</title>
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-[#0c111d] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
        {/* Glow Gradients */}
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center z-10">
          <div className="flex justify-center mb-4">
            <Image
              src="/logo-master-light.png?v=4"
              alt="InHubFlow"
              width={180}
              height={40}
              className="block dark:hidden object-contain"
              unoptimized
            />
            <Image
              src="/logo-master-dark.png?v=4"
              alt="InHubFlow"
              width={180}
              height={40}
              className="hidden dark:block object-contain"
              unoptimized
            />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <RiTeamLine size={14} />
            Invitación Oficial de Equipo
          </span>
        </div>

        <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md z-10 px-4 sm:px-0">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 py-8 px-6 sm:px-10 rounded-3xl shadow-xl">
            {loading ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-10 h-10 border-3 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto" />
                <p className="text-xs text-gray-400">Verificando invitación...</p>
              </div>
            ) : error ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-14 h-14 mx-auto rounded-full bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center">
                  <RiErrorWarningLine size={28} />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Invitación no disponible</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{error}</p>
                <a
                  href="/login"
                  className="inline-block mt-2 px-5 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Ir al Inicio de Sesión
                </a>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="text-center pb-2 border-b border-gray-100 dark:border-gray-800">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Únete al equipo comercial</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Has sido invitado por <span className="font-semibold text-emerald-600 dark:text-emerald-400">{inviteData?.company_name}</span> para operar tu slot dedicado de prospección.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Tu Nombre Completo
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ej: Juan Pérez"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RiUserLine className="absolute left-3 top-3 text-gray-400" size={16} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Tu Correo Electrónico
                  </label>
                  <input
                    type="email"
                    disabled
                    value={inviteData?.email}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/30 text-sm text-gray-500 dark:text-gray-400 cursor-not-allowed font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Crea tu Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      placeholder="Mínimo 6 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RiLockPasswordLine className="absolute left-3 top-3 text-gray-400" size={16} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    Confirma tu Contraseña
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      placeholder="Repite tu contraseña"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <RiLockPasswordLine className="absolute left-3 top-3 text-gray-400" size={16} />
                  </div>
                </div>

                <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-xl flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                  <RiShieldCheckLine size={16} className="shrink-0" />
                  <span>Tu espacio es 100% privado y exclusivo para tu perfil.</span>
                </div>

                <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded-xl flex items-start gap-2 text-xs text-blue-700 dark:text-blue-300">
                  <span className="shrink-0 mt-0.5">📬</span>
                  <span>Recibirás alertas de tus campañas en tu correo. Si algún email llega a <strong>Spam</strong>, márcalo como <strong>&quot;No es Spam&quot;</strong>.</span>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm shadow-md shadow-emerald-600/20 transition-all cursor-pointer active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
                >
                  <span>{submitting ? "Activando cuenta..." : "Activar Mi Cuenta y Entrar"}</span>
                  <RiArrowRightLine size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
