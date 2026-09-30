import { DISCIPLINE_KEYWORDS, normalizeSearchText, XRAY_TITLE_SYNONYMS } from "./query";

export interface TitleSuggestion {
  term: string;
  relation: "synonym" | "related";
  category?: string;
}

export interface TitleSuggestionsResult {
  primary: string;
  suggestions: TitleSuggestion[];
}

// Curated suggestion dictionary with high-precision synonyms and related roles
const CURATED_SUGGESTIONS: Record<
  string,
  { synonyms: string[]; related: string[] }
> = {
  marketing: {
    synonyms: [
      "Director de Marketing",
      "Gerente de Marketing",
      "Head of Marketing",
      "Marketing Manager",
      "CMO",
      "Chief Marketing Officer",
      "VP of Marketing",
      "Directora de Marketing",
    ],
    related: [
      "Brand Manager",
      "Head of Growth",
      "Growth Marketing Manager",
      "Digital Marketing Manager",
      "Gerente de Publicidad",
      "Communications Director",
    ],
  },
  ventas: {
    synonyms: [
      "Director Comercial",
      "Gerente Comercial",
      "Head of Sales",
      "Director de Ventas",
      "Gerente de Ventas",
      "VP of Sales",
      "Chief Commercial Officer",
      "CRO",
    ],
    related: [
      "Key Account Manager (KAM)",
      "Business Development Manager",
      "Account Executive",
      "Gerente de Cuentas",
      "Sales Lead",
      "Gerente de Expansión",
    ],
  },
  general: {
    synonyms: [
      "Gerente General",
      "Director General",
      "CEO",
      "Chief Executive Officer",
      "General Manager",
      "Managing Director",
      "Presidente Ejecutivo",
    ],
    related: [
      "Country Manager",
      "Socio Director",
      "Managing Partner",
      "Vicepresidente Ejecutivo",
      "Director Ejecutivo",
    ],
  },
  operaciones: {
    synonyms: [
      "Director de Operaciones",
      "Gerente de Operaciones",
      "COO",
      "Chief Operating Officer",
      "Head of Operations",
      "VP of Operations",
    ],
    related: [
      "Gerente de Logística",
      "Supply Chain Manager",
      "Operations Manager",
      "Gerente de Planta",
      "Gerente de Procesos",
    ],
  },
  finanzas: {
    synonyms: [
      "Director de Finanzas",
      "Gerente de Finanzas",
      "CFO",
      "Chief Financial Officer",
      "Director Financiero",
      "Head of Finance",
    ],
    related: [
      "Financial Controller",
      "Gerente de Administración y Finanzas",
      "Finance Manager",
      "Tesorero",
      "Auditor Senior",
    ],
  },
  tecnologia: {
    synonyms: [
      "Director de Tecnología",
      "CTO",
      "Chief Technology Officer",
      "Head of Engineering",
      "VP of Engineering",
      "Gerente de TI",
      "Director de TI",
    ],
    related: [
      "Tech Lead",
      "Engineering Manager",
      "Software Architect",
      "Director de Sistemas",
      "Chief Information Officer (CIO)",
    ],
  },
  rrhh: {
    synonyms: [
      "Director de Recursos Humanos",
      "Gerente de Recursos Humanos",
      "Gerente de RRHH",
      "CHRO",
      "Head of People",
      "Chief Human Resources Officer",
      "Director de Personas",
    ],
    related: [
      "Talent Acquisition Manager",
      "People Operations Lead",
      "HR Business Partner",
      "Gerente de Talento Humano",
      "Culture & People Lead",
    ],
  },
  founder: {
    synonyms: [
      "Founder",
      "Co-Founder",
      "Fundador",
      "Co-Fundador",
      "Fundadora",
      "Creador",
    ],
    related: [
      "CEO & Founder",
      "Managing Partner",
      "Emprendedor",
      "Socio Fundador",
    ],
  },
  legal: {
    synonyms: [
      "Director Legal",
      "Gerente Legal",
      "General Counsel",
      "Chief Legal Officer",
      "Socio Legal",
    ],
    related: [
      "Legal Counsel",
      "Abogado Corporativo",
      "Compliance Officer",
      "Socio de Despacho",
    ],
  },
  producto: {
    synonyms: [
      "Head of Product",
      "Director de Producto",
      "Chief Product Officer (CPO)",
      "VP of Product",
      "Product Director",
    ],
    related: [
      "Product Manager",
      "Senior Product Manager",
      "Product Lead",
      "Product Owner",
    ],
  },
};

/**
 * Generates synonyms and related job titles based on user's input.
 * Exactly like RecruitEm's "Show similar jobs" / "Find related job titles" feature.
 */
export function getJobTitleSuggestions(input: string): TitleSuggestionsResult {
  const cleanInput = input.trim();
  if (!cleanInput) {
    return { primary: "", suggestions: [] };
  }

  // Pick the primary token if multiple are entered
  const firstToken = cleanInput.split(/[,;/|]+|\b(?:or)\b/i)[0].trim();
  const norm = normalizeSearchText(firstToken);

  const seen = new Set<string>([normalizeSearchText(firstToken)]);
  const suggestions: TitleSuggestion[] = [];

  // 1. Direct match in curated categories
  for (const [catKey, data] of Object.entries(CURATED_SUGGESTIONS)) {
    const matchesCategory =
      norm.includes(catKey) ||
      DISCIPLINE_KEYWORDS[catKey]?.some((kw) => {
        const regex = new RegExp(`(^|[^a-z0-9])${kw}([^a-z0-9]|$)`, "i");
        return regex.test(norm);
      });

    if (matchesCategory) {
      for (const syn of data.synonyms) {
        const sNorm = normalizeSearchText(syn);
        if (!seen.has(sNorm)) {
          seen.add(sNorm);
          suggestions.push({ term: syn, relation: "synonym", category: catKey });
        }
      }
      for (const rel of data.related) {
        const rNorm = normalizeSearchText(rel);
        if (!seen.has(rNorm)) {
          seen.add(rNorm);
          suggestions.push({ term: rel, relation: "related", category: catKey });
        }
      }
      break;
    }
  }

  // 2. Check XRAY_TITLE_SYNONYMS dictionary for specific term matches
  if (suggestions.length === 0) {
    const dictSyns = XRAY_TITLE_SYNONYMS[norm];
    if (dictSyns && dictSyns.length > 0) {
      for (const s of dictSyns) {
        const clean = s.replace(/^"|"$/g, "");
        const sNorm = normalizeSearchText(clean);
        if (!seen.has(sNorm)) {
          seen.add(sNorm);
          suggestions.push({ term: clean, relation: "synonym" });
        }
      }
    }
  }

  // 3. Dynamic generic expansion if term is custom (e.g. "Ciberseguridad", "Banca", "Logística")
  if (suggestions.length < 4) {
    const capitalized = firstToken.charAt(0).toUpperCase() + firstToken.slice(1);
    const dynamicRoles = [
      { title: `Director de ${capitalized}`, relation: "synonym" as const },
      { title: `Gerente de ${capitalized}`, relation: "synonym" as const },
      { title: `Head of ${capitalized}`, relation: "synonym" as const },
      { title: `VP of ${capitalized}`, relation: "synonym" as const },
      { title: `Líder de ${capitalized}`, relation: "related" as const },
      { title: `Consultor Senior de ${capitalized}`, relation: "related" as const },
    ];

    for (const r of dynamicRoles) {
      const rNorm = normalizeSearchText(r.title);
      if (!seen.has(rNorm)) {
        seen.add(rNorm);
        suggestions.push({ term: r.title, relation: r.relation });
      }
    }
  }

  return {
    primary: firstToken,
    suggestions: suggestions.slice(0, 12),
  };
}
