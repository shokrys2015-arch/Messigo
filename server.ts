import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

// Geographical bounding box for the Arab Republic of Egypt
const EGYPT_BOUNDS = {
  minLat: 22.0,
  maxLat: 31.8,
  minLng: 24.6,
  maxLng: 37.0,
};

function isValidEgyptCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= EGYPT_BOUNDS.minLat &&
    lat <= EGYPT_BOUNDS.maxLat &&
    lng >= EGYPT_BOUNDS.minLng &&
    lng <= EGYPT_BOUNDS.maxLng
  );
}

interface EgyptGeocodePlaceResult {
  lat: number;
  lng: number;
  displayName: string;
  source?: 'google_maps_grounding';
  groundingUri?: string;
  groundingTitle?: string;
}

const geocodeCache = new Map<
  string,
  {
    results: EgyptGeocodePlaceResult[];
    groundingLinks: Array<{ title: string; uri: string }>;
  }
>();

/**
 * Extracts coordinates from an expanded Google Maps URL if present.
 */
function extractCoordsFromExpandedUrl(urlStr: string): { lat: number; lng: number } | null {
  const decoded = decodeURIComponent(urlStr);
  const patterns = [
    /!3d([+-]?\d+\.\d+)!4d([+-]?\d+\.\d+)/,
    /@([+-]?\d+\.\d+),([+-]?\d+\.\d+)/,
    /[?&](?:q|query|ll|center)=([+-]?\d+\.\d+)[,\s+]+([+-]?\d+\.\d+)/,
    /\/place\/([+-]?\d+\.\d+),([+-]?\d+\.\d+)/,
  ];
  for (const regex of patterns) {
    const m = decoded.match(regex);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (isValidEgyptCoordinate(lat, lng)) {
        return { lat, lng };
      }
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Server-side Egyptian address & Google Maps short-link resolver
  app.post('/api/geocode-egypt', async (req, res) => {
    try {
      const rawQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      if (!rawQuery || rawQuery.length < 2) {
        return res.json({ results: [], groundingLinks: [] });
      }

      const cacheKey = rawQuery.toLowerCase();
      const cached = geocodeCache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      // 1. If the query is a shortened Google Maps URL (e.g. maps.app.goo.gl/...), follow the redirect server-side
      if (/^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(rawQuery)) {
        try {
          const redirectRes = await fetch(rawQuery, {
            method: 'GET',
            redirect: 'follow',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
          });
          const finalUrl = redirectRes.url || '';
          const extracted = extractCoordsFromExpandedUrl(finalUrl);
          if (extracted) {
            const payload = {
              results: [
                {
                  lat: Number(extracted.lat.toFixed(6)),
                  lng: Number(extracted.lng.toFixed(6)),
                  displayName: `موقع مستخرج من رابط خرائط جوجل (${extracted.lat.toFixed(5)}, ${extracted.lng.toFixed(5)})`,
                  source: 'google_maps_grounding' as const,
                  groundingUri: rawQuery,
                  groundingTitle: 'خرائط جوجل',
                },
              ],
              groundingLinks: [{ title: 'خرائط جوجل', uri: rawQuery }],
            };
            geocodeCache.set(cacheKey, payload);
            return res.json(payload);
          }
        } catch {
          // Continue to AI geocoding if redirect fails
        }
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.json({ results: [], groundingLinks: [] });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: `أنت خبير جغرافي متخصص في عناوين وخرائط جمهورية مصر العربية فقط.
حدد الإحداثيات الجغرافية الدقيقة (latitude, longitude) داخل مصر والاسم الرسمي الواضح بالعربية لهذا العنوان أو المكان:
"${rawQuery}"

قواعد صارمة:
1. جميع الإحداثيات يجب أن تكون داخل حدود جمهورية مصر العربية فقط (خط العرض lat بين 22.0 و 31.8 شمالًا، وخط الطول lng بين 24.6 و 37.0 شرقًا).
2. ميز بدقة تامة بين المناطق والكمبوندات المتشابهة في مصر:
   - "بالم هيلز قطامية" أو "بالم هيلز التجمع" يقع في التجمع الخامس بالقاهرة الجديدة (حوالي 30.0086, 31.4884)، بينما "بالم هيلز أكتوبر" أو "بالم هيلز المرحلة 5" بدون ذكر التجمع/القطامية يقع في 6 أكتوبر بالجيزة (حوالي 29.9964, 31.0286).
   - "غرب الجولف" في التجمع الثالث/الخامس بالقاهرة الجديدة يقع عند (حوالي 29.9985, 31.4125).
   - "سيتي سنتر مدينة نصر" (مكرم عبيد) يقع عند (30.0683, 31.3447)، بينما "سيتي سنتر ألماظة" يقع عند (30.0819, 31.3644).
3. إذا كان البحث عامًا أو يحتمل أكثر من فرع/منطقة داخل مصر، أرجع حتى 3 نتائج مرتبة حسب الأقرب للعنوان المكتوب.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              results: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lat: { type: Type.NUMBER },
                    lng: { type: Type.NUMBER },
                    displayName: { type: Type.STRING },
                  },
                  required: ['lat', 'lng', 'displayName'],
                },
              },
            },
            required: ['results'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{"results":[]}');
      const rawList = Array.isArray(parsed?.results) ? parsed.results : [];

      const results: EgyptGeocodePlaceResult[] = [];
      for (const item of rawList) {
        const lat = Number(item?.lat);
        const lng = Number(item?.lng);
        const displayName = typeof item?.displayName === 'string' ? item.displayName.trim() : '';
        if (isValidEgyptCoordinate(lat, lng) && displayName) {
          results.push({
            lat: Number(lat.toFixed(6)),
            lng: Number(lng.toFixed(6)),
            displayName,
            source: 'google_maps_grounding',
          });
        }
      }

      const payload = { results, groundingLinks: [] };
      if (results.length > 0) {
        geocodeCache.set(cacheKey, payload);
      }

      return res.json(payload);
    } catch (error) {
      console.error('Error in /api/geocode-egypt:', error);
      return res.json({ results: [], groundingLinks: [] });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Messigo server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
