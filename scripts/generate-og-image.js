const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateOgImages() {
  const publicDir = path.join(__dirname, '..', 'public');
  const logoPath = path.join(publicDir, 'logo-master-light.png');
  const iconPath = path.join(publicDir, 'logo-icon.png');

  // Read logo files and encode as base64 for embedding in SVG
  const logoBase64 = fs.readFileSync(logoPath).toString('base64');
  const iconBase64 = fs.readFileSync(iconPath).toString('base64');

  // 1. Generate 1200x630 OpenGraph Banner
  const width = 1200;
  const height = 630;

  const svgBanner = `
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Background Gradient -->
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#070b14"/>
        <stop offset="50%" stop-color="#0b1120"/>
        <stop offset="100%" stop-color="#080d1a"/>
      </linearGradient>

      <!-- Glow radial gradients -->
      <radialGradient id="indigoGlow" cx="20%" cy="30%" r="50%">
        <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="cyanGlow" cx="80%" cy="70%" r="45%">
        <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#06b6d4" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="purpleGlow" cx="50%" cy="90%" r="40%">
        <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0"/>
      </radialGradient>

      <!-- Filter for subtle drop shadow -->
      <filter id="dropShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.4"/>
      </filter>
    </defs>

    <!-- Base Canvas -->
    <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
    <rect width="${width}" height="${height}" fill="url(#indigoGlow)"/>
    <rect width="${width}" height="${height}" fill="url(#cyanGlow)"/>
    <rect width="${width}" height="${height}" fill="url(#purpleGlow)"/>

    <!-- Subtle Border Frame -->
    <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="24" fill="none" stroke="#ffffff" stroke-opacity="0.08" stroke-width="2"/>

    <!-- Top Badge -->
    <g transform="translate(600, 110)">
      <rect x="-140" y="-18" width="280" height="36" rx="18" fill="#4f46e5" fill-opacity="0.2" stroke="#6366f1" stroke-opacity="0.4" stroke-width="1.5"/>
      <circle cx="-110" cy="0" r="5" fill="#10b981"/>
      <text x="-95" y="5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="700" fill="#a5b4fc" letter-spacing="1">PLATAFORMA B2B &amp; SDR IA</text>
    </g>

    <!-- InHubFlow Master Logo in Center -->
    <g filter="url(#dropShadow)">
      <image href="data:image/png;base64,${logoBase64}" x="360" y="150" width="480" height="120" preserveAspectRatio="xMidYMid meet"/>
    </g>

    <!-- Headline Tagline -->
    <text x="600" y="325" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="34" font-weight="800" fill="#ffffff" letter-spacing="-0.5">
      Acelera tu Prospección y Cierra Más Clientes
    </text>

    <!-- Subtitle -->
    <text x="600" y="375" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="400" fill="#94a3b8">
      LinkedIn Outreach Multicanal • Cold Email con Warmup • Agente SDR IA Autónomo
    </text>

    <!-- Feature Pills -->
    <g transform="translate(600, 445)">
      <!-- Pill 1: LinkedIn -->
      <rect x="-420" y="-18" width="180" height="36" rx="18" fill="#0077b5" fill-opacity="0.18" stroke="#0077b5" stroke-opacity="0.4"/>
      <text x="-330" y="5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#38bdf8">⚡ LinkedIn Engine</text>

      <!-- Pill 2: Cold Email -->
      <rect x="-215" y="-18" width="195" height="36" rx="18" fill="#f97316" fill-opacity="0.18" stroke="#f97316" stroke-opacity="0.4"/>
      <text x="-117" y="5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#fb923c">✉️ Cold Email Cadences</text>

      <!-- Pill 3: SDR IA -->
      <rect x="10" y="-18" width="195" height="36" rx="18" fill="#8b5cf6" fill-opacity="0.18" stroke="#8b5cf6" stroke-opacity="0.4"/>
      <text x="107" y="5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#c084fc">🤖 Agente SDR con IA</text>

      <!-- Pill 4: Pipeline CRM -->
      <rect x="235" y="-18" width="185" height="36" rx="18" fill="#10b981" fill-opacity="0.18" stroke="#10b981" stroke-opacity="0.4"/>
      <text x="327" y="5" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600" fill="#34d399">🎯 Pipeline CRM</text>
    </g>

    <!-- Footer URL -->
    <text x="600" y="545" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="16" font-weight="600" fill="#64748b" letter-spacing="2">
      INHUBFLOW.ONLINE
    </text>
  </svg>
  `;

  const ogImageBannerPath = path.join(publicDir, 'og-image.png');
  await sharp(Buffer.from(svgBanner))
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(ogImageBannerPath);
  console.log('Created:', ogImageBannerPath);

  // 2. Also generate square OG icon (400x400) specifically optimized for WhatsApp small preview
  const squareSize = 400;
  const svgSquare = `
  <svg width="${squareSize}" height="${squareSize}" viewBox="0 0 ${squareSize} ${squareSize}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sqBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0b1120"/>
        <stop offset="100%" stop-color="#060913"/>
      </linearGradient>
      <radialGradient id="sqGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#4f46e5" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${squareSize}" height="${squareSize}" fill="url(#sqBg)"/>
    <rect width="${squareSize}" height="${squareSize}" fill="url(#sqGlow)"/>
    <image href="data:image/png;base64,${iconBase64}" x="50" y="30" width="300" height="300" preserveAspectRatio="xMidYMid meet"/>
    <text x="200" y="360" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800" fill="#ffffff" letter-spacing="1">INHUBFLOW</text>
  </svg>
  `;

  const ogSquarePath = path.join(publicDir, 'og-image-square.png');
  await sharp(Buffer.from(svgSquare))
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(ogSquarePath);
  console.log('Created:', ogSquarePath);
}

generateOgImages().catch(err => {
  console.error(err);
  process.exit(1);
});
