import React, { useState, useRef, useEffect } from "react";
import {
  RiMicLine,
  RiMicFill,
  RiStopCircleLine,
  RiAttachment2,
  RiFilePdfLine,
  RiImageLine,
  RiVideoLine,
  RiVolumeUpLine,
  RiYoutubeLine,
  RiCloseLine,
  RiUploadCloud2Line,
  RiLoader4Line,
  RiPlayLine,
  RiPauseLine,
  RiInformationLine,
} from "react-icons/ri";
import { toast } from "sonner";

export interface StepAttachment {
  url: string | null;
  name: string | null;
  type: string | null;
  size: number | null;
}

interface StepAttachmentPickerProps {
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
  onChange: (attachment: StepAttachment) => void;
  disabled?: boolean;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function StepAttachmentPicker({
  attachmentUrl,
  attachmentName,
  attachmentType,
  attachmentSize,
  onChange,
  disabled = false,
}: StepAttachmentPickerProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showYoutubeTip, setShowYoutubeTip] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up timer and object URLs
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    };
  }, [recordedAudioUrl]);

  async function startRecording() {
    if (disabled || isUploading) return;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error("Tu navegador no soporta grabación de audio desde el micrófono");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      // Determine supported mime type
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/wav",
      ];
      let selectedMime = "";
      for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) {
          selectedMime = m;
          break;
        }
      }

      const options = selectedMime ? { mimeType: selectedMime } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: selectedMime || "audio/webm",
        });
        const url = URL.createObjectURL(audioBlob);
        setRecordedAudioBlob(audioBlob);
        setRecordedAudioUrl(url);
        // Stop all audio tracks to turn off mic indicator
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(200); // 200ms slices
      setIsRecording(true);
      setRecordingSeconds(0);
      setRecordedAudioBlob(null);
      if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
        setRecordedAudioUrl(null);
      }

      // Max 60 seconds (LinkedIn Voice Note limit)
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setRecordingSeconds(elapsed);
        if (elapsed >= 60) {
          stopRecording();
        }
      }, 500);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      toast.error("No se pudo acceder al micrófono. Verifica los permisos de tu navegador.");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  function cancelRecording() {
    stopRecording();
    setRecordedAudioBlob(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    setRecordingSeconds(0);
  }

  async function uploadRecordedVoiceNote() {
    if (!recordedAudioBlob) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string;
          const timestamp = new Date().toISOString().slice(0, 19).replace(/[^0-9]/g, "");
          const filename = `nota-de-voz-${timestamp}.mp3`;

          const res = await fetch("/api/uploads/workflow-attachment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename,
              contentType: "audio/mp3",
              base64,
            }),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Error al subir la nota de voz");
          }

          const data = await res.json();
          onChange({
            url: data.url,
            name: "Nota de voz de LinkedIn",
            type: "audio/mp3",
            size: data.size,
          });

          toast.success("Nota de voz adjuntada con éxito!");
          cancelRecording();
        } catch (uploadErr) {
          console.error("Error subiendo audio:", uploadErr);
          toast.error(uploadErr instanceof Error ? uploadErr.message : "Error al subir audio");
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(recordedAudioBlob);
    } catch (err) {
      console.error(err);
      setIsUploading(false);
      toast.error("Error al procesar el archivo de audio");
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 25 MB");
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64 = reader.result as string;
          const res = await fetch("/api/uploads/workflow-attachment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              base64,
            }),
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Error al subir el archivo");
          }

          const data = await res.json();
          onChange({
            url: data.url,
            name: file.name,
            type: file.type || data.type,
            size: data.size,
          });

          toast.success(`"${file.name}" adjuntado con éxito!`);
        } catch (uploadErr) {
          console.error("Error subiendo archivo:", uploadErr);
          toast.error(uploadErr instanceof Error ? uploadErr.message : "Error al subir archivo");
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsUploading(false);
      toast.error("Error al leer el archivo");
    }
  }

  function removeAttachment() {
    onChange({
      url: null,
      name: null,
      type: null,
      size: null,
    });
    toast.info("Adjunto eliminado");
  }

  // Type helper for icons and badges
  const isAudio = attachmentType?.startsWith("audio/") || attachmentName?.endsWith(".mp3") || attachmentName?.endsWith(".wav") || attachmentName?.endsWith(".m4a");
  const isImage = attachmentType?.startsWith("image/") || attachmentName?.match(/\.(png|jpg|jpeg|webp|gif)$/i);
  const isVideo = attachmentType?.startsWith("video/") || attachmentName?.match(/\.(mp4|mov|webm)$/i);
  const isPdf = attachmentType?.includes("pdf") || attachmentName?.endsWith(".pdf");

  return (
    <div className="mt-4 pt-3 border-t border-base-300/40">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="audio/*,video/*,image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        onChange={handleFileSelect}
        disabled={disabled || isUploading || isRecording}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <RiAttachment2 size={15} className="text-primary" />
          <span className="text-xs font-semibold text-base-content/80">
            Adjuntos y Notas de Voz (LinkedIn)
          </span>
          <span className="badge badge-xs badge-neutral text-[10px] py-1">Opcional</span>
        </div>
        <button
          type="button"
          onClick={() => setShowYoutubeTip(!showYoutubeTip)}
          className="inline-flex items-center gap-1 text-[11px] text-base-content/50 hover:text-error transition-colors"
        >
          <RiYoutubeLine size={13} className="text-error" />
          <span>¿Videos de YouTube?</span>
        </button>
      </div>

      {/* YouTube Helper Card */}
      {showYoutubeTip && (
        <div className="mb-3 p-2.5 rounded-xl bg-error/5 border border-error/20 text-xs flex items-start gap-2.5 text-base-content/80 animate-in fade-in duration-200">
          <RiYoutubeLine size={18} className="text-error shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-error">Cómo compartir videos de YouTube en LinkedIn</p>
            <p className="text-[11px] text-base-content/70 mt-0.5 leading-relaxed">
              No necesitas subir ningún archivo. Simplemente <strong>pega el enlace de YouTube</strong> (ej: <code className="text-primary font-mono text-[10px] bg-base-300/50 px-1 py-0.5 rounded">https://youtu.be/...</code>) directamente en el texto del mensaje arriba. LinkedIn generará automáticamente una tarjeta interactiva con reproductor embebido.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowYoutubeTip(false)}
            className="text-base-content/40 hover:text-base-content p-1"
          >
            ×
          </button>
        </div>
      )}

      {/* Current Attachment Preview */}
      {attachmentUrl ? (
        <div className="p-3 rounded-xl bg-base-300/40 border border-primary/30 relative overflow-hidden transition-all shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  isAudio
                    ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                    : isImage
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                    : isVideo
                    ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                    : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                }`}
              >
                {isAudio ? (
                  <RiVolumeUpLine size={18} />
                ) : isImage ? (
                  <RiImageLine size={18} />
                ) : isVideo ? (
                  <RiVideoLine size={18} />
                ) : (
                  <RiFilePdfLine size={18} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-base-content truncate">
                    {attachmentName || "Archivo adjunto"}
                  </p>
                  <span
                    className={`badge badge-xs text-[10px] ${
                      isAudio
                        ? "badge-primary"
                        : isImage
                        ? "badge-accent"
                        : isVideo
                        ? "badge-info"
                        : "badge-warning"
                    }`}
                  >
                    {isAudio ? "Nota de Voz (Audio)" : isImage ? "Foto / Imagen" : isVideo ? "Video MP4" : "Documento"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-base-content/50 mt-0.5">
                  {attachmentSize ? <span>{formatBytes(attachmentSize)}</span> : null}
                  <span>•</span>
                  <span className="text-success font-medium">Listo para enviar en DM</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={removeAttachment}
              disabled={disabled}
              className="btn btn-ghost btn-xs btn-square text-base-content/40 hover:text-error hover:bg-error/10 transition-colors"
              title="Eliminar adjunto"
            >
              <RiCloseLine size={16} />
            </button>
          </div>

          {/* Audio Player for Voice Notes */}
          {isAudio && (
            <div className="mt-2.5 pt-2 border-t border-base-300/40">
              <audio
                controls
                src={attachmentUrl}
                className="w-full h-8 rounded-lg outline-none"
                preload="metadata"
              />
            </div>
          )}

          {/* Image Thumbnail */}
          {isImage && (
            <div className="mt-2.5 pt-2 border-t border-base-300/40">
              <img
                src={attachmentUrl}
                alt={attachmentName || "Vista previa"}
                className="max-h-36 rounded-lg object-contain bg-base-300/60 border border-base-300"
              />
            </div>
          )}
        </div>
      ) : isRecording ? (
        /* Live Recording State */
        <div className="p-3.5 rounded-xl bg-error/10 border border-error/40 flex items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-error text-white flex items-center justify-center animate-ping duration-1000">
              <RiMicFill size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-error flex items-center gap-1.5">
                <span>Grabando nota de voz de LinkedIn...</span>
              </p>
              <p className="text-xs text-base-content/70 mt-0.5 font-mono">
                {formatSeconds(recordingSeconds)} / 01:00 (límite LinkedIn)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={stopRecording}
              className="btn btn-error btn-sm text-white gap-1.5 shadow-sm"
            >
              <RiStopCircleLine size={16} /> Detener
            </button>
            <button
              type="button"
              onClick={cancelRecording}
              className="btn btn-ghost btn-xs text-base-content/50 hover:text-base-content"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : recordedAudioBlob && recordedAudioUrl ? (
        /* Recorded Review State */
        <div className="p-3 rounded-xl bg-base-300/50 border border-purple-500/30 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <RiVolumeUpLine size={15} />
              </span>
              <div>
                <p className="text-xs font-semibold text-base-content">
                  Nota de voz grabada ({formatSeconds(recordingSeconds)})
                </p>
                <p className="text-[10px] text-base-content/50">Escucha antes de confirmar el envío</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelRecording}
                disabled={isUploading}
                className="btn btn-ghost btn-xs text-base-content/50 hover:text-error"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={uploadRecordedVoiceNote}
                disabled={isUploading}
                className="btn btn-primary btn-sm gap-1.5 shadow-sm"
              >
                {isUploading ? (
                  <>
                    <RiLoader4Line size={14} className="animate-spin" /> Subiendo...
                  </>
                ) : (
                  <>
                    <RiAttachment2 size={14} /> Adjuntar Nota de Voz
                  </>
                )}
              </button>
            </div>
          </div>

          <audio controls src={recordedAudioUrl} className="w-full h-8 rounded-lg outline-none" />
        </div>
      ) : (
        /* Action Buttons: Record Voice Note & Upload File */
        <div className="flex flex-wrap items-center gap-2">
          {/* Record Voice Note Button */}
          <button
            type="button"
            onClick={startRecording}
            disabled={disabled || isUploading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-gradient-to-r from-purple-500/15 to-indigo-500/15 hover:from-purple-500/25 hover:to-indigo-500/25 text-purple-300 border border-purple-500/30 transition-all shadow-sm"
          >
            <RiMicLine size={14} className="text-purple-400" />
            <span>Grabar Nota de Voz</span>
            <span className="text-[10px] opacity-60 font-mono">max 60s</span>
          </button>

          {/* Upload File Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-base-300/50 hover:bg-base-300 text-base-content/80 border border-base-300/70 transition-colors"
          >
            {isUploading ? (
              <>
                <RiLoader4Line size={14} className="animate-spin text-primary" />
                <span>Subiendo archivo...</span>
              </>
            ) : (
              <>
                <RiUploadCloud2Line size={14} className="text-base-content/60" />
                <span>Subir Archivo (Audio, PDF, Foto, Video)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
