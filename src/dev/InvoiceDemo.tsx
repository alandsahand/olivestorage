// DEVELOPMENT ONLY (removed from the shipped app): renders an invoice from sample data so the layout can be
// checked and exported to PDF without touching the real database.
// Open:  http://localhost:1420/#/__invoice-demo?lang=ar&lines=30&note=1
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { InvoiceSheet } from "@/components/InvoiceSheet";
import { useI18n } from "@/i18n";
import type { SaleDetail } from "@/data/sales";

const MATERIALS: [string, string][] = [
  ["زەیتوونی ڕەش", "کیلۆ"],
  ["زەیتوونی سەوز", "کیلۆ"],
  ["زەیتی زەیتوون (تەنەکەی ١٦ لیتر)", "تەنەکە"],
  ["تورشی تێکەڵ", "کیلۆ"],
  ["تورشی خیار", "کیلۆ"],
  ["پیازی تورشکراو", "سندوق"],
  ["عالم طرشي والزيتون — زيتون أخضر محشي بالفلفل الأحمر والثوم", "كيلو"],
];

export default function InvoiceDemo() {
  const { setLang } = useI18n();
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const lines = Math.max(1, Number(q.get("lines") ?? 4));
  useEffect(() => setLang(q.get("lang") === "ar" ? "ar" : "ckb"), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sale: SaleDetail = {
    id: 1234,
    client_id: 1,
    client_name: q.get("client") ?? "ئاسۆ محمد",
    total: 0,
    paid: 0,
    note: q.get("note") ? "بەڕێکەوتی گەیاندن: سبەی بەیانی. تکایە پێش گەیاندن پەیوەندی بکە.\nملاحظة: التسليم صباح الغد." : null,
    later_paid: 0,
    refunded: 0,
    debt: 0,
    refund_due: 0,
    rev: 1,
    created_at: "2026-10-08T09:41:00.000Z",
    cancelled_at: null,
    line_count: lines,
    lines: Array.from({ length: lines }, (_, i) => {
      const [item_name, unit_name] = MATERIALS[i % MATERIALS.length];
      const qty_milli = 1000 + ((i * 3700) % 48000);
      const unit_price = 1500 + ((i * 2750) % 30000);
      return { id: i + 1, item_id: i + 1, item_name, unit_name, qty_milli, unit_price, buy_price: 1000, line_total: Math.round((qty_milli * unit_price) / 1000) };
    }),
  };
  sale.total = sale.lines.reduce((s, l) => s + l.line_total, 0);
  sale.paid = Math.round(sale.total * 0.6);
  sale.debt = sale.total - sale.paid;

  // same two copies as the real dialog: one visible on screen, one in .print-area that the print rules keep
  return (
    <>
      <InvoiceSheet sale={sale} />
      {createPortal(
        <div className="print-area">
          <InvoiceSheet sale={sale} />
        </div>,
        document.body,
      )}
    </>
  );
}
