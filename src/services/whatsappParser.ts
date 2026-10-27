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
 * Validates whether numeric latitude and longitude are geographically valid and not (0,0).
 */
export function isValidCoordinates(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
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
    // Fallback regex if URL constructor fails
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
 * Handles:
 * - Explicit separator lines (---, ===, ***, ___)
 * - WhatsApp chat headers ([10/27/26, 9:15 AM] Sender: ... or 27/10/2026، 9:15 ص - Sender: ...)
 * - Multiple customer blocks separated by blank lines when each block contains its own phone number or customer header.
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
  // e.g. [27/10/2026, 09:14:24] Name: or 27/10/2026, 09:14 - Name:
  const waHeaderRegex = /(?:^|\n)(?=\[?\d{1,4}[/-]\d{1,2}[/-]\d{1,4}[،,\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[APMapmصم])?\]?\s*(?:-\s*)?[^:\n]{1,40}:\s*)/g;
  const waBlocks = cleaned
    .split(waHeaderRegex)
    .map((s) => s.trim())
    .filter(Boolean);
  if (waBlocks.length > 1) {
    return waBlocks.map((text) => ({ text, uncertainSplit: false }));
  }

  // 3. Split by paragraphs / blank lines, then group paragraphs that belong to the same single order
  // (for example, when "الموقع: ..." and the Google Maps URL are separated by blank lines after the order body,
  // just like in the prompt's test example!)
  const paragraphs = cleaned
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return [{ text: cleaned, uncertainSplit: false }];
  }

  const hasCustomerStartSignal = (para: string): boolean => {
    const norm = normalizeDigits(para);
    const hasPhone = /(?:^|\D)(?:\+?20|0)?1[0125]\d{8}(?:\D|$)|(?:^|\D)(?:\+?966|0)?5\d{8}(?:\D|$)|(?:ت|تليفون|هاتف|موبايل|جوال|رقم)\s*[:：-]?\s*\d{8,14}/i.test(norm);
    const startsWithCustomerHonorific = /^(?:الأستاذ|الاستاذ|أستاذ|استاذ|أ\/|ا\/|مدام|الحاج|كابتن|دكتور|د\/|م\/|مهندس|العميل|اسم العميل|الاسم)\s+/m.test(para);
    return hasPhone || startsWithCustomerHonorific;
  };

  const isOnlyLocationContinuation = (para: string): boolean => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    return lines.every(
      (line) =>
        /^https?:\/\/\S+$/i.test(line) ||
        /^(?:الموقع|لوكيشن|اللوكيشن|رابط الموقع|خريطة|العنوان على الخريطة)\s*[:：-]/i.test(line) ||
        /^(?:احداثيات|إحداثيات|خط العرض)/i.test(line)
    );
  };

  const mergedBlocks: { text: string; uncertainSplit: boolean }[] = [];
  for (const para of paragraphs) {
    if (mergedBlocks.length === 0) {
      mergedBlocks.push({ text: para, uncertainSplit: false });
      continue;
    }

    if (isOnlyLocationContinuation(para) || (!hasCustomerStartSignal(para) && !hasCustomerStartSignal(mergedBlocks[mergedBlocks.length - 1].text))) {
      mergedBlocks[mergedBlocks.length - 1].text += '\n\n' + para;
    } else if (hasCustomerStartSignal(para)) {
      mergedBlocks.push({ text: para, uncertainSplit: false });
    } else {
      // Attached to previous block if it doesn't look like a new customer
      mergedBlocks[mergedBlocks.length - 1].text += '\n\n' + para;
    }
  }

  // Final check: does any single block contain TWO distinct phone numbers on different non-adjacent lines
  // that look like two separate customers pasted without blank lines?
  const finalBlocks: { text: string; uncertainSplit: boolean }[] = [];
  for (const block of mergedBlocks) {
    const lines = block.text.split('\n');
    const customerStartIndices: number[] = [];
    lines.forEach((line, idx) => {
      if (
        /^(?:الأستاذ|الاستاذ|أستاذ|استاذ|العميل|اسم العميل|الاسم|أوردر رقم|طلب رقم)\s*[:：-]?\s*\S+/i.test(
          line.trim()
        ) &&
        idx > 0
      ) {
        // Check if previous lines already had a phone number
        const prevText = normalizeDigits(lines.slice(0, idx).join('\n'));
        if (/(?:\+?20|0)?1[0125]\d{8}|(?:\+?966|0)?5\d{8}/.test(prevText)) {
          customerStartIndices.push(idx);
        }
      }
    });

    if (customerStartIndices.length > 0) {
      let start = 0;
      for (const splitIdx of customerStartIndices) {
        finalBlocks.push({
          text: lines.slice(start, splitIdx).join('\n').trim(),
          uncertainSplit: false,
        });
        start = splitIdx;
      }
      finalBlocks.push({
        text: lines.slice(start).join('\n').trim(),
        uncertainSplit: false,
      });
    } else {
      finalBlocks.push(block);
    }
  }

  return finalBlocks;
}

/**
 * Extracts structured order fields from a single WhatsApp order message block.
 * Never confuses phone numbers, prices, and geographic coordinates.
 */
export function parseSingleOrderMessage(
  rawBlock: string,
  uncertainSplit = false
): DeliveryOrder {
  const id = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  // Strip leading WhatsApp chat timestamp prefix if present
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
  let address = '';
  let locationText = '';
  let mapUrl = '';
  let searchQueryFromUrl: string | undefined;
  let coordinates: Coordinates | null = null;
  let hasInvalidCoordinates = false;
  let totalPrice = '';
  const detailLines: string[] = [];

  const consumedLineIndices = new Set<number>();

  // 1. Extract URLs first (especially Google Maps links)
  rawLines.forEach((line, idx) => {
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
      // If the line was ONLY the URL, mark line as consumed
      if (line.replace(extractedUrl, '').replace(/^(?:الموقع|لوكيشن|اللوكيشن|رابط الموقع|خريطة)\s*[:：-]?\s*/i, '').trim() === '') {
        consumedLineIndices.add(idx);
      }
    }
  });

  // 2. Check for inline explicit coordinates (e.g., "الإحداثيات: 30.0712, 31.3521" or plain "30.071234, 31.352145")
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

  // 3. Extract Phone Number (strictly distinguishing from prices and coordinates)
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx) || phone) return;
    const normLine = normalizeDigits(line);

    // Avoid matching inside URLs or price lines
    if (/^https?:\/\//i.test(normLine)) return;
    if (/(?:الإجمالي|الاجمالي|إجمالي|اجمالي|السعر|المبلغ|حساب)\s*[:：-]/i.test(normLine)) return;

    // Explicit phone prefix: ت: / تليفون: / موبايل: / هاتف: / جوال: / رقم:
    const labeledPhoneMatch = normLine.match(
      /^(?:ت|تليفون|التليفون|هاتف|الهاتف|موبايل|الموبايل|جوال|الجوال|رقم|الرقم|تواصل|واتساب)\s*[:：-]?\s*(\+?\d[\d\s-]{8,15}\d)$/i
    );
    if (labeledPhoneMatch) {
      phone = labeledPhoneMatch[1].replace(/[\s-]/g, '');
      consumedLineIndices.add(idx);
      return;
    }

    // Egyptian mobile pattern (010, 011, 012, 015) or Saudi/Gulf mobile pattern
    const standalonePhoneMatch = normLine.match(
      /(?:^|(?:ت|تليفون|هاتف|موبايل|جوال|رقم)\s*[:：-]?\s*)((?:\+?20|0020|0)?1[0125]\d{8}|(?:\+?966|00966|0)?5\d{8}|0[23]\d{7,8})\b/
    );
    if (standalonePhoneMatch) {
      const extractedPhone = standalonePhoneMatch[1].replace(/[\s-]/g, '');
      phone = extractedPhone.startsWith('1') && extractedPhone.length === 10 ? `0${extractedPhone}` : extractedPhone;
      const remainder = normLine
        .replace(standalonePhoneMatch[0], '')
        .replace(/^[:：,\s-]+|[:：,\s-]+$/g, '')
        .trim();
      if (!remainder) {
        consumedLineIndices.add(idx);
      }
    }
  });

  // 4. Extract Total Price / Cost (الإجمالي / السعر)
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;
    const normLine = normalizeDigits(line);

    // Labeled total line: "الإجمالي: ١٥٠٠ جنيه" or "السعر: 500 ج"
    const labeledPriceMatch = line.match(
      /^(?:الإجمالي|الاجمالي|إجمالي|اجمالي|السعر|سعر الطلب|المبلغ|المطلوب|الحساب|التكلفة|تحصيل)\s*[:：-]?\s*(.+)$/i
    );
    if (labeledPriceMatch) {
      totalPrice = labeledPriceMatch[1].trim();
      consumedLineIndices.add(idx);
      return;
    }

    // Line that is purely a price with currency (e.g. "1500 جنيه")
    if (!totalPrice && /^\s*[٠-٩0-9.,]+\s*(?:جنيه|ج\.م|جم|جنية|ريال|ر\.س|درهم|دولار|EGP|SAR)\s*$/i.test(normLine)) {
      totalPrice = line.trim();
      consumedLineIndices.add(idx);
    }
  });

  // 5. Extract Explicit Location Line ("الموقع: ...") and Explicit Address Line ("العنوان: ...")
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;

    const locationLabelMatch = line.match(
      /^(?:الموقع|لوكيشن|اللوكيشن|المكان على الخريطة)\s*[:：-]\s*(.+)$/i
    );
    if (locationLabelMatch) {
      const locVal = locationLabelMatch[1].replace(/https?:\/\/\S+/gi, '').trim();
      if (locVal) {
        locationText = locVal;
      }
      consumedLineIndices.add(idx);
      return;
    }

    const addressLabelMatch = line.match(
      /^(?:العنوان|عنوان التوصيل|عنوان|مكان التوصيل|المنطقة)\s*[:：-]\s*(.+)$/i
    );
    if (addressLabelMatch) {
      address = addressLabelMatch[1].trim();
      consumedLineIndices.add(idx);
    }
  });

  // 6. Extract Customer Name
  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx) || customerName) return;

    // Labeled customer name: "العميل: ..." or "الاسم: ..."
    const labeledNameMatch = line.match(
      /^(?:اسم العميل|العميل|الاسم|اسم المستلم|المستلم)\s*[:：-]\s*(.+)$/i
    );
    if (labeledNameMatch) {
      customerName = labeledNameMatch[1]
        .replace(/^(?:الأستاذ|الاستاذ|أستاذ|استاذ|أ\/|ا\/)\s+/i, '')
        .trim();
      consumedLineIndices.add(idx);
      return;
    }

    // Honorific prefix: "الأستاذ محمود الخطيب"
    const honorificMatch = line.match(
      /^(?:الأستاذ|الاستاذ|أستاذ|استاذ|الأستاذة|الاستاذة|مدام|الحاج|الحاجة|كابتن|دكتور|دكتورة|د\/|المهندس|مهندس|م\/)\s+(.+)$/i
    );
    if (honorificMatch) {
      customerName = honorificMatch[1].trim();
      consumedLineIndices.add(idx);
    }
  });

  // If customerName wasn't explicitly labeled or prefixed, check if the first unconsumed line is a name
  if (!customerName) {
    const firstUnconsumedIdx = rawLines.findIndex((_, i) => !consumedLineIndices.has(i));
    if (firstUnconsumedIdx !== -1) {
      const candidate = rawLines[firstUnconsumedIdx];
      const normCandidate = normalizeDigits(candidate);
      const looksLikeAddressOrOrder =
        /(?:شارع|ش |ميدان|عمارة|برج|الدور|شقة|فرع|نادي|النادي|مول|بجوار|أمام|امام|خلف|تقاطع|مدينة|حي |طلب|أوردر|اوردر|عدد|قطعة|تيشيرت|كرتونة|علبة)/i.test(
          candidate
        ) || /\d{3,}/.test(normCandidate);

      if (!looksLikeAddressOrOrder && candidate.split(/\s+/).length <= 5) {
        customerName = candidate.trim();
        consumedLineIndices.add(firstUnconsumedIdx);
      }
    }
  }

  // 7. Classify remaining unconsumed lines into Address vs Order Details
  const addressKeywords =
    /(?:شارع|ش\.|ميدان|عمارة|برج|الدور|شقة|فرع|نادي|النادي|مول|بجوار|أمام|امام|خلف|تقاطع|مدينة|حي|كمبوند|كومبوند|كورنيش|طريق|محطة|مسجد|كنيسة|مستشفى|مدرسة|جامعة|القاهرة|الجيزة|الإسكندرية|الاسكندرية|مدينة نصر|المعادي|التجمع|الشيخ زايد|أكتوبر|اكتوبر|مصر الجديدة|المهندسين|الدقي|حلوان|شبرا|فيصل|الهرم)/i;
  const orderKeywords =
    /(?:طلب|أوردر|اوردر|رقم|تيشيرت|تيشيرتات|بنطلون|قميص|حذاء|كوتشي|شنطة|علبة|كرتونة|قطعة|قطع|كيلو|كجم|جم|عبوة|باكيت|وجبة|بوكس|طقم|عدد|مقاس|لون)/i;

  rawLines.forEach((line, idx) => {
    if (consumedLineIndices.has(idx)) return;
    const cleanLine = line.replace(/https?:\/\/\S+/gi, '').trim();
    if (!cleanLine) return;

    // Ignore generic order number header lines like "طلب تجريبي رقم ١" if followed by actual item lines,
    // or include them if no other details exist
    if (/^(?:طلب تجريبي رقم|طلب رقم|أوردر رقم|اوردر رقم)\s*[٠-٩0-9]+$/i.test(cleanLine)) {
      consumedLineIndices.add(idx);
      return;
    }

    if (!address && addressKeywords.test(cleanLine) && !orderKeywords.test(cleanLine)) {
      address = cleanLine;
      consumedLineIndices.add(idx);
      return;
    }

    detailLines.push(cleanLine);
    consumedLineIndices.add(idx);
  });

  // If address is still empty but locationText was extracted, use locationText as fallback display address
  if (!address && locationText) {
    address = locationText;
  }

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
  } else if (searchQueryFromUrl || locationText || address || mapUrl) {
    // Has a place search link or textual location/address that will be looked up via geocoding service
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
    address: address || '',
    locationText: locationText || searchQueryFromUrl || address || '',
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
 * Sample test messages including the exact required test message from Section 4 of the specification.
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
