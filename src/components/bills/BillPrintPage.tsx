import { useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBDT, formatSize, billSize, billLabel } from "@/lib/utils";

interface PrintLine {
  cut_width_inches: number | null;
  cut_height_inches: number | null;
  quantity_pieces: number;
  selling_price_per_piece_poisha: number;
  line_total_poisha: number;
  label: string | null;
}

interface PrintData {
  invoice_number: string;
  bill_date: string;
  customer_display: string;
  customer_name: string;
  lines: PrintLine[];
  bill_total: number;
  outstanding: number;
  grand_total: number;
  paying_now: number;
  remaining: number;
}

function formatDateBN(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTaka(poisha: number): string {
  const bdt = poisha / 100;
  return bdt.toLocaleString("en-BD", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function BillPrintPage() {
  const navigate = useNavigate();

  const data = useMemo<PrintData | null>(() => {
    try {
      const raw = sessionStorage.getItem("billPrintData");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (data) {
      const timer = setTimeout(() => window.print(), 400);
      return () => clearTimeout(timer);
    }
  }, [data]);

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-4">
        <p className="text-muted-foreground">No print data found.</p>
        <Button onClick={() => navigate("/bills")}>Back to Bills</Button>
      </div>
    );
  }

  const ROWS_PER_PAGE = 15;
  // Chunk lines into pages
  const pages: PrintLine[][] = [];
  for (let i = 0; i < data.lines.length; i += ROWS_PER_PAGE) {
    pages.push(data.lines.slice(i, i + ROWS_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);
  const lastPageLines = pages[pages.length - 1];
  const emptyRows =
    lastPageLines.length < ROWS_PER_PAGE
      ? ROWS_PER_PAGE - lastPageLines.length
      : 0;

  return (
    <>
      <style>{`
        /* Shared styles for both screen and print */
        .bill-page {
          background: white; color: black;
          font-family: 'Noto Sans Bengali', 'Kalpurush', system-ui, sans-serif;
        }
        .bill-page * { color: black; }
        .bill-content { padding: 0 0.35in; }
        .bill-header-spacer { height: 0.6in; }
        .bill-date { text-align: right; font-size: 11px; margin-bottom: 6px; }
        .customer-info { font-size: 11.5px; margin-bottom: 8px; line-height: 1.5; }
        .customer-info .label { font-weight: 400; }
        .customer-info .dots { flex: 1; border-bottom: 1px dotted #999; margin: 0 4px; min-width: 20px; }
        .customer-info .value { font-weight: 600; }
        .bill-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .bill-table th {
          border: 1px solid #333; padding: 4px 6px; font-weight: 700;
          text-align: center; background: #f5f5f0;
        }
        .bill-table td {
          border: 1px solid #333; padding: 3px 6px;
          font-variant-numeric: tabular-nums;
        }
        .bill-table td.text-r { text-align: right; }
        .bill-table td.text-c { text-align: center; }
        .bill-footer-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: -1px; }
        .bill-footer-table td {
          border: 1px solid #333; padding: 3px 6px;
          font-variant-numeric: tabular-nums;
        }
        .bill-footer-table .label-cell { font-weight: 700; text-align: right; }
        .bill-footer-table .amount-cell { text-align: right; font-weight: 600; }
        .signature-line {
          text-align: center; font-size: 10px; margin-top: 16px;
          padding-top: 4px; border-top: 1px solid #333; width: 120px;
          margin-left: auto; margin-right: auto;
        }
        /* Screen-only preview */
        .bill-page-wrapper {
          transform: scale(1.4); transform-origin: top center;
          margin-bottom: 200px;
        }
        .bill-page { width: 5.33in; margin: 0 auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        /* Print overrides */
        @media print {
          @page { size: A5; margin: 0 0.35in 1in 0.35in; }
          html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
          .no-print { display: none !important; }
          .bill-page-wrapper { transform: none !important; margin: 0 !important; }
          .bill-page {
            width: 100% !important; max-width: none !important;
            margin: 0 !important; border: none !important;
            border-radius: 0 !important; box-shadow: none !important;
          }
          .bill-header-spacer { display: block !important; height: 0.1in !important; }
          .bill-content { padding: 0 !important; }
          .bill-table tr { page-break-inside: avoid; }
          .bill-footer-section { page-break-inside: avoid; }
        }
      `}</style>

      <div className="no-print flex items-center justify-between p-4 max-w-[5.33in] mx-auto mb-2">
        <Button variant="outline" onClick={() => navigate("/bills")}>
          Back to Bills
        </Button>
        <Button onClick={() => window.print()}>Print Again</Button>
      </div>

      <div className="bill-page-wrapper">
        {pages.map((pageLines, pageIdx) => {
          const isFirst = pageIdx === 0;
          const isLast = pageIdx === pages.length - 1;
          const pageEmptyRows = isLast ? emptyRows : 0;

          return (
            <div
              key={pageIdx}
              className="bill-page"
              style={!isLast ? { pageBreakAfter: "always" } : undefined}
            >
              {/* Spacer for pre-printed letterhead (screen preview only, print uses @page margin) */}
              <div className="bill-header-spacer" />

              <div className="bill-content">
                {isFirst && (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        fontSize: "13px",
                        marginBottom: "8px",
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>
                        {data.invoice_number}
                      </span>
                      <span
                        style={{
                          fontSize: "18px",
                          fontWeight: 700,
                          position: "relative",
                          bottom: "10px",
                        }}
                      >
                        ক্যাশ মেমো
                      </span>
                      <span style={{ fontSize: "13px" }}>
                        তারিখ : {formatDateBN(data.bill_date)}
                      </span>
                    </div>
                    <div className="customer-info">
                      <div style={{ display: "flex", alignItems: "baseline" }}>
                        <span className="label">প্রতিষ্ঠানের নাম :</span>
                        <span className="dots" />
                        <span className="value relative right-[207px] bottom-3 text-base">
                          {data.customer_display}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {!isFirst && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "10px",
                      marginBottom: "6px",
                      color: "#666",
                    }}
                  >
                    <span>{data.invoice_number}</span>
                    <span>
                      পৃষ্ঠা {pageIdx + 1}/{pages.length}
                    </span>
                  </div>
                )}
                <table className="bill-table">
                  <colgroup>
                    <col style={{ width: "15%" }} />
                    <col />
                    <col style={{ width: "14%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "16%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>সাইজ</th>
                      <th>বিবরণ</th>
                      <th>পরিমাণ</th>
                      <th>দর</th>
                      <th>টাকা</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageLines.map((line, i) => {
                      const size =
                        line.cut_width_inches && line.cut_height_inches
                          ? billSize(
                              line.cut_width_inches,
                              line.cut_height_inches,
                            )
                          : "—";
                      return (
                        <tr key={i}>
                          <td className="text-c">{size}</td>
                          <td>{billLabel(line.label)}</td>
                          <td className="text-r">
                            {line.quantity_pieces.toLocaleString()}
                          </td>
                          <td className="text-r">
                            {formatTaka(line.selling_price_per_piece_poisha)}
                          </td>
                          <td className="text-r">
                            {formatTaka(line.line_total_poisha)}
                          </td>
                        </tr>
                      );
                    })}
                    {Array.from({ length: pageEmptyRows }).map((_, i) => (
                      <tr key={`empty-${i}`}>
                        <td>&nbsp;</td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {isLast && (
                  <div
                    className="bill-footer-section"
                    style={{ marginTop: "-1px" }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "11px",
                      }}
                    >
                      <tbody>
                        <tr>
                          <td
                            rowSpan={5}
                            colSpan={3}
                            style={{
                              border: "1px solid #333",
                              verticalAlign: "top",
                              width: "72%",
                            }}
                          >
                            &nbsp;
                          </td>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              fontWeight: 700,
                              textAlign: "right",
                              width: "59px",
                            }}
                          >
                            মোট
                          </td>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              textAlign: "right",
                              fontWeight: 600,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {formatTaka(data.bill_total)}
                          </td>
                        </tr>
                        <tr>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              fontWeight: 700,
                              textAlign: "right",
                            }}
                          >
                            সাবেক
                          </td>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              textAlign: "right",
                              fontWeight: 600,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {data.outstanding > 0
                              ? formatTaka(data.outstanding)
                              : "—"}
                          </td>
                        </tr>
                        <tr>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              fontWeight: 700,
                              textAlign: "right",
                            }}
                          >
                            সর্বমোট
                          </td>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              textAlign: "right",
                              fontWeight: 700,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {formatTaka(data.grand_total)}
                          </td>
                        </tr>
                        <tr>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              fontWeight: 700,
                              textAlign: "right",
                            }}
                          >
                            জমা
                          </td>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              textAlign: "right",
                              fontWeight: 600,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {data.paying_now > 0
                              ? formatTaka(data.paying_now)
                              : "—"}
                          </td>
                        </tr>
                        <tr>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              fontWeight: 700,
                              textAlign: "right",
                            }}
                          >
                            বাকী
                          </td>
                          <td
                            style={{
                              border: "1px solid #333",
                              padding: "3px 6px",
                              textAlign: "right",
                              fontWeight: 700,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {formatTaka(Math.max(0, data.remaining))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="signature-line relative bottom-[45px] right-[75px]">
                      স্বাক্ষর
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
