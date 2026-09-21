import { useState } from "react";

export interface ProspectAvatarProps {
  imageUrl?: string | null;
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  badge?: "linkedin" | "online" | null;
}

export function getProspectInitials(name?: string | null): string {
  if (!name || !name.trim()) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function getProspectAvatarColor(name?: string | null): string {
  if (!name) return "bg-primary/20 text-primary border-primary/30";
  const colors = [
    "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
    "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
    "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
    "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30",
    "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function ProspectAvatar({
  imageUrl,
  name,
  size = "md",
  className = "",
  badge = null,
}: ProspectAvatarProps) {
  const [hasError, setHasError] = useState(false);

  const sizeClasses = {
    xs: "w-6 h-6 text-[10px]",
    sm: "w-7 h-7 text-xs",
    md: "w-9 h-9 text-xs",
    lg: "w-11 h-11 text-sm",
    xl: "w-14 h-14 text-base",
  }[size];

  const showImage = Boolean(imageUrl && !hasError);

  return (
    <div className={`relative shrink-0 inline-flex items-center justify-center ${className}`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl!}
          alt={name || "Prospecto"}
          className={`${sizeClasses} rounded-full object-cover border border-gray-200 dark:border-gray-700 shadow-xs`}
          onError={() => setHasError(true)}
          loading="lazy"
        />
      ) : (
        <div
          className={`${sizeClasses} rounded-full flex items-center justify-center font-bold border shadow-xs ${getProspectAvatarColor(
            name
          )}`}
        >
          {getProspectInitials(name)}
        </div>
      )}

      {badge === "online" && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-gray-900" />
      )}
      {badge === "linkedin" && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#0A66C2] text-white flex items-center justify-center text-[8px] font-bold ring-1.5 ring-white dark:ring-gray-900">
          in
        </span>
      )}
    </div>
  );
}
