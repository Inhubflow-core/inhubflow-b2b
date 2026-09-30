export interface CountryOption {
  code: string;
  name: string;
  flag: string;
  popularCities: string[];
}

export const COUNTRIES_LIST: CountryOption[] = [
  // Prioritarios: Latinoamérica & España
  { code: "cl", name: "Chile", flag: "🇨🇱", popularCities: ["Santiago", "Valparaíso", "Concepción", "Antofagasta"] },
  { code: "br", name: "Brasil", flag: "🇧🇷", popularCities: ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba"] },
  { code: "mx", name: "México", flag: "🇲🇽", popularCities: ["Ciudad de México", "Monterrey", "Guadalajara", "Querétaro"] },
  { code: "co", name: "Colombia", flag: "🇨🇴", popularCities: ["Bogotá", "Medellín", "Cali", "Barranquilla"] },
  { code: "ar", name: "Argentina", flag: "🇦🇷", popularCities: ["Buenos Aires", "Córdoba", "Rosario", "Mendoza"] },
  { code: "pe", name: "Perú", flag: "🇵🇪", popularCities: ["Lima", "Arequipa", "Trujillo", "Cusco"] },
  { code: "es", name: "España", flag: "🇪🇸", popularCities: ["Madrid", "Barcelona", "Valencia", "Sevilla"] },
  { code: "uy", name: "Uruguay", flag: "🇺🇾", popularCities: ["Montevideo", "Punta del Este"] },
  { code: "ec", name: "Ecuador", flag: "🇪🇨", popularCities: ["Quito", "Guayaquil", "Cuenca"] },
  { code: "pa", name: "Panamá", flag: "🇵🇦", popularCities: ["Ciudad de Panamá"] },
  { code: "cr", name: "Costa Rica", flag: "🇨🇷", popularCities: ["San José", "Alajuela", "Heredia"] },
  { code: "do", name: "República Dominicana", flag: "🇩🇴", popularCities: ["Santo Domingo", "Santiago de los Caballeros"] },
  { code: "gt", name: "Guatemala", flag: "🇬🇹", popularCities: ["Ciudad de Guatemala", "Quetzaltenango"] },
  { code: "sv", name: "El Salvador", flag: "🇸🇻", popularCities: ["San Salvador", "Santa Ana"] },
  { code: "bo", name: "Bolivia", flag: "🇧🇴", popularCities: ["Santa Cruz de la Sierra", "La Paz", "Cochabamba"] },
  { code: "py", name: "Paraguay", flag: "🇵🇾", popularCities: ["Asunción", "Ciudad del Este"] },
  { code: "ve", name: "Venezuela", flag: "🇻🇪", popularCities: ["Caracas", "Maracaibo", "Valencia"] },
  { code: "pr", name: "Puerto Rico", flag: "🇵🇷", popularCities: ["San Juan", "Bayamón"] },

  // Norteamérica
  { code: "us", name: "Estados Unidos", flag: "🇺🇸", popularCities: ["Miami", "New York", "San Francisco", "Austin", "Los Angeles"] },
  { code: "ca", name: "Canadá", flag: "🇨🇦", popularCities: ["Toronto", "Vancouver", "Montreal", "Calgary"] },

  // Europa
  { code: "uk", name: "Reino Unido", flag: "🇬🇧", popularCities: ["London", "Manchester", "Birmingham", "Edinburgh"] },
  { code: "de", name: "Alemania", flag: "🇩🇪", popularCities: ["Berlin", "Munich", "Frankfurt", "Hamburg"] },
  { code: "fr", name: "Francia", flag: "🇫🇷", popularCities: ["Paris", "Lyon", "Marseille", "Toulouse"] },
  { code: "it", name: "Italia", flag: "🇮🇹", popularCities: ["Milano", "Roma", "Torino", "Bologna"] },
  { code: "pt", name: "Portugal", flag: "🇵🇹", popularCities: ["Lisboa", "Porto", "Braga"] },
  { code: "nl", name: "Países Bajos", flag: "🇳🇱", popularCities: ["Amsterdam", "Rotterdam", "Utrecht"] },
  { code: "ch", name: "Suiza", flag: "🇨🇭", popularCities: ["Zurich", "Geneva", "Basel"] },
  { code: "se", name: "Suecia", flag: "🇸🇪", popularCities: ["Stockholm", "Gothenburg", "Malmo"] },
  { code: "no", name: "Noruega", flag: "🇳🇴", popularCities: ["Oslo", "Bergen"] },
  { code: "dk", name: "Dinamarca", flag: "🇩🇰", popularCities: ["Copenhagen", "Aarhus"] },
  { code: "fi", name: "Finlandia", flag: "🇫🇮", popularCities: ["Helsinki", "Espoo"] },
  { code: "pl", name: "Polonia", flag: "🇵🇱", popularCities: ["Warsaw", "Krakow", "Wroclaw"] },
  { code: "ie", name: "Irlanda", flag: "🇮🇪", popularCities: ["Dublin", "Cork"] },
  { code: "be", name: "Bélgica", flag: "🇧🇪", popularCities: ["Brussels", "Antwerp", "Ghent"] },
  { code: "at", name: "Austria", flag: "🇦🇹", popularCities: ["Vienna", "Salzburg"] },
  { code: "cz", name: "República Checa", flag: "🇨🇿", popularCities: ["Prague", "Brno"] },
  { code: "gr", name: "Grecia", flag: "🇬🇷", popularCities: ["Athens", "Thessaloniki"] },
  { code: "ro", name: "Rumania", flag: "🇷🇴", popularCities: ["Bucharest", "Cluj-Napoca"] },
  { code: "hu", name: "Hungría", flag: "🇭🇺", popularCities: ["Budapest"] },
  { code: "ua", name: "Ucrania", flag: "🇺🇦", popularCities: ["Kyiv", "Lviv"] },
  { code: "hr", name: "Croacia", flag: "🇭🇷", popularCities: ["Zagreb", "Split"] },
  { code: "lu", name: "Luxemburgo", flag: "🇱🇺", popularCities: ["Luxembourg"] },

  // Asia y Medio Oriente
  { code: "ae", name: "Emiratos Árabes Unidos", flag: "🇦🇪", popularCities: ["Dubai", "Abu Dhabi"] },
  { code: "sa", name: "Arabia Saudita", flag: "🇸🇦", popularCities: ["Riyadh", "Jeddah"] },
  { code: "il", name: "Israel", flag: "🇮🇱", popularCities: ["Tel Aviv", "Jerusalem"] },
  { code: "sg", name: "Singapur", flag: "🇸🇬", popularCities: ["Singapore"] },
  { code: "in", name: "India", flag: "🇮🇳", popularCities: ["Bangalore", "Mumbai", "Delhi", "Hyderabad"] },
  { code: "jp", name: "Japón", flag: "🇯🇵", popularCities: ["Tokyo", "Osaka", "Kyoto"] },
  { code: "kr", name: "Corea del Sur", flag: "🇰🇷", popularCities: ["Seoul", "Busan"] },
  { code: "hk", name: "Hong Kong", flag: "🇭🇰", popularCities: ["Hong Kong"] },
  { code: "tw", name: "Taiwán", flag: "🇹🇼", popularCities: ["Taipei"] },
  { code: "my", name: "Malasia", flag: "🇲🇾", popularCities: ["Kuala Lumpur"] },
  { code: "ph", name: "Filipinas", flag: "🇵🇭", popularCities: ["Manila", "Cebu"] },
  { code: "th", name: "Tailandia", flag: "🇹🇭", popularCities: ["Bangkok"] },
  { code: "id", name: "Indonesia", flag: "🇮🇩", popularCities: ["Jakarta", "Surabaya"] },
  { code: "vn", name: "Vietnam", flag: "🇻🇳", popularCities: ["Ho Chi Minh City", "Hanoi"] },
  { code: "tr", name: "Turquía", flag: "🇹🇷", popularCities: ["Istanbul", "Ankara"] },
  { code: "qa", name: "Qatar", flag: "🇶🇦", popularCities: ["Doha"] },

  // Oceanía
  { code: "au", name: "Australia", flag: "🇦🇺", popularCities: ["Sydney", "Melbourne", "Brisbane", "Perth"] },
  { code: "nz", name: "Nueva Zelanda", flag: "🇳🇿", popularCities: ["Auckland", "Wellington"] },

  // África
  { code: "za", name: "Sudáfrica", flag: "🇿🇦", popularCities: ["Johannesburg", "Cape Town"] },
  { code: "eg", name: "Egipto", flag: "🇪🇬", popularCities: ["Cairo", "Alexandria"] },
  { code: "ma", name: "Marruecos", flag: "🇲🇦", popularCities: ["Casablanca", "Rabat"] },
  { code: "ng", name: "Nigeria", flag: "🇳🇬", popularCities: ["Lagos", "Abuja"] },
  { code: "ke", name: "Kenia", flag: "🇰🇪", popularCities: ["Nairobi"] },

  // Global
  { code: "www", name: "Global / Todos", flag: "🌐", popularCities: [] },
];

export const SAMPLE_TITLES = [
  "Director de Marketing",
  "Director Comercial",
  "Gerente General",
  "Director de Operaciones",
  "Director de Finanzas",
  "Director de Tecnología",
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
