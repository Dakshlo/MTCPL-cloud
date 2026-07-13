import React from "react";

type Variant = "white" | "dark" | "cream" | "ivory" | "cover" | "bare";

interface PageFrameProps {
  pageNumber: number;
  totalPages?: number;
  variant?: Variant;
  showFooter?: boolean;
  chapter?: string;
  children: React.ReactNode;
  className?: string;
}

export default function PageFrame({
  pageNumber,
  totalPages = 25,
  variant = "white",
  showFooter = true,
  chapter,
  children,
  className = "",
}: PageFrameProps) {
  const variantClass =
    variant === "dark" ? "dark" :
    variant === "cream" ? "cream" :
    variant === "ivory" ? "ivory" :
    variant === "cover" ? "cover" : "";

  return (
    <div className="page-wrap">
      <span className="page-num-badge">{String(pageNumber).padStart(2, "0")} / {totalPages}</span>
      <article className={`page ${variantClass} ${className}`}>
        {children}
        {showFooter && (
          <div className="page-foot">
            <span>{String(pageNumber).padStart(2, "0")}<span className="dot">/</span>{totalPages}</span>
          </div>
        )}
      </article>
    </div>
  );
}
