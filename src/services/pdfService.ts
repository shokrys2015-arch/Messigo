import { DayRecord, DeliveryOrder, RouteLegInfo } from '../types/messigo';
import { formatDistanceArabic, formatDurationArabic } from './routingService';

export function parsePriceNumber(priceStr: string | undefined): number {
  if (!priceStr) return 0;
  const normalized = priceStr
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d).toString())
    .replace(/[^\d.]/g, '');
  const val = parseFloat(normalized);
  return Number.isFinite(val) ? val : 0;
}

/**
 * Wraps Arabic/English text into multiple lines that fit within maxWidth pixels.
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const clean = (text || '').trim();
  if (!clean) return ['-'];

  const paragraphs = clean.split(/\n+/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let currentLine = words[0];
    for (let i = 1; i < words.length; i++) {
      const testLine = currentLine + ' ' + words[i];
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = words[i];
      }
    }
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : ['-'];
}

/**
 * Draws a rounded rectangle path on a 2D canvas context.
 */
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillColor?: string,
  strokeColor?: string,
  lineWidth = 1
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Encodes an array of JPEG data URLs into a standard multi-page A4 PDF 1.4 binary Blob.
 */
function buildPdfBlobFromJpegPages(
  jpegDataUrls: string[],
  pixelWidth: number,
  pixelHeight: number
): Blob {
  // Standard A4 dimensions in PDF points (72 dpi)
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;

  const jpegBytesList: Uint8Array[] = jpegDataUrls.map((dataUrl) => {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  });

  // Object numbering plan:
  // 1: Catalog
  // 2: Pages
  // For each page i (0..N-1):
  //   3 + i*3 : Page object
  //   4 + i*3 : Content stream object
  //   5 + i*3 : Image XObject
  const numPages = jpegBytesList.length;
  const totalObjects = 2 + numPages * 3;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = new Array(totalObjects + 1).fill(0);
  let currentOffset = 0;

  const encoder = new TextEncoder();
  const pushStr = (str: string) => {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    currentOffset += bytes.byteLength;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    currentOffset += bytes.byteLength;
  };

  // PDF Header
  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // Object 1: Catalog
  offsets[1] = currentOffset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages
  const kidsRefs = Array.from({ length: numPages }, (_, i) => `${3 + i * 3} 0 R`).join(' ');
  offsets[2] = currentOffset;
  pushStr(`2 0 obj\n<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${numPages} >>\nendobj\n`);

  // Pages + Content Streams + Image XObjects
  for (let i = 0; i < numPages; i++) {
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;
    const imgName = `/Im${i + 1}`;
    const jpegBytes = jpegBytesList[i];

    // Page Object
    offsets[pageObjId] = currentOffset;
    pushStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)} ] ` +
        `/Resources << /XObject << ${imgName} ${imageObjId} 0 R >> >> ` +
        `/Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Content Stream (draws the image scaled to the A4 page)
    const contentStream = `q\n${pageWidthPt.toFixed(2)} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n${imgName} Do\nQ\n`;
    offsets[contentObjId] = currentOffset;
    pushStr(
      `${contentObjId} 0 obj\n` +
        `<< /Length ${contentStream.length} >>\n` +
        `stream\n` +
        contentStream +
        `endstream\n` +
        `endobj\n`
    );

    // Image XObject
    offsets[imageObjId] = currentOffset;
    pushStr(
      `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\n` +
        `stream\n`
    );
    pushBytes(jpegBytes);
    pushStr(`\nendstream\nendobj\n`);
  }

  // XRef Table
  const xrefOffset = currentOffset;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr(`0000000000 65535 f \n`);
  for (let objId = 1; objId <= totalObjects; objId++) {
    const padded = String(offsets[objId]).padStart(10, '0');
    pushStr(`${padded} 00000 n \n`);
  }

  // Trailer
  pushStr(
    `trailer\n` +
      `<< /Size ${totalObjects + 1} /Root 1 0 R >>\n` +
      `startxref\n` +
      `${xrefOffset}\n` +
      `%%EOF\n`
  );

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

interface StopRowRenderData {
  visitNumber: number;
  order: DeliveryOrder;
  leg: RouteLegInfo | null;
  customerLines: string[];
  addressLines: string[];
  detailsLines: string[];
  rowHeight: number;
}

/**
 * Renders the full delivery route manifest into high-resolution A4 canvas pages
 * and returns a genuine PDF File + Blob ready for sharing or downloading.
 */
export async function generateRoutePdfFile(day: DayRecord): Promise<{
  file: File;
  blob: Blob;
  fileName: string;
}> {
  if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
    try {
      await (document as any).fonts.ready;
    } catch {
      // ignore font wait errors
    }
  }

  const PAGE_W = 1240;
  const PAGE_H = 1754;
  const MARGIN_X = 56;
  const CONTENT_W = PAGE_W - MARGIN_X * 2; // 1128px

  const route = day.calculatedRoute;
  const orders = day.orders || [];

  const orderedStops = route
    ? route.orderedOrderIds
        .map((id, idx) => {
          const order = orders.find((o) => o.id === id);
          if (!order) return null;
          const leg = route.legs.find((l) => l.orderId === id) || null;
          return { visitNumber: idx + 1, order, leg };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
    : orders.map((order, idx) => ({ visitNumber: idx + 1, order, leg: null }));

  // Also append any excluded orders at the end if they weren't in route.orderedOrderIds
  if (route) {
    const inRouteIds = new Set(route.orderedOrderIds);
    orders.forEach((order) => {
      if (!inRouteIds.has(order.id)) {
        orderedStops.push({
          visitNumber: orderedStops.length + 1,
          order,
          leg: null,
        });
      }
    });
  }

  const activeOrders = orders.filter((o) => !o.excludedFromRoute);
  const deliveredCount = activeOrders.filter((o) => o.deliveryStatus === 'تم التسليم').length;
  const remainingCount = activeOrders.length - deliveredCount;

  const totalOrdersNetAmount = activeOrders.reduce(
    (sum, o) => sum + parsePriceNumber(o.totalPrice),
    0
  );
  const totalDeliveryFeeAmount = activeOrders.reduce(
    (sum, o) => sum + parsePriceNumber(o.deliveryFee),
    0
  );

  // Column widths (RTL from right to left, total = 1128px):
  // Col 0 (#): 58px
  // Col 1 (Customer & Phone): 215px
  // Col 2 (Address): 325px
  // Col 3 (Order Details): 210px
  // Col 4 (Order Price without Delivery): 115px
  // Col 5 (Delivery Fee): 110px
  // Col 6 (Distance): 95px
  const COL_WIDTHS = [58, 215, 325, 210, 115, 110, 95];
  const COL_RIGHT_X: number[] = [];
  let accRight = PAGE_W - MARGIN_X;
  for (let i = 0; i < COL_WIDTHS.length; i++) {
    COL_RIGHT_X.push(accRight);
    accRight -= COL_WIDTHS[i];
  }

  // Measure and pre-wrap all rows using a scratch context
  const scratchCanvas = document.createElement('canvas');
  scratchCanvas.width = 100;
  scratchCanvas.height = 100;
  const mCtx = scratchCanvas.getContext('2d')!;
  const fontFamily = '"IBM Plex Sans Arabic", "Cairo", sans-serif';

  const preparedRows: StopRowRenderData[] = orderedStops.map(({ visitNumber, order, leg }) => {
    const isExcluded = Boolean(order.excludedFromRoute);
    const nameStr =
      (order.customerName || 'بدون اسم') + (isExcluded ? ' (مستبعد)' : '');

    mCtx.font = `700 17px ${fontFamily}`;
    const customerLines = wrapCanvasText(mCtx, nameStr, COL_WIDTHS[1] - 20);

    mCtx.font = `500 16px ${fontFamily}`;
    const addressText = order.address || order.locationText || 'لم يحدد عنوان نصي';
    const addressLines = wrapCanvasText(mCtx, addressText, COL_WIDTHS[2] - 24);

    mCtx.font = `400 15px ${fontFamily}`;
    const detailsText = order.orderDetails || 'بدون تفاصيل';
    const detailsLines = wrapCanvasText(mCtx, detailsText, COL_WIDTHS[3] - 20);

    const col1Height = customerLines.length * 24 + (order.phone ? 24 : 20) + 28;
    const col2Height = addressLines.length * 24 + (order.coordinates ? 22 : 0) + 20;
    const col3Height = detailsLines.length * 22 + 20;

    const rowHeight = Math.max(82, col1Height, col2Height, col3Height);
    return {
      visitNumber,
      order,
      leg,
      customerLines,
      addressLines,
      detailsLines,
      rowHeight,
    };
  });

  // Paginate rows across A4 pages
  const FIRST_PAGE_TABLE_START_Y = 390;
  const NEXT_PAGE_TABLE_START_Y = 160;
  const TABLE_HEADER_H = 52;
  const FOOTER_RESERVED_H = 140; // space for tfoot + page footer

  const pagesRows: StopRowRenderData[][] = [];
  let currentPageRows: StopRowRenderData[] = [];
  let currentY = FIRST_PAGE_TABLE_START_Y + TABLE_HEADER_H;

  for (const row of preparedRows) {
    const maxY = PAGE_H - FOOTER_RESERVED_H;
    if (currentPageRows.length > 0 && currentY + row.rowHeight > maxY) {
      pagesRows.push(currentPageRows);
      currentPageRows = [row];
      currentY = NEXT_PAGE_TABLE_START_Y + TABLE_HEADER_H + row.rowHeight;
    } else {
      currentPageRows.push(row);
      currentY += row.rowHeight;
    }
  }
  if (currentPageRows.length > 0 || pagesRows.length === 0) {
    pagesRows.push(currentPageRows);
  }

  const totalPages = pagesRows.length;
  const jpegDataUrls: string[] = [];

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';

    let y = 52;

    if (pageIdx === 0) {
      // --- PAGE 1 FULL HEADER ---
      // Brand Title (Right)
      ctx.textAlign = 'right';
      ctx.font = `900 34px "Cairo", ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText('MESSIGO', PAGE_W - MARGIN_X, y);

      // Subtitle badge next to MESSIGO
      drawRoundedRect(ctx, PAGE_W - MARGIN_X - 385, y + 6, 210, 30, 8, '#f1f5f9');
      ctx.font = `700 14px ${fontFamily}`;
      ctx.fillStyle = '#334155';
      ctx.fillText('بيان أوردرات وخط سير التوصيل', PAGE_W - MARGIN_X - 188, y + 12);

      // Day Title
      y += 48;
      ctx.font = `800 26px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(day.title || 'بيان توصيل أوردرات', PAGE_W - MARGIN_X, y);

      // Date & Courier Metadata Line
      y += 38;
      ctx.font = `600 16px ${fontFamily}`;
      ctx.fillStyle = '#475569';
      const timeStr = new Date().toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const courierText = day.courierName?.trim()
        ? `   ·   المندوب: ${day.courierName.trim()}`
        : '';
      ctx.fillText(
        `تاريخ البيان: ${day.dateKey}${courierText}   ·   توقيت الاستخراج: ${timeStr}`,
        PAGE_W - MARGIN_X,
        y
      );

      // Start Point Box (Left side)
      if (route?.startPoint) {
        const boxW = 330;
        const boxH = 88;
        const boxX = MARGIN_X;
        const boxY = 52;
        drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 14, '#f8fafc', '#cbd5e1', 1.5);
        ctx.textAlign = 'right';
        ctx.font = `700 15px ${fontFamily}`;
        ctx.fillStyle = '#0f172a';
        ctx.fillText('نقطة انطلاق الرحلة:', boxX + boxW - 16, boxY + 14);

        ctx.font = `500 14px ${fontFamily}`;
        ctx.fillStyle = '#334155';
        const spLabel = (route.startPoint.label || 'نقطة البداية').slice(0, 38);
        ctx.fillText(spLabel, boxX + boxW - 16, boxY + 38);

        ctx.font = `500 13px "IBM Plex Mono", monospace`;
        ctx.fillStyle = '#64748b';
        ctx.fillText(
          `${route.startPoint.coordinates.lat.toFixed(4)}, ${route.startPoint.coordinates.lng.toFixed(4)}`,
          boxX + boxW - 16,
          boxY + 62
        );
      }

      // Divider line
      y += 34;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, y);
      ctx.lineTo(PAGE_W - MARGIN_X, y);
      ctx.stroke();

      // --- 4 KPI SUMMARY CARDS ---
      y += 22;
      const cardGap = 16;
      const cardW = (CONTENT_W - cardGap * 3) / 4;
      const cardH = 88;

      const kpiCards = [
        {
          label: 'إجمالي الأوردرات',
          value: `${activeOrders.length} أوردر`,
          bg: '#f8fafc',
          border: '#cbd5e1',
          labelColor: '#475569',
          valueColor: '#0f172a',
        },
        {
          label: 'الأوردرات (بدون الدليفري)',
          value:
            totalOrdersNetAmount > 0
              ? `${totalOrdersNetAmount.toLocaleString('ar-EG')} ج.م`
              : '0 ج.م',
          bg: '#f0f9ff',
          border: '#bae6fd',
          labelColor: '#0c4a6e',
          valueColor: '#0369a1',
        },
        {
          label: 'إجمالي سعر الدليفري',
          value:
            totalDeliveryFeeAmount > 0
              ? `${totalDeliveryFeeAmount.toLocaleString('ar-EG')} ج.م`
              : '0 ج.م',
          bg: '#fffbeb',
          border: '#fde68a',
          labelColor: '#78350f',
          valueColor: '#b45309',
        },
        {
          label: 'مسافة خط السير',
          value: route ? formatDistanceArabic(route.totalDistanceMeters) : 'غير محسوب',
          bg: '#f8fafc',
          border: '#cbd5e1',
          labelColor: '#475569',
          valueColor: '#0f172a',
        },
      ];

      kpiCards.forEach((card, idx) => {
        const cardRight = PAGE_W - MARGIN_X - idx * (cardW + cardGap);
        const cardX = cardRight - cardW;
        drawRoundedRect(ctx, cardX, y, cardW, cardH, 14, card.bg, card.border, 1.5);

        ctx.textAlign = 'right';
        ctx.font = `700 15px ${fontFamily}`;
        ctx.fillStyle = card.labelColor;
        ctx.fillText(card.label, cardRight - 16, y + 16);

        ctx.font = `800 24px ${fontFamily}`;
        ctx.fillStyle = card.valueColor;
        ctx.fillText(card.value, cardRight - 16, y + 44);
      });

      y += cardH + 24;

      // Table Section Subtitle
      ctx.textAlign = 'right';
      ctx.font = `700 16px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(
        `جدول المحطات مرتبة بالتسلسل الفعلي للرحلة (${orderedStops.length} عميل):`,
        PAGE_W - MARGIN_X,
        y
      );

      ctx.textAlign = 'left';
      ctx.font = `500 15px ${fontFamily}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(
        `تم التسليم: ${deliveredCount}   ·   متبقي: ${remainingCount}`,
        MARGIN_X,
        y
      );

      y = FIRST_PAGE_TABLE_START_Y;
    } else {
      // --- SUBSEQUENT PAGE COMPACT HEADER ---
      ctx.textAlign = 'right';
      ctx.font = `800 22px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(
        `تابع بيان توصيل: ${day.title} (${day.dateKey})`,
        PAGE_W - MARGIN_X,
        y
      );

      ctx.textAlign = 'left';
      ctx.font = `600 16px ${fontFamily}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(`صفحة ${pageIdx + 1} من ${totalPages}`, MARGIN_X, y);

      y += 38;
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, y);
      ctx.lineTo(PAGE_W - MARGIN_X, y);
      ctx.stroke();

      y = NEXT_PAGE_TABLE_START_Y;
    }

    // --- TABLE HEADER ---
    drawRoundedRect(ctx, MARGIN_X, y, CONTENT_W, TABLE_HEADER_H, 8, '#e2e8f0', '#94a3b8', 1);

    const headers = [
      { label: '#', align: 'center' as const },
      { label: 'العميل والتواصل', align: 'right' as const },
      { label: 'العنوان التفصيلي ومكان التسليم', align: 'right' as const },
      { label: 'الطلب والأصناف', align: 'right' as const },
      { label: 'الأوردر (بدون دليفري)', align: 'center' as const },
      { label: 'سعر الدليفري', align: 'center' as const },
      { label: 'المسافة', align: 'center' as const },
    ];

    ctx.font = `700 15px ${fontFamily}`;
    ctx.fillStyle = '#0f172a';
    headers.forEach((h, colIdx) => {
      const colRight = COL_RIGHT_X[colIdx];
      const colW = COL_WIDTHS[colIdx];
      if (h.align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(h.label, colRight - colW / 2, y + 16);
      } else {
        ctx.textAlign = 'right';
        ctx.fillText(h.label, colRight - 12, y + 16);
      }
    });

    y += TABLE_HEADER_H;

    // --- TABLE ROWS ---
    const rowsForPage = pagesRows[pageIdx];
    for (const row of rowsForPage) {
      const { visitNumber, order, leg, customerLines, addressLines, detailsLines, rowHeight } =
        row;
      const isExcluded = Boolean(order.excludedFromRoute);
      const isDelivered = !isExcluded && order.deliveryStatus === 'تم التسليم';

      // Row Background
      ctx.fillStyle = isExcluded
        ? '#fef2f2'
        : isDelivered
        ? '#f0fdf4'
        : '#ffffff';
      ctx.fillRect(MARGIN_X, y, CONTENT_W, rowHeight);

      // Row Bottom Border
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(MARGIN_X, y + rowHeight);
      ctx.lineTo(PAGE_W - MARGIN_X, y + rowHeight);
      ctx.stroke();

      // Col 0: Visit Number Circle
      const col0Center = COL_RIGHT_X[0] - COL_WIDTHS[0] / 2;
      drawRoundedRect(ctx, col0Center - 17, y + 14, 34, 34, 17, '#e2e8f0');
      ctx.textAlign = 'center';
      ctx.font = `700 16px "IBM Plex Mono", ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(String(visitNumber), col0Center, y + 21);

      // Col 1: Customer Name, Phone, Status Badge
      ctx.textAlign = 'right';
      ctx.font = `700 17px ${fontFamily}`;
      ctx.fillStyle = isExcluded ? '#991b1b' : '#0f172a';
      let c1Y = y + 12;
      for (const line of customerLines) {
        ctx.fillText(line, COL_RIGHT_X[1] - 10, c1Y);
        c1Y += 23;
      }

      if (order.phone) {
        ctx.font = `600 15px "IBM Plex Mono", monospace`;
        ctx.fillStyle = '#334155';
        ctx.fillText(order.phone, COL_RIGHT_X[1] - 10, c1Y);
        c1Y += 22;
      }

      // Status Pill
      const statusText = isExcluded ? 'مستبعد' : order.deliveryStatus || 'قيد الانتظار';
      const badgeBg = isExcluded
        ? '#fee2e2'
        : isDelivered
        ? '#dcfce7'
        : '#fef3c7';
      const badgeColor = isExcluded
        ? '#991b1b'
        : isDelivered
        ? '#166534'
        : '#92400e';
      ctx.font = `700 13px ${fontFamily}`;
      const badgeW = Math.max(66, ctx.measureText(statusText).width + 18);
      drawRoundedRect(ctx, COL_RIGHT_X[1] - 10 - badgeW, c1Y + 2, badgeW, 24, 6, badgeBg);
      ctx.fillStyle = badgeColor;
      ctx.textAlign = 'center';
      ctx.fillText(statusText, COL_RIGHT_X[1] - 10 - badgeW / 2, c1Y + 6);

      // Col 2: Address + Coordinates
      ctx.textAlign = 'right';
      ctx.font = `500 16px ${fontFamily}`;
      ctx.fillStyle = '#1e293b';
      let c2Y = y + 12;
      for (const line of addressLines) {
        ctx.fillText(line, COL_RIGHT_X[2] - 12, c2Y);
        c2Y += 23;
      }
      if (order.coordinates) {
        ctx.font = `400 13px "IBM Plex Mono", monospace`;
        ctx.fillStyle = '#64748b';
        ctx.fillText(
          `${order.coordinates.lat.toFixed(5)}, ${order.coordinates.lng.toFixed(5)}`,
          COL_RIGHT_X[2] - 12,
          c2Y + 2
        );
      }

      // Col 3: Order Details
      ctx.textAlign = 'right';
      ctx.font = `400 15px ${fontFamily}`;
      ctx.fillStyle = order.orderDetails ? '#334155' : '#94a3b8';
      let c3Y = y + 12;
      for (const line of detailsLines) {
        ctx.fillText(line, COL_RIGHT_X[3] - 10, c3Y);
        c3Y += 22;
      }

      // Col 4: Order Price (Without Delivery)
      ctx.textAlign = 'center';
      ctx.font = `700 16px ${fontFamily}`;
      ctx.fillStyle = order.totalPrice ? '#0c4a6e' : '#94a3b8';
      ctx.fillText(
        order.totalPrice || '-',
        COL_RIGHT_X[4] - COL_WIDTHS[4] / 2,
        y + 18
      );

      // Col 5: Delivery Fee
      ctx.textAlign = 'center';
      ctx.font = `700 16px ${fontFamily}`;
      ctx.fillStyle = order.deliveryFee ? '#78350f' : '#94a3b8';
      ctx.fillText(
        order.deliveryFee || '-',
        COL_RIGHT_X[5] - COL_WIDTHS[5] / 2,
        y + 18
      );

      // Col 6: Leg Distance
      ctx.textAlign = 'center';
      ctx.font = `600 14px ${fontFamily}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(
        leg ? formatDistanceArabic(leg.distanceMeters) : '-',
        COL_RIGHT_X[6] - COL_WIDTHS[6] / 2,
        y + 18
      );

      y += rowHeight;
    }

    // --- TABLE FOOTER TOTALS ON LAST PAGE ---
    if (pageIdx === totalPages - 1) {
      const tfootH = 66;
      drawRoundedRect(ctx, MARGIN_X, y, CONTENT_W, tfootH, 8, '#f1f5f9', '#0f172a', 2);

      ctx.textAlign = 'right';
      ctx.font = `800 18px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(
        `إجمالي التجميعتين (${activeOrders.length} أوردر نشط):`,
        COL_RIGHT_X[0] - 14,
        y + 22
      );

      // Order without delivery sum in Col 4
      ctx.textAlign = 'center';
      ctx.font = `700 12px ${fontFamily}`;
      ctx.fillStyle = '#475569';
      ctx.fillText('الأوردر بدون دليفري', COL_RIGHT_X[4] - COL_WIDTHS[4] / 2, y + 10);
      ctx.font = `800 17px ${fontFamily}`;
      ctx.fillStyle = '#0369a1';
      ctx.fillText(
        totalOrdersNetAmount > 0
          ? `${totalOrdersNetAmount.toLocaleString('ar-EG')} ج.م`
          : '0 ج.م',
        COL_RIGHT_X[4] - COL_WIDTHS[4] / 2,
        y + 32
      );

      // Delivery fee sum in Col 5
      ctx.textAlign = 'center';
      ctx.font = `700 12px ${fontFamily}`;
      ctx.fillStyle = '#475569';
      ctx.fillText('إجمالي الدليفري', COL_RIGHT_X[5] - COL_WIDTHS[5] / 2, y + 10);
      ctx.font = `800 17px ${fontFamily}`;
      ctx.fillStyle = '#b45309';
      ctx.fillText(
        totalDeliveryFeeAmount > 0
          ? `${totalDeliveryFeeAmount.toLocaleString('ar-EG')} ج.م`
          : '0 ج.م',
        COL_RIGHT_X[5] - COL_WIDTHS[5] / 2,
        y + 32
      );

      // Total Distance in Col 6
      ctx.textAlign = 'center';
      ctx.font = `700 14px ${fontFamily}`;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(
        route ? formatDistanceArabic(route.totalDistanceMeters) : '-',
        COL_RIGHT_X[6] - COL_WIDTHS[6] / 2,
        y + 24
      );
    }

    // --- PAGE FOOTER ---
    const footerY = PAGE_H - 46;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, footerY - 10);
    ctx.lineTo(PAGE_W - MARGIN_X, footerY - 10);
    ctx.stroke();

    ctx.textAlign = 'right';
    ctx.font = `500 14px ${fontFamily}`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(
      'تم استخراج هذا البيان تلقائيًا بواسطة تطبيق Messigo لإدارة التوصيل وتحسين مسارات الطرق',
      PAGE_W - MARGIN_X,
      footerY
    );

    ctx.textAlign = 'left';
    ctx.fillText(
      `صفحة ${pageIdx + 1} من ${totalPages}  |  عدد المحطات: ${orderedStops.length}`,
      MARGIN_X,
      footerY
    );

    jpegDataUrls.push(canvas.toDataURL('image/jpeg', 0.92));
  }

  const blob = buildPdfBlobFromJpegPages(jpegDataUrls, PAGE_W, PAGE_H);
  const safeDate = (day.dateKey || new Date().toISOString().split('T')[0]).replace(
    /[^a-zA-Z0-9_-]/g,
    '-'
  );
  const fileName = `messigo-orders-${safeDate}.pdf`;
  const file = new File([blob], fileName, { type: 'application/pdf' });

  return { file, blob, fileName };
}

/**
 * Triggers a direct browser download of the generated PDF file.
 */
export async function downloadRoutePdf(
  day: DayRecord,
  onNotify?: (msg: string) => void
): Promise<void> {
  const { blob, fileName } = await generateRoutePdfFile(day);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (onNotify) {
    onNotify('تم تنزيل ملف الـ PDF بنجاح على جهازك.');
  }
}

/**
 * Generates a PDF file and opens the native system Share Sheet (e.g. WhatsApp, Telegram)
 * with the PDF file attached. Falls back to direct PDF download if file sharing is not supported.
 */
export async function shareOrDownloadRoutePdf(
  day: DayRecord,
  onNotify?: (msg: string) => void
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const { file, blob, fileName } = await generateRoutePdfFile(day);

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function') {
    const canShareFiles =
      typeof nav.canShare === 'function' ? nav.canShare({ files: [file] }) : true;

    if (canShareFiles) {
      try {
        await nav.share({
          files: [file],
          title: `بيان توصيل: ${day.title}`,
          text: `📄 بيان تفاصيل أوردرات وخط سير: ${day.title} (${day.dateKey})`,
        });
        if (onNotify) {
          onNotify('تمت مشاركة ملف الـ PDF بنجاح!');
        }
        return 'shared';
      } catch (err: any) {
        if (err && (err.name === 'AbortError' || /cancel/i.test(String(err.message)))) {
          return 'cancelled';
        }
        // If sharing files failed (e.g. inside desktop browser or iframe), fall back to download below
      }
    }
  }

  // Fallback: Download the PDF file directly so the user can send it anywhere
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  if (onNotify) {
    onNotify('تم تجهيز وتنزيل ملف الـ PDF مباشرةً لإرساله عبر واتساب أو أي تطبيق.');
  }
  return 'downloaded';
}
