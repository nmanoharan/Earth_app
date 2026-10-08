import { NextResponse } from "next/server";
import {
  formatDateValueForTimeZone,
  gramsToPounds,
  isDateValue,
  metricTonsToPounds,
  summarizeWorkLocations,
  withWorkImpact
} from "@/lib/impactCalculations";
import { authorizeMobileApiRequest } from "@/lib/mobileApiAuth";
import { getWorkLocationMarkers, type WorkLocationMarker } from "@/lib/workLocations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OEOC_TIME_ZONE = "America/Chicago";
const PAGE_WIDTH = 960;
const PAGE_HEIGHT = 540;
const PAGE_MARGIN = 44;
const PAGE_BOTTOM = 40;
const TABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const BRAND_EVERGREEN = "#00200b";
const BRAND_GREEN = "#54775e";
const BRAND_IVORY = "#f0ece6";
const BRAND_PAPER = "#ffffff";
const BRAND_SAGE = "#dbe5dc";
const BRAND_STROKE = "#d3d3d3";
const BRAND_TERRACOTTA = "#d4a373";
const BRAND_MUTED = "#70756e";

type PdfTextOptions = {
  align?: "left" | "right";
  bold?: boolean;
  color?: string;
  variant?: "body" | "display";
};

type PdfPage = {
  commands: string[];
};

type EventLocationGroup = {
  location: string;
  markers: WorkLocationMarker[];
  summary: ReturnType<typeof summarizeWorkLocations>;
  year: string;
};

type EventSummaryMetric = {
  label: string;
  value: string;
};

function dateFromRequest(value: string | null) {
  return value && isDateValue(value)
    ? value
    : formatDateValueForTimeZone(new Date(), OEOC_TIME_ZONE);
}

function toPdfText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfString(value: string | number | null | undefined) {
  return toPdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function escapeFilename(value: string) {
  const safeValue = toPdfText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return safeValue || "event";
}

function colorRgb(value: string) {
  const hex = value.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;

  return `${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)}`;
}

function textWidth(value: string, fontSize: number) {
  return toPdfText(value).length * fontSize * 0.48;
}

function wrapText(value: string | number | null | undefined, maxWidth: number, fontSize: number) {
  const words = toPdfText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (textWidth(nextLine, fontSize) <= maxWidth) {
      currentLine = nextLine;
      return;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (textWidth(word, fontSize) <= maxWidth) {
      currentLine = word;
      return;
    }

    const maxCharacters = Math.max(8, Math.floor(maxWidth / (fontSize * 0.48)));
    for (let index = 0; index < word.length; index += maxCharacters) {
      lines.push(word.slice(index, index + maxCharacters));
    }
    currentLine = "";
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function formatFullNumber(value: number | null | undefined, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value ?? 0);
}

function formatFullCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value ?? 0);
}

function plantingYear(marker: WorkLocationMarker) {
  if (marker.plantingDate && isDateValue(marker.plantingDate)) {
    return marker.plantingDate.slice(0, 4);
  }

  return marker.year ? String(marker.year) : "Unlisted";
}

function eventTimestamp(marker: WorkLocationMarker) {
  const dateValue = marker.plantingDate ?? marker.date;

  if (!dateValue || !isDateValue(dateValue)) {
    return 0;
  }

  const timestamp = new Date(`${dateValue}T00:00:00.000Z`).getTime();

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventNames(markers: WorkLocationMarker[]) {
  const eventDateByName = new Map<string, number>();

  markers.forEach((marker) => {
    const eventName = marker.eventName.trim();
    if (!eventName) {
      return;
    }

    eventDateByName.set(
      eventName,
      Math.max(eventDateByName.get(eventName) ?? 0, eventTimestamp(marker))
    );
  });

  return Array.from(eventDateByName.entries())
    .sort((firstEvent, secondEvent) => {
      const dateDifference = secondEvent[1] - firstEvent[1];

      return dateDifference === 0 ? firstEvent[0].localeCompare(secondEvent[0]) : dateDifference;
    })
    .map(([eventName]) => eventName);
}

function selectEventName(markers: WorkLocationMarker[], requestedEventName: string | null) {
  const names = eventNames(markers);

  if (requestedEventName) {
    const requestedName = requestedEventName.trim().toLowerCase();
    const exactName = names.find((eventName) => eventName.toLowerCase() === requestedName);

    if (exactName) {
      return exactName;
    }
  }

  return requestedEventName ? null : (names[0] ?? null);
}

function groupEventMarkers(markers: WorkLocationMarker[]) {
  const groupsByKey = new Map<string, WorkLocationMarker[]>();

  markers.forEach((marker) => {
    const year = plantingYear(marker);
    const location = marker.location.trim() || "Unlisted Location";
    const groupKey = `${year}::${location.toLowerCase()}`;
    const group = groupsByKey.get(groupKey) ?? [];

    group.push(marker);
    groupsByKey.set(groupKey, group);
  });

  return Array.from(groupsByKey.values())
    .map((groupMarkers) => ({
      location: groupMarkers[0]?.location ?? "Unlisted Location",
      markers: groupMarkers,
      summary: summarizeWorkLocations(groupMarkers),
      year: plantingYear(groupMarkers[0])
    }))
    .sort((firstGroup, secondGroup) => {
      const firstYear = Number(firstGroup.year);
      const secondYear = Number(secondGroup.year);

      if (Number.isFinite(firstYear) && Number.isFinite(secondYear) && firstYear !== secondYear) {
        return secondYear - firstYear;
      }

      return firstGroup.location.localeCompare(secondGroup.location);
    });
}

function summaryTotalCost(summary: ReturnType<typeof summarizeWorkLocations>) {
  return (
    summary.stormwaterCostAvoided +
    summary.airPollutantValueAvoided +
    summary.roadResurfacingCostAvoided +
    summary.energyCostSaved
  );
}

class PdfReport {
  private pages: PdfPage[] = [];
  public y = PAGE_HEIGHT - PAGE_MARGIN;

  constructor() {
    this.addPage();
  }

  addPage(continuedTitle?: string) {
    this.pages.push({ commands: [] });
    this.y = PAGE_HEIGHT - PAGE_MARGIN;
    this.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, BRAND_IVORY);

    if (continuedTitle) {
      this.text(continuedTitle, PAGE_MARGIN, this.y, 10, { bold: true, color: BRAND_EVERGREEN });
      this.y -= 18;
      this.line(PAGE_MARGIN, this.y, PAGE_WIDTH - PAGE_MARGIN, this.y, BRAND_STROKE);
      this.y -= 18;
    }
  }

  private get currentPage() {
    return this.pages[this.pages.length - 1];
  }

  text(
    value: string | number | null | undefined,
    x: number,
    y: number,
    fontSize: number,
    options: PdfTextOptions = {}
  ) {
    const text = toPdfText(value);
    const drawX =
      options.align === "right" ? Math.max(PAGE_MARGIN, x - textWidth(text, fontSize)) : x;
    const fontName =
      options.variant === "display" ? (options.bold ? "F4" : "F3") : options.bold ? "F2" : "F1";
    const color = colorRgb(options.color ?? BRAND_EVERGREEN);

    this.currentPage.commands.push(
      `${color} rg BT /${fontName} ${fontSize.toFixed(2)} Tf ${drawX.toFixed(2)} ${y.toFixed(
        2
      )} Td (${escapePdfString(text)}) Tj ET`
    );
  }

  wrappedText(
    value: string | number | null | undefined,
    x: number,
    maxWidth: number,
    fontSize: number,
    lineHeight: number,
    options: PdfTextOptions = {}
  ) {
    const lines = wrapText(value, maxWidth, fontSize);

    lines.forEach((line, index) => {
      this.text(line, x, this.y - index * lineHeight, fontSize, options);
    });

    this.y -= lines.length * lineHeight;
  }

  rect(x: number, y: number, width: number, height: number, color: string) {
    this.currentPage.commands.push(
      `q ${colorRgb(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(
        2
      )} ${height.toFixed(2)} re f Q`
    );
  }

  roundRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: string,
    strokeColor?: string
  ) {
    const right = x + width;
    const top = y + height;
    const kappa = 0.5522847498;
    const control = radius * kappa;
    const strokeCommand = strokeColor ? `${colorRgb(strokeColor)} RG` : "";
    const paintCommand = strokeColor ? "B" : "f";

    this.currentPage.commands.push(
      [
        "q",
        `${colorRgb(color)} rg`,
        strokeCommand,
        `${(x + radius).toFixed(2)} ${y.toFixed(2)} m`,
        `${(right - radius).toFixed(2)} ${y.toFixed(2)} l`,
        `${(right - radius + control).toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(
          y +
          radius -
          control
        ).toFixed(2)} ${right.toFixed(2)} ${(y + radius).toFixed(2)} c`,
        `${right.toFixed(2)} ${(top - radius).toFixed(2)} l`,
        `${right.toFixed(2)} ${(top - radius + control).toFixed(2)} ${(
          right -
          radius +
          control
        ).toFixed(2)} ${top.toFixed(2)} ${(right - radius).toFixed(2)} ${top.toFixed(2)} c`,
        `${(x + radius).toFixed(2)} ${top.toFixed(2)} l`,
        `${(x + radius - control).toFixed(2)} ${top.toFixed(2)} ${x.toFixed(2)} ${(
          top -
          radius +
          control
        ).toFixed(2)} ${x.toFixed(2)} ${(top - radius).toFixed(2)} c`,
        `${x.toFixed(2)} ${(y + radius).toFixed(2)} l`,
        `${x.toFixed(2)} ${(y + radius - control).toFixed(2)} ${(x + radius - control).toFixed(
          2
        )} ${y.toFixed(2)} ${(x + radius).toFixed(2)} ${y.toFixed(2)} c`,
        "h",
        paintCommand,
        "Q"
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string) {
    this.currentPage.commands.push(
      `q ${colorRgb(color)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(
        2
      )} ${y2.toFixed(2)} l S Q`
    );
  }

  ensureSpace(height: number, continuedTitle: string) {
    if (this.y - height < PAGE_BOTTOM) {
      this.addPage(continuedTitle);

      return true;
    }

    return false;
  }

  addFooters() {
    this.pages.forEach((page, index) => {
      const pageText = `Page ${index + 1} of ${this.pages.length}`;
      const footerText = "ONE EARTH ONE CHANCE - EVENT IMPACT";
      const footerY = 30;

      page.commands.push(
        `q ${colorRgb(BRAND_STROKE)} RG ${PAGE_MARGIN.toFixed(2)} 42.00 m ${(
          PAGE_WIDTH - PAGE_MARGIN
        ).toFixed(2)} 42.00 l S Q`
      );
      page.commands.push(
        `${colorRgb(BRAND_MUTED)} rg BT /F2 7.25 Tf ${PAGE_MARGIN.toFixed(
          2
        )} ${footerY.toFixed(2)} Td (${escapePdfString(footerText)}) Tj ET`
      );
      page.commands.push(
        `${colorRgb(BRAND_MUTED)} rg BT /F1 8.00 Tf ${(
          PAGE_WIDTH -
          PAGE_MARGIN -
          textWidth(pageText, 8)
        ).toFixed(2)} ${footerY.toFixed(2)} Td (${escapePdfString(pageText)}) Tj ET`
      );
    });
  }

  toBuffer() {
    this.addFooters();

    return pdfBufferFromPages(this.pages.map((page) => page.commands.join("\n")));
  }
}

function pdfBufferFromPages(pageStreams: string[]) {
  const objects: string[] = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    `2 0 obj\n<< /Type /Pages /Kids [${pageStreams
      .map((_, index) => `${7 + index * 2} 0 R`)
      .join(" ")}] /Count ${pageStreams.length} >>\nendobj`,
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>\nendobj",
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>\nendobj"
  ];

  pageStreams.forEach((stream, index) => {
    const pageObjectId = 7 + index * 2;
    const contentObjectId = pageObjectId + 1;

    objects.push(
      `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj`
    );
    objects.push(
      `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(
        stream,
        "ascii"
      )} >>\nstream\n${stream}\nendstream\nendobj`
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${object}\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "ascii");
}

function drawSummaryCards(report: PdfReport, metrics: EventSummaryMetric[]) {
  const columnCount = 4;
  const columnGap = 12;
  const rowGap = 8;
  const cardWidth = (TABLE_WIDTH - columnGap * (columnCount - 1)) / columnCount;
  const cardHeight = 44;

  metrics.forEach((metric, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const x = PAGE_MARGIN + column * (cardWidth + columnGap);
    const y = report.y - cardHeight - row * (cardHeight + rowGap);

    report.roundRect(x, y, cardWidth, cardHeight, 12, BRAND_SAGE);
    report.text(metric.label, x + 10, y + 26, 7.5, { bold: true, color: BRAND_GREEN });
    report.text(metric.value, x + 10, y + 9, 15, { color: BRAND_EVERGREEN, variant: "display" });
  });

  report.y -= Math.ceil(metrics.length / columnCount) * (cardHeight + rowGap) + 6;
}

function drawEventTable(report: PdfReport, groups: EventLocationGroup[], eventName: string) {
  const columns = [
    { align: "left" as const, label: "Year", width: 52 },
    { align: "left" as const, label: "Planting Location", width: 260 },
    { align: "right" as const, label: "Trees", width: 62 },
    { align: "right" as const, label: "Canopy", width: 78 },
    { align: "right" as const, label: "CO2 lbs", width: 88 },
    { align: "right" as const, label: "Runoff gal", width: 104 },
    { align: "right" as const, label: "Air lbs", width: 82 },
    { align: "right" as const, label: "Total $", width: 146 }
  ];
  const continuedTitle = `${eventName} - planting locations`;

  function header() {
    report.ensureSpace(30, continuedTitle);
    report.line(PAGE_MARGIN, report.y - 2, PAGE_WIDTH - PAGE_MARGIN, report.y - 2, BRAND_STROKE);

    let x = PAGE_MARGIN;
    columns.forEach((column) => {
      report.text(column.label.toUpperCase(), x + 4, report.y - 17, 7.2, {
        bold: true,
        color: BRAND_MUTED
      });
      x += column.width;
    });

    report.y -= 24;
  }

  report.ensureSpace(46, continuedTitle);
  report.text("Planting locations in this event", PAGE_MARGIN, report.y, 18, {
    bold: true,
    color: BRAND_EVERGREEN,
    variant: "display"
  });
  report.y -= 18;
  header();

  groups.forEach((group) => {
    const summary = group.summary;
    const values = [
      group.year,
      group.location,
      formatFullNumber(summary.plantings, 0),
      formatFullNumber(summary.canopy, 0),
      formatFullNumber(metricTonsToPounds(summary.co2Saved), 1),
      formatFullNumber(summary.rainRunoff, 0),
      formatFullNumber(gramsToPounds(summary.airPollutants), 2),
      formatFullCurrency(summaryTotalCost(summary))
    ];
    const locationLines = wrapText(group.location, columns[1].width - 8, 7.1);
    const rowHeight = Math.max(18, 8 + locationLines.length * 8);

    if (report.ensureSpace(rowHeight, continuedTitle)) {
      header();
    }

    report.line(PAGE_MARGIN, report.y, PAGE_WIDTH - PAGE_MARGIN, report.y, BRAND_STROKE);

    let x = PAGE_MARGIN;
    values.forEach((value, index) => {
      const column = columns[index];
      const cellText = index === 1 ? locationLines : [value];

      cellText.forEach((line, lineIndex) => {
        report.text(
          line,
          column.align === "right" ? x + column.width - 4 : x + 4,
          report.y - 12 - lineIndex * 8,
          7.1,
          {
            align: column.align,
            color: index === 0 ? BRAND_GREEN : BRAND_EVERGREEN
          }
        );
      });
      x += column.width;
    });

    report.y -= rowHeight;
  });
}

function buildEventPdf({
  estimateDate,
  eventName,
  markers,
  sourceLabel
}: {
  estimateDate: string;
  eventName: string;
  markers: WorkLocationMarker[];
  sourceLabel: string;
}) {
  const impactedMarkers = markers.map((marker) => withWorkImpact(marker, estimateDate));
  const summary = summarizeWorkLocations(impactedMarkers);
  const groups = groupEventMarkers(impactedMarkers);
  const report = new PdfReport();
  const eventDates = Array.from(
    new Set(impactedMarkers.map((marker) => marker.plantingDate ?? marker.date).filter(Boolean))
  ).sort();
  const categories = Array.from(new Set(impactedMarkers.map((marker) => marker.category).filter(Boolean)))
    .sort()
    .join(", ");
  const partners = Array.from(new Set(impactedMarkers.map((marker) => marker.partners).filter(Boolean)))
    .sort()
    .join(", ");
  const totalCost = summaryTotalCost(summary);

  const badgeSize = 72;
  const badgeX = PAGE_WIDTH - PAGE_MARGIN - badgeSize;
  const badgeY = PAGE_HEIGHT - PAGE_MARGIN - badgeSize;

  report.rect(badgeX, badgeY, badgeSize, badgeSize, BRAND_GREEN);
  report.text("ONE EARTH", badgeX + 14, badgeY + 34, 7, {
    color: BRAND_PAPER,
    variant: "display"
  });
  report.text("ONE CHANCE", badgeX + 12, badgeY + 23, 7, {
    color: BRAND_PAPER,
    variant: "display"
  });
  report.text("EVENT IMPACT", PAGE_MARGIN, report.y, 9, {
    bold: true,
    color: BRAND_TERRACOTTA
  });
  report.y -= 40;
  report.wrappedText(eventName, PAGE_MARGIN, TABLE_WIDTH - badgeSize - 34, 32, 36, {
    color: BRAND_EVERGREEN,
    variant: "display"
  });
  report.y -= 6;
  report.wrappedText(
    `Impact estimate date: ${estimateDate}. Source: ${sourceLabel}. Event date${
      eventDates.length === 1 ? "" : "s"
    }: ${eventDates.join(", ") || "not listed"}.`,
    PAGE_MARGIN,
    TABLE_WIDTH - 80,
    9,
    12,
    { color: BRAND_MUTED }
  );
  report.y -= 6;
  report.wrappedText(
    `Categories: ${categories || "not listed"}. Partners: ${partners || "not listed"}.`,
    PAGE_MARGIN,
    TABLE_WIDTH - 80,
    9,
    12,
    { color: BRAND_MUTED }
  );
  report.y -= 10;
  drawSummaryCards(report, [
    { label: "Planting Locations", value: formatFullNumber(summary.locations, 0) },
    { label: "Plantings", value: formatFullNumber(summary.plantings, 0) },
    { label: "Tree Canopy Sq Ft", value: formatFullNumber(summary.canopy, 0) },
    { label: "CO2 Removed Lbs", value: formatFullNumber(metricTonsToPounds(summary.co2Saved), 1) },
    { label: "Runoff Avoided Gallons", value: formatFullNumber(summary.rainRunoff, 0) },
    {
      label: "Air Pollutants Removed Lbs",
      value: formatFullNumber(gramsToPounds(summary.airPollutants), 2)
    },
    { label: "Storm Water Management $", value: formatFullCurrency(summary.stormwaterCostAvoided) },
    { label: "Air Pollutant Removal $", value: formatFullCurrency(summary.airPollutantValueAvoided) },
    { label: "Road Resurfacing $", value: formatFullCurrency(summary.roadResurfacingCostAvoided) },
    { label: "Energy Saving $", value: formatFullCurrency(summary.energyCostSaved) },
    { label: "Total Cost Savings $", value: formatFullCurrency(totalCost) },
    { label: "Volunteer Hours", value: formatFullNumber(summary.volunteerHours, 1) }
  ]);
  report.wrappedText(
    "Calculations use the same EPA/i-Tree and planning-estimate methodology as the dashboard. Air pollutants exclude CO2 to avoid double counting.",
    PAGE_MARGIN,
    TABLE_WIDTH,
    8.2,
    10.5,
    { color: BRAND_MUTED }
  );
  report.y -= 16;
  drawEventTable(report, groups, eventName);

  return report.toBuffer();
}

export async function GET(request: Request) {
  const unauthorizedResponse = authorizeMobileApiRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const url = new URL(request.url);
  const estimateDate = dateFromRequest(url.searchParams.get("estimateDate"));
  const requestedEventName = url.searchParams.get("eventName") ?? url.searchParams.get("event");
  const payload = await getWorkLocationMarkers();
  const eventName = selectEventName(payload.markers, requestedEventName);

  if (!eventName) {
    return NextResponse.json(
      {
        availableEvents: eventNames(payload.markers),
        error: "Event not found"
      },
      { status: 404 }
    );
  }

  const eventMarkers = payload.markers.filter(
    (marker) => marker.eventName.trim().toLowerCase() === eventName.toLowerCase()
  );
  const sourceLabel = payload.warning
    ? `Cached Tree Map snapshot; ${payload.warning}`
    : "Live Tree Map sheet";
  const body = buildEventPdf({
    estimateDate,
    eventName,
    markers: eventMarkers,
    sourceLabel
  });

  return new NextResponse(body, {
    headers: {
      "Content-Disposition": `attachment; filename="oeoc-event-${escapeFilename(
        eventName
      )}-${estimateDate}.pdf"`,
      "Content-Type": "application/pdf"
    }
  });
}
