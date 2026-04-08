"use client";

type ExportBlock = {
  id: string;
  stone: string;
  yard: number;
  category: string;
  status: string;
  length_ft: number | string;
  width_ft: number | string;
  height_ft: number | string;
  trim_left_ft: number | string;
  trim_right_ft: number | string;
  trim_near_ft: number | string;
  trim_far_ft: number | string;
  created_at: string;
};

export function ExportBlocksButton({ blocks }: { blocks: ExportBlock[] }) {
  function exportCSV() {
    const headers = [
      "ID", "Stone", "Yard", "Category", "Status",
      "Length ft", "Width ft", "Height ft",
      "Trim Left ft", "Trim Right ft", "Trim Near ft", "Trim Far ft",
      "Date Added"
    ];
    const rows = blocks.map((b) => [
      b.id, b.stone, b.yard, b.category, b.status,
      b.length_ft, b.width_ft, b.height_ft,
      b.trim_left_ft, b.trim_right_ft, b.trim_near_ft, b.trim_far_ft,
      new Date(b.created_at).toLocaleDateString("en-IN")
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blocks-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button className="secondary-button" onClick={exportCSV} type="button">
      Export CSV
    </button>
  );
}
