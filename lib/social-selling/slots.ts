/**
 * Lógica de Calendarización de Social Selling:
 * Reglas estrictas:
 * 1. Días de publicación: Únicamente Lunes (1), Miércoles (3) y Viernes (5).
 * 2. Máximo 1 post por día (sin colisiones ni posts repetidos en la misma fecha).
 * 3. Horario óptimo por defecto: 10:00 AM (ventana de alto impacto en LinkedIn).
 */

export interface ScheduledPostLike {
  scheduled_at?: string | null;
  status?: string | null;
}

/**
 * Verifica si un día de la semana es válido (Lunes, Miércoles, Viernes).
 */
export function isAllowedPublishingDay(date: Date): boolean {
  const day = date.getDay();
  return day === 1 || day === 3 || day === 5;
}

/**
 * Devuelve una clave 'YYYY-MM-DD' en hora local para controlar fechas ocupadas.
 */
export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Encuentra el siguiente slot libre disponible para publicar.
 */
export function getNextAvailablePublishingSlot(
  existingPosts: ScheduledPostLike[] = [],
  preferredHour: number = 10,
  preferredMinute: number = 0,
  baseDate?: Date
): Date {
  const occupiedDates = new Set<string>();

  for (const p of existingPosts) {
    if (!p.scheduled_at) continue;
    const d = new Date(p.scheduled_at);
    if (!isNaN(d.getTime())) {
      occupiedDates.add(toLocalDateKey(d));
    }
  }

  const now = baseDate || new Date();
  const candidate = new Date(now);
  candidate.setHours(preferredHour, preferredMinute, 0, 0);
  candidate.setSeconds(0, 0);

  // Intentar hasta 90 días en el futuro para encontrar el primer slot libre
  for (let i = 0; i < 90; i++) {
    const dayOfWeek = candidate.getDay(); // 1 = Lun, 3 = Mie, 5 = Vie
    const isTargetDay = dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    const dateKey = toLocalDateKey(candidate);
    const isOccupied = occupiedDates.has(dateKey);
    // Debe ser al menos 15 minutos en el futuro
    const isFuture = candidate.getTime() > now.getTime() + 15 * 60 * 1000;

    if (isTargetDay && !isOccupied && isFuture) {
      return candidate;
    }

    // Avanzar al día siguiente a las 10:00 AM
    candidate.setDate(candidate.getDate() + 1);
    candidate.setHours(preferredHour, preferredMinute, 0, 0);
  }

  return candidate;
}

/**
 * Genera una serie de slots secuenciales libres en Lunes, Miércoles y Viernes para N posts.
 */
export function getNextBatchPublishingSlots(
  count: number,
  existingPosts: ScheduledPostLike[] = [],
  preferredHour: number = 10,
  preferredMinute: number = 0,
  baseDate?: Date
): Date[] {
  const slots: Date[] = [];
  const trackingList = [...existingPosts];

  for (let i = 0; i < count; i++) {
    const nextSlot = getNextAvailablePublishingSlot(trackingList, preferredHour, preferredMinute, baseDate);
    slots.push(new Date(nextSlot));
    trackingList.push({ scheduled_at: nextSlot.toISOString() });
  }

  return slots;
}
