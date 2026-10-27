import { Coordinates, DeliveryOrder, LocationStatus } from '../types/messigo';

/**
 * Normalizes Arabic-Indic (٠-٩) and Eastern Arabic/Persian (۰-۹) digits to standard ASCII digits (0-9).
 */
export function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Egypt geographic boundaries:
 * Latitude: 22.0° N to 31.8° N
 * Longitude: 24.6° E to 37.0° E
 */
export const EGYPT_BOUNDS = {
  minLat: 22.0,
  maxLat: 31.8,
  minLng: 24.6,
  maxLng: 37.0,
};

/**
 * Validates whether numeric latitude and longitude are geographically valid AND located within Egypt.
 */
export function isValidCoordinates(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (
    lat < EGYPT_BOUNDS.minLat ||
    lat > EGYPT_BOUNDS.maxLat ||
    lng < EGYPT_BOUNDS.minLng ||
    lng > EGYPT_BOUNDS.maxLng
  ) {
    return false;
  }
  return true;
}

export interface ParsedUrlResult {
  url: string;
  coordinates: Coordinates | null;
  hasInvalidCoordinates: boolean;
  searchQuery: string | null;
  isShortUrl: boolean;
}

/**
 * Extracts coordinates or search query from Google Maps URLs or inline coordinate strings.
 * Strictly avoids inventing coordinates when only a place search query is present.
 */
export function parseMapUrl(rawUrl: string): ParsedUrlResult {
  const url = rawUrl.trim();
  const normalizedUrl = normalizeDigits(decodeURIComponent(url.replace(/\+/g, ' ')));

  const isShortUrl =
    /maps\.app\.goo\.gl/i.test(url) ||
    /goo\.gl\/maps/i.test(url) ||
    /bit\.ly/i.test(url);

  // 1. Check explicit coordinate patterns in URL:
  // Pattern A: ?q=lat,lng or &q=lat,lng or query=lat,lng or ll=lat,lng or destination=lat,lng
  const queryCoordMatch = normalizedUrl.match(
    /(?:[?&](?:q|query|ll|destination|center|daddr|saddr)=)\s*([+-]?\d+\.\d+)\s*,\s*([+-]?\d+\.\d+)/i
  );
  if (queryCoordMatch) {
    const lat = parseFloat(queryCoordMatch[1]);
    const lng = parseFloat(queryCoordMatch[2]);
    if (isValidCoordinates(lat, lng)) {
      return { url, coordinates: { lat, lng }, hasInvalidCoordinates: false, searchQuery: null, isShortUrl };
    }
    return { url, coordinates: null, hasInvalidCoordinates: true, searchQuery: null, isShortUrl };
  }

  // Pattern B: @lat,lng
  const atCoordMatch = normalizedUrl.match(/@\s*([+-]?\d+\.\d+)\s*,\s*([+-]?\d+\.\d+)/);
  if (atCoordMatch) {
    const lat = parseFloat(atCoordMatch[1]);
    const lng = parseFloat(atCoordMatch[2]);
    if (isValidCoordinates(lat, lng)) {
      return { url, coordinates: { lat, lng }, hasInvalidCoordinates: false, searchQuery: null, isShortUrl };
    }
    return { url, coordinates: null, hasInvalidCoordinates: true, searchQuery: null, isShortUrl };
  }

  // Pattern C: !3dLAT!4dLNG
  const bangCoordMatch = normalizedUrl.match(/!3d([+-]?\d+\.\d+)!4d([+-]?\d+\.\d+)/);
  if (bangCoordMatch) {
    const lat = parseFloat(bangCoordMatch[1]);
    const lng = parseFloat(bangCoordMatch[2]);
    if (isValidCoordinates(lat, lng)) {
      return { url, coordinates: { lat, lng }, hasInvalidCoordinates: false, searchQuery: null, isShortUrl };
    }
    return { url, coordinates: null, hasInvalidCoordinates: true, searchQuery: null, isShortUrl };
  }

  // Pattern D: /maps/place/lat,lng or /maps/search/lat,lng
  const pathCoordMatch = normalizedUrl.match(
    /\/maps\/(?:place|search|dir)\/([+-]?\d+\.\d+)\s*,\s*([+-]?\d+\.\d+)/i
  );
  if (pathCoordMatch) {
    const lat = parseFloat(pathCoordMatch[1]);
    const lng = parseFloat(pathCoordMatch[2]);
    if (isValidCoordinates(lat, lng)) {
      return { url, coordinates: { lat, lng }, hasInvalidCoordinates: false, searchQuery: null, isShortUrl };
    }
    return { url, coordinates: null, hasInvalidCoordinates: true, searchQuery: null, isShortUrl };
  }

  // 2. Check if URL contains a non-coordinate search query (e.g. ?api=1&query=النادي+الأهلي+فرع+مدينة+نصر+القاهرة)
  try {
    const parsed = new URL(url);
    const qParam =
      parsed.searchParams.get('query') ||
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('destination');
    if (qParam) {
      const decodedQ = decodeURIComponent(qParam.replace(/\+/g, ' ')).trim();
      const numCheck = normalizeDigits(decodedQ).match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
      if (numCheck) {
        const lat = parseFloat(numCheck[1]);
        const lng = parseFloat(numCheck[2]);
        if (isValidCoordinates(lat, lng)) {
          return { url, coordinates: { lat, lng }, hasInvalidCoordinates: false, searchQuery: null, isShortUrl };
        }
        return { url, coordinates: null, hasInvalidCoordinates: true, searchQuery: null, isShortUrl };
      }
      if (decodedQ.length > 1) {
        return { url, coordinates: null, hasInvalidCoordinates: false, searchQuery: decodedQ, isShortUrl };
      }
    }

    // Check /maps/place/<PlaceName>
    const placeMatch = parsed.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/i);
    if (placeMatch && placeMatch[1]) {
      const placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
      if (placeName) {
        return { url, coordinates: null, hasInvalidCoordinates: false, searchQuery: placeName, isShortUrl };
      }
    }
  } catch {
    const fallbackQuery = normalizedUrl.match(/[?&](?:query|q)=([^&\s]+)/i);
    if (fallbackQuery && fallbackQuery[1]) {
      return {
        url,
        coordinates: null,
        hasInvalidCoordinates: false,
        searchQuery: fallbackQuery[1].trim(),
        isShortUrl,
      };
    }
  }

  return { url, coordinates: null, hasInvalidCoordinates: false, searchQuery: null, isShortUrl };
}

/**
 * Splits bulk pasted WhatsApp messages into individual order blocks.
 */
export function splitBulkWhatsappMessages(rawInput: string): { text: string; uncertainSplit: boolean }[] {
  const cleaned = rawInput.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  // 1. First split by explicit horizontal dividers if present
  const explicitDividerRegex = /\n\s*(?:[-=_*]{3,}|#{3,})\s*\n/;
  if (explicitDividerRegex.test(cleaned)) {
    return cleaned
      .split(explicitDividerRegex)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text, uncertainSplit: false }));
  }

  // 2. Check for WhatsApp timestamp headers:
  const waHeaderRegex = /(?:^|\n)(?=\[?\d{1,4}[/-]\d{1,2}[/-]\d{1,4}[،,\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APMapmصم])?\]?\s*(?:-\s*)?[^:\n]{1,40}:\s*)/g;
  const waBlocks = cleaned
    .split(waHeaderRegex)
    .map((s) => s.trim())
    .filter(Boolean);
  if (waBlocks.length > 1) {
    return waBlocks.map((text) => ({ text, uncertainSplit: false }));
  }

  // 3. Split by paragraphs / blank lines, then group paragraphs that belong to the same single order
  const paragraphs = cleaned
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return [{ text: cleaned, uncertainSplit: false }];
  }

  const hasCustomerStartSignal = (para: string): boolean => {
    const norm = normalizeDigits(para).replace(/[\s-]/g, '');
    const hasPhone =
      /(?:\+?20|0020|0)?1[0125]\d{8}|(?:\+?966|00966|0)?5\d{8}/.test(norm) ||
      /(?:ت|تليفون|هاتف|موبايل|جوال|رقم)\s*[:：-]?\s*\+?\d{8,14}/i.test(normalizeDigits(para));
    const startsWithCustomerHonorific =
      /^(?:الأستاذ|الاستاذ|أستاذ|استاذ|أ\/|ا\/|مدام|الحاج|كابتن|دكتور|د\/|م\/|مهندس|العميل|اسم العميل|الاسم)\s+/m.test(
        para
      );
    return hasPhone || startsWithCustomerHonorific;
  };

  const isOnlyLocationContinuation = (para: string): boolean => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    return lines.every(
      (line) =>
        /^https?:\/\/\S+$/i.test(line) ||
        /^(?:الموقع|لوكيشن|اللوكيشن|رابط الموقع|خريطة|العنوان على الخريطة|العنوان)\s*[:：-]?/i.test(line) ||
        /^(?:احداثيات|إحداثيات|خط العرض)/i.test(line)
    );
  };

  const mergedBlocks: { text: string; uncertainSplit: boolean }[] = [];
  for (const para of paragraphs) {
    if (mergedBlocks.length === 0) {
      mergedBlocks.push({ text: para, uncertainSplit: false });
      continue;
    }

    if (
      isOnlyLocationContinuation(para) ||
      (!hasCustomerStartSignal(para) && !hasCustomerStartSignal(mergedBlocks[mergedBlocks.length - 1].text))
    ) {
      mergedBlocks[mergedBlocks.length - 1].text += '\n\n' + para;
    } else if (hasCustomerStartSignal(para)) {
      mergedBlocks.push({ text: para, uncertainSplit: false });
    } else {
      mergedBlocks[mergedBlocks.length - 1].text += '\n\n' + para;
    }
  }

  return mergedBlocks;
}

/**
 * Extracts structured order fields from a single WhatsApp order message block.
 * Handles multi-line "العنوان:", compound/villa addresses, international phone formats with spaces (+20 104 ...),
 * and combines primary district/street addresses with secondary floor/apartment lines.
 */
export function parseSingleOrderMessage(
  rawBlock: string,
  uncertainSplit = false
): DeliveryOrder {
  const id = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const cleanedBlock = rawBlock
    .replace(
      /^\[?\d{1,4}[/-]\d{1,2}[/-]\d{1,4}[،,\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APMapmصم])?\]?\s*(?:-\s*)?[^:\n]{1,40}:\s*/,
      ''
    )
    .trim();

  const rawLines = cleanedBlock
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let customerName = '';
  let phone = '';
  const mainAddressParts: string[] = [];
  const subAddressParts: string[] = [];
  let locationText = '';
  let mapUrl = '';
  let searchQueryFromUrl: string | undefined;
  let coordinates: Coordinates | null = null;
  let hasInvalidCoordinates = false;
  let totalPrice = '';
  const detailLines: string[] = [];

  const consumedLineIndices = new Set<number>();

  // 0. Ignore polite closing lines like "شكراً جداً 🌸"
  rawLines.forEach((line, idx) => {
    const stripped = line.replace(/[^\u0600-\u06FFa-zA-Z0-9\s]/g, '').trim();
    if (/^(?:شكرا|شكراً|شكرا جزيلا|شكراً جزيلاً|شكرا جدا|شكراً جداً|بالتوفيق|تسلم|تحياتي)$/i.test(stripped)) {
      consumedLineIndices.add(idx);
    }
  });

  // 1. Extract URLs first (especially Google Maps links)
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;
    const urlMatch = line.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch && !mapUrl) {
      const extractedUrl = urlMatch[1];
      const parsedUrl = parseMapUrl(extractedUrl);
      mapUrl = parsedUrl.url;
      if (parsedUrl.coordinates) {
        coordinates = parsedUrl.coordinates;
      }
      if (parsedUrl.hasInvalidCoordinates) {
        hasInvalidCoordinates = true;
      }
      if (parsedUrl.searchQuery) {
        searchQueryFromUrl = parsedUrl.searchQuery;
      }
      if (
        line
          .replace(extractedUrl, '')
          .replace(/^(?:الموقع|لوكيشن|اللوكيشن|رابط الموقع|خريطة)\s*[:：-]?\s*/i, '')
          .trim() === ''
      ) {
        consumedLineIndices.add(idx);
      }
    }
  });

  // 2. Check for inline explicit coordinates
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;
    const normLine = normalizeDigits(line);
    const explicitCoordLine = normLine.match(
      /^(?:الإحداثيات|الاحداثيات|إحداثيات|احداثيات|الموقع|لوكيشن|coords?|location)\s*[:：-]?\s*([+-]?\d{1,3}\.\d{3,})\s*[,،]\s*([+-]?\d{1,3}\.\d{3,})$/i
    );
    const standaloneCoordLine = normLine.match(
      /^([+-]?\d{1,3}\.\d{4,})\s*[,،]\s*([+-]?\d{1,3}\.\d{4,})$/
    );
    const match = explicitCoordLine || standaloneCoordLine;
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (isValidCoordinates(lat, lng)) {
        coordinates = { lat, lng };
        hasInvalidCoordinates = false;
      } else {
        hasInvalidCoordinates = true;
      }
      consumedLineIndices.add(idx);
    }
  });

  // 3. Extract Phone Number (supports spaces like "+20 104 4544066" or "رقم الموبايل: 012...")
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx) || phone) return;
    const normLine = normalizeDigits(line);

    if (/^https?:\/\//i.test(normLine)) return;
    if (/(?:الإجمالي|الاجمالي|إجمالي|اجمالي|السعر|المبلغ|حساب)\s*[:：-]/i.test(normLine)) return;

    // Labeled phone line (even if "رقم الموبايل:" is followed by +20 104 4544066)
    const labeledPhoneMatch = normLine.match(
      /(?:^|\b)(?:ت|تليفون|التليفون|هاتف|الهاتف|موبايل|الموبايل|رقم الموبايل|رقم التليفون|رقم الهاتف|جوال|الجوال|رقم التواصل|تواصل|واتساب)\s*[:：-]?\s*(\+?[\d\s-]{9,18}\d)/i
    );
    if (labeledPhoneMatch) {
      let cleanedPhone = labeledPhoneMatch[1].replace(/[\s-]/g, '');
      if (cleanedPhone.startsWith('+201')) cleanedPhone = '0' + cleanedPhone.slice(3);
      else if (cleanedPhone.startsWith('201') && cleanedPhone.length === 12) cleanedPhone = '0' + cleanedPhone.slice(2);
      phone = cleanedPhone;

      const remainder = normLine
        .replace(labeledPhoneMatch[0], '')
        .replace(/^[:：,،\s-]+|[:：,،\s-]+$/g, '')
        .trim();
      if (!remainder) {
        consumedLineIndices.add(idx);
      } else {
        rawLines[idx] = remainder;
      }
      return;
    }

    // Standalone phone line with optional spaces (e.g. "+20 104 4544066" or "0122 212 3948")
    const compactNorm = normLine.replace(/[\s-]/g, '');
    const phoneMatchCompact = compactNorm.match(
      /^((?:\+?20|0020|0)?1[01245]\d{8}|(?:\+?966|00966|0)?5\d{8}|0[23]\d{7,8})$/
    );
    if (phoneMatchCompact) {
      let cleanedPhone = phoneMatchCompact[1];
      if (cleanedPhone.startsWith('+201')) cleanedPhone = '0' + cleanedPhone.slice(3);
      else if (cleanedPhone.startsWith('201') && cleanedPhone.length === 12) cleanedPhone = '0' + cleanedPhone.slice(2);
      else if (cleanedPhone.startsWith('1') && cleanedPhone.length === 10) cleanedPhone = '0' + cleanedPhone;
      phone = cleanedPhone;
      consumedLineIndices.add(idx);
    }
  });

  // 4. Extract Total Price / Cost (الإجمالي / السعر)
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;
    const normLine = normalizeDigits(line);

    const labeledPriceMatch = line.match(
      /^(?:الإجمالي|الاجمالي|إجمالي|اجمالي|السعر|سعر الطلب|المبلغ|المطلوب|الحساب|التكلفة|تحصيل)\s*[:：-]?\s*(.+)$/i
    );
    if (labeledPriceMatch) {
      totalPrice = labeledPriceMatch[1].trim();
      consumedLineIndices.add(idx);
      return;
    }

    if (
      !totalPrice &&
      /^\s*[٠-٩0-9.,]+\s*(?:جنيه|ج\.م|جم|جنية|ريال|ر\.س|درهم|دولار|EGP|SAR)\s*$/i.test(normLine)
    ) {
      totalPrice = line.trim();
      consumedLineIndices.add(idx);
    }
  });

  // 5. Extract Explicit Location ("الموقع:") & Explicit Address ("العنوان:"), including when the value is on the NEXT line!
  for (let idx = 0; idx < rawLines.length; idx++) {
    if (consumedLineIndices.has(idx)) continue;
    const line = rawLines[idx];

    // Check if line is ONLY "العنوان:" or "عنوان التوصيل:" and the actual address is on the next line
    if (/^(?:العنوان|عنوان التوصيل|عنوان|مكان التوصيل)\s*[:：-]?\s*$/i.test(line)) {
      consumedLineIndices.add(idx);
      if (idx + 1 < rawLines.length && !consumedLineIndices.has(idx + 1)) {
        mainAddressParts.push(rawLines[idx + 1].trim());
        consumedLineIndices.add(idx + 1);
      }
      continue;
    }

    // Check if line is ONLY "الموقع:" and the actual location is on the next line
    if (/^(?:الموقع|لوكيشن|اللوكيشن|المكان على الخريطة)\s*[:：-]?\s*$/i.test(line)) {
      consumedLineIndices.add(idx);
      if (idx + 1 < rawLines.length && !consumedLineIndices.has(idx + 1)) {
        const nextVal = rawLines[idx + 1].replace(/https?:\/\/\S+/gi, '').trim();
        if (nextVal) locationText = nextVal;
        consumedLineIndices.add(idx + 1);
      }
      continue;
    }

    const locationLabelMatch = line.match(
      /^(?:الموقع|لوكيشن|اللوكيشن|المكان على الخريطة)\s*[:：-]\s*(.+)$/i
    );
    if (locationLabelMatch) {
      const locVal = locationLabelMatch[1].replace(/https?:\/\/\S+/gi, '').trim();
      if (locVal) locationText = locVal;
      consumedLineIndices.add(idx);
      continue;
    }

    const addressLabelMatch = line.match(
      /^(?:العنوان|عنوان التوصيل|عنوان|مكان التوصيل|المنطقة)\s*[:：-]\s*(.+)$/i
    );
    if (addressLabelMatch) {
      mainAddressParts.push(addressLabelMatch[1].trim());
      consumedLineIndices.add(idx);
    }
  }

  // 6. Extract Customer Name
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx) || customerName) return;

    const labeledNameMatch = line.match(
      /^(?:اسم العميل|العميل|الاسم|اسم المستلم|المستلم)\s*[:：-]\s*(.+)$/i
    );
    if (labeledNameMatch) {
      customerName = labeledNameMatch[1]
        .replace(/^(?:الأستاذ|الاستاذ|أستاذ|استاذ|أ\/|ا\/)\s+/i, '')
        .replace(/[،,]+$/g, '')
        .trim();
      consumedLineIndices.add(idx);
      return;
    }

    const honorificMatch = line.match(
      /^(?:الأستاذ|الاستاذ|أستاذ|استاذ|الأستاذة|الاستاذة|مدام|الحاج|الحاجة|كابتن|دكتور|دكتورة|د\/|المهندس|مهندس|م\/)\s+(.+)$/i
    );
    if (honorificMatch) {
      customerName = honorificMatch[1].replace(/[،,]+$/g, '').trim();
      consumedLineIndices.add(idx);
    }
  });

  // Fallback customer name from first unconsumed line if it looks like a person's name
  if (!customerName) {
    const firstUnconsumedIdx = rawLines.findIndex((_, i) => !consumedLineIndices.has(i));
    if (firstUnconsumedIdx !== -1) {
      const candidate = rawLines[firstUnconsumedIdx];
      const normCandidate = normalizeDigits(candidate);
      const looksLikeAddressOrOrder =
        /(?:شارع|ش |ميدان|عمارة|برج|الدور|شقة|فرع|نادي|النادي|مول|بجوار|أمام|امام|خلف|تقاطع|مدينة|حي |فيلا|كمبوند|بالم هيلز|المرحلة|بوابة|بوابه|تجمع|التجمع|قطامية|قطاميه|طلب|أوردر|اوردر|عدد|قطعة|تيشيرت|كرتونة|علبة|سابليه|فرسكا|افريسكا|دليفري)/i.test(
          candidate
        ) || /\d{3,}/.test(normCandidate);

      if (!looksLikeAddressOrOrder && candidate.split(/\s+/).length <= 5) {
        customerName = candidate.replace(/[،,]+$/g, '').trim();
        consumedLineIndices.add(firstUnconsumedIdx);
      }
    }
  }

  // 7. Classify remaining unconsumed lines into Primary Address, Sub-Address (Floor/Apt/Gate), vs Order Details
  // Primary Geographic Address Keywords (Districts, Compounds, Streets, Landmarks)
  const primaryAddressRegex =
    /(?:شارع|ش\.|ميدان|فرع|نادي|النادي|مول|بجوار|أمام|امام|خلف|تقاطع|مدينة|مدينه|حي|كمبوند|كومبوند|بالم هيلز|ماونتن فيو|هايد بارك|ميفيدا|مدينتي|الرحاب|الشروق|العبور|كورنيش|طريق|محطة|مسجد|كنيسة|مستشفى|مدرسة|جامعة|القاهرة|القاهره|الجيزة|الجيزه|الإسكندرية|الاسكندرية|مدينة نصر|المعادي|التجمع|القاهرة الجديدة|قطامية|قطاميه|غرب الجولف|النرجس|الياسمين|البنفسج|اللوتس|الأندلس|الشيخ زايد|أكتوبر|اكتوبر|مصر الجديدة|النزهة|المهندسين|الدقي|حلوان|شبرا|فيصل|الهرم|الزمالك|المقطم|فيلا|فيلات|المرحلة|مرحلة)/i;

  // Secondary Building/Unit Keywords (Floor, Apartment, Gate, Building number without district)
  const subAddressRegex =
    /^(?:الدور|دور|شقة|شقه|عمارة|عماره|برج|عقار|بوابة|بوابه|الدخول من بوابة|الدخول من بوابه)(?:\s|$|[،,:])/i;

  // Order Item / Product / Delivery Fee Keywords
  const productOrPriceLineRegex =
    /(?:طلب|أوردر|اوردر|تيشيرت|تيشيرتات|بنطلون|قميص|حذاء|كوتشي|شنطة|حقيبة|علبة|علبه|كرتونة|قطعة|قطع|كيلو|كجم|عبوة|باكيت|وجبة|بوكس|طقم|مقاس|سابليه|فرسكا|افريسكا|شوكولاتة|شيكولاتة|عسل|مربى|عجمية|صفيح|دليفري|توصيل\s*[٠-٩0-9]+)/i;

  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;
    const cleanLine = line.replace(/https?:\/\/\S+/gi, '').trim();
    if (!cleanLine) return;

    if (/^(?:طلب تجريبي رقم|طلب رقم|أوردر رقم|اوردر رقم)\s*[٠-٩0-9]+$/i.test(cleanLine)) {
      consumedLineIndices.add(idx);
      return;
    }

    // Check if it's a product/item/delivery-fee line
    if (productOrPriceLineRegex.test(cleanLine) && !primaryAddressRegex.test(cleanLine)) {
      detailLines.push(cleanLine);
      consumedLineIndices.add(idx);
      return;
    }

    // Check if it's a primary geographic address line (e.g. "بالم هيلز المرحلة ٥ ، فيلا ٣٣١" or "١٦٦ غرب الجولف ، التجمع الثالث")
    if (primaryAddressRegex.test(cleanLine)) {
      mainAddressParts.push(cleanLine);
      consumedLineIndices.add(idx);
      return;
    }

    // Check if it's a secondary floor/apt/gate line (e.g. "الدور الأول، شقة ٤" or "الدخول من بوابه ٤")
    if (subAddressRegex.test(cleanLine)) {
      subAddressParts.push(cleanLine);
      consumedLineIndices.add(idx);
      return;
    }

    detailLines.push(cleanLine);
    consumedLineIndices.add(idx);
  });

  // Assemble full address: Primary Geographic Address first, followed by Sub-Address (Floor/Apt)
  const fullAddress = [...mainAddressParts, ...subAddressParts].join(' — ').trim();
  const primaryGeographicAddress = mainAddressParts.join('، ').trim();

  const finalAddress = fullAddress || locationText || '';
  // For map geocoding (`locationText`), prefer explicit `locationText` ("الموقع: ..."), then `primaryGeographicAddress` (without "الدور الأول شقة ٤"), then `finalAddress`
  const finalLocationLookupText =
    locationText || searchQueryFromUrl || primaryGeographicAddress || finalAddress;

  // Determine initial LocationStatus
  let locationStatus: LocationStatus = 'الموقع غير موجود';
  let reviewNote: string | undefined;

  if (hasInvalidCoordinates) {
    locationStatus = 'الإحداثيات غير صحيحة';
    reviewNote = 'الإحداثيات المستخرجة من الرسالة خارج النطاق الجغرافي الصحيح.';
  } else if (coordinates) {
    locationStatus = uncertainSplit ? 'يحتاج إلى مراجعة' : 'الموقع صحيح';
    if (uncertainSplit) {
      reviewNote = 'تم فصل هذا الأوردر تلقائيًا؛ يرجى مراجعة البيانات للتأكد من عدم تداخلها.';
    }
  } else if (searchQueryFromUrl || finalLocationLookupText || mapUrl) {
    locationStatus = 'يحتاج إلى مراجعة';
    reviewNote = searchQueryFromUrl
      ? 'الرابط عبارة عن بحث عن مكان ولا يحتوي على إحداثيات رقمية مباشرة؛ يرجى مراجعة الموقع وتأكيده على الخريطة.'
      : 'لا توجد إحداثيات رقمية مباشرة؛ يرجى مراجعة الموقع المقترح أو تحديده يدويًا على الخريطة.';
  } else {
    locationStatus = 'الموقع غير موجود';
    reviewNote = 'لم يتم العثور على عنوان أو رابط موقع في الرسالة. يرجى تحديد الموقع يدويًا على الخريطة.';
  }

  return {
    id,
    customerName: customerName || '',
    phone: phone || '',
    address: finalAddress,
    locationText: finalLocationLookupText,
    mapUrl: mapUrl || '',
    searchQueryFromUrl,
    coordinates,
    locationConfirmedByUser: Boolean(coordinates && !uncertainSplit && !hasInvalidCoordinates),
    locationStatus,
    reviewNote,
    orderDetails: detailLines.join(' ، '),
    totalPrice: totalPrice || '',
    rawMessage: rawBlock.trim(),
    deliveryStatus: 'قيد الانتظار',
    excludedFromRoute: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Sample test messages (Strictly using the football players examples).
 */
export const EXACT_PROMPT_SAMPLE_MESSAGE = `الأستاذ محمود الخطيب  
ت: 010000000000  
النادي الأهلي – فرع مدينة نصر  
طلب تجريبي رقم ١  
٤ تيشيرتات  
الإجمالي: ١٥٠٠ جنيه  

الموقع: النادي الأهلي – فرع مدينة نصر، القاهرة

https://www.google.com/maps/search/?api=1&query=النادي+الأهلي+فرع+مدينة+نصر+القاهرة`;

export const MULTI_ORDER_TEST_SAMPLE = `الأستاذ محمود الخطيب  
ت: 010000000000  
النادي الأهلي – فرع مدينة نصر  
طلب تجريبي رقم ١  
٤ تيشيرتات  
الإجمالي: ١٥٠٠ جنيه  

الموقع: النادي الأهلي – فرع مدينة نصر، القاهرة

https://www.google.com/maps/search/?api=1&query=النادي+الأهلي+فرع+مدينة+نصر+القاهرة

---

الأستاذ أحمد حسن
ت: 01011112222
شارع عباس العقاد – مدينة نصر، القاهرة
٢ حذاء رياضي
الإجمالي: ٢٢٠٠ جنيه
https://www.google.com/maps?q=30.0661,31.3361

---

كابتن محمد أبو تريكة
ت: 01122334455
ميدان روكسي – مصر الجديدة، القاهرة
٣ قميص رياضي
الإجمالي: ١٢٠٠ جنيه
https://www.google.com/maps/@30.0914,31.3146,17z

---

الأستاذ وائل جمعة
ت: 01233445566
برج القاهرة – الزمالك، القاهرة
١ حقيبة رياضية
الإجمالي: ٨٥٠ جنيه
https://www.google.com/maps?q=30.0459,31.2243`;
