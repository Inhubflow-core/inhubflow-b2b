export interface CountryOption {
  code: string;
  name: string;
  flag: string;
  popularCities: string[];
}

export const COUNTRIES_LIST: CountryOption[] = [
  { code: "cl", name: "Chile", flag: "🇨🇱", popularCities: ["Santiago", "Valparaíso", "Concepción", "Antofagasta"] },
  { code: "br", name: "Brasil", flag: "🇧🇷", popularCities: ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba"] },
  { code: "mx", name: "México", flag: "🇲🇽", popularCities: ["Ciudad de México", "Monterrey", "Guadalajara", "Querétaro"] },
  { code: "co", name: "Colombia", flag: "🇨🇴", popularCities: ["Bogotá", "Medellín", "Cali", "Barranquilla"] },
  { code: "es", name: "España", flag: "🇪🇸", popularCities: ["Madrid", "Barcelona", "Valencia", "Sevilla"] },
  { code: "pe", name: "Perú", flag: "🇵🇪", popularCities: ["Lima", "Arequipa", "Trujillo", "Cusco"] },
  { code: "ar", name: "Argentina", flag: "🇦🇷", popularCities: ["Buenos Aires", "Córdoba", "Rosario", "Mendoza"] },
  { code: "uy", name: "Uruguay", flag: "🇺🇾", popularCities: ["Montevideo", "Punta del Este"] },
  { code: "ec", name: "Ecuador", flag: "🇪🇨", popularCities: ["Quito", "Guayaquil", "Cuenca"] },
  { code: "pa", name: "Panamá", flag: "🇵🇦", popularCities: ["Ciudad de Panamá"] },
  { code: "us", name: "Estados Unidos", flag: "🇺🇸", popularCities: ["Miami", "New York", "San Francisco", "Austin"] },
  { code: "www", name: "Global / Todos", flag: "🌐", popularCities: [] },
];

export const SAMPLE_TITLES = [
  "CEO, Director",
  "Gerente General",
  "Director de Marketing",
  "Founder",
];

export const SAMPLE_INDUSTRIES = [
  "Minería",
  "Inmobiliaria",
  "SaaS / Software",
  "Marketing & Publicidad",
];

export function toggleOrAppendPill(currentVal: string, pill: string): string {
  const cleanPill = pill.replace(/^\+/, "").trim();
  const existingTokens = currentVal
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lowerPill = cleanPill.toLowerCase();
  const foundIndex = existingTokens.findIndex((t) => t.toLowerCase() === lowerPill);

  if (foundIndex >= 0) {
    existingTokens.splice(foundIndex, 1);
    return existingTokens.join(", ");
  } else {
    return [...existingTokens, cleanPill].join(", ");
  }
}

export function isPillActive(currentVal: string, pill: string): boolean {
  const cleanPill = pill.replace(/^\+/, "").trim().toLowerCase();
  const existingTokens = currentVal
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return existingTokens.includes(cleanPill);
}
