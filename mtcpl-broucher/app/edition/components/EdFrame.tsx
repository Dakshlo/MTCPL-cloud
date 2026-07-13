import React from "react";

interface EdFrameProps {
  pageNumber: number;
  totalPages?: number;
  showFooter?: boolean;
  footerDark?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * 40-page MTCPL Edition 2026 page wrapper.
 * A4 (210 × 297 mm). Page-break-after for clean PDF export.
 * Page numbers now live in each page's .running-head only — no duplicates.
 */
export default function EdFrame({
  pageNumber: _pageNumber,
  totalPages: _totalPages = 40,
  showFooter: _showFooter = true,
  footerDark: _footerDark = false,
  className = "",
  children,
}: EdFrameProps) {
  return (
    <div className="ed-page-wrap">
      <article className={`ed-page ${className}`}>{children}</article>
    </div>
  );
}
