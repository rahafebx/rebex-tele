// page heading typescript component
import React from "react";
import Link from "next/link";
interface PageHeadingProps {
  title: string;
  preTitle?: string;
  description?: string;
  link?: string;
  linkText?: string;
}

// `preTitle` and `description` deliberately mirror the landing page's
// components/landing/section.tsx — accent-coloured eyebrow, then a muted
// lead paragraph in the same measure — so a dashboard page and a landing
// section read as the same product.
const PageHeading: React.FC<PageHeadingProps> = ({
  title,
  preTitle,
  description,
  link,
  linkText,
}) => {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="max-w-2xl">
          {preTitle && (
            <p className="text-[15px] font-medium text-[var(--accent)]">
              {preTitle}
            </p>
          )}
          <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
          {description && (
            <p className="mt-3 text-[17px] leading-relaxed text-[var(--muted)]">
              {description}
            </p>
          )}
        </div>
        {link && linkText && (
          <Link
            href={link}
            className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-center text-[15px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            {linkText}
          </Link>
        )}
      </div>
  );
}

export default PageHeading;
