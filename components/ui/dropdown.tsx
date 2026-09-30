// src/components/shared/Dropdown.tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  label?: string;
  name: string;
  options: DropdownOption[];
  defaultValue?: string;
  placeholder?: string;
  allLabel?: string;
  /** Controlled value — overrides internal state when provided. */
  value?: string;
  /** Called with the selected value on every selection. */
  onChange?: (value: string) => void;
}

export function Dropdown({
  label,
  name,
  options,
  defaultValue = "",
  placeholder = "اختر...",
  allLabel,
  value,
  onChange,
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const listboxId = useId();

  // Controlled ("value") wins; otherwise the internal state drives the UI.
  const selected = value ?? internalValue;

  const allOptions: DropdownOption[] = allLabel
    ? [{ value: "", label: allLabel }, ...options]
    : options;

  const selectedLabel =
    allOptions.find((opt) => opt.value === selected)?.label ?? placeholder;

  function handleSelect(optionValue: string) {
    if (value === undefined) {
      setInternalValue(optionValue);
    }
    onChange?.(optionValue);
    setIsOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative grid gap-1.5">
      {label ? (
        <span
          id={labelId}
          className="text-[15px] font-medium"
        >
          {label}
        </span>
      ) : null}

      {/* Hidden input carries the value for form submission */}
      <input type="hidden" name={name} value={selected} />

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-labelledby={label ? labelId : undefined}
        aria-label={label ? undefined : name}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        className="flex min-h-[2.81em] w-full items-center justify-between gap-2 rounded-lg border bg-[var(--card)] pe-2 ps-4 text-start text-base font-medium outline-none focus:shadow-[0_0_0_3px_var(--focus-ring)] focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="truncate">{selectedLabel}</span>

        <ChevronDown size={20} aria-hidden="true" className={`size-5 shrink-0 text-[var(--muted)] transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`} />
      </button>

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-full z-50 mt-2 max-h-64 w-full overflow-y-auto rounded-lg border py-1 shadow-lg bg-[var(--card)]"
        >
          {allOptions.map((option) => {
            const isSelected = option.value === selected;
            return (
              <li key={option.value || "__all__"} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`flex w-full items-center justify-between gap-2 px-4 py-1.5 text-start font-sans text-base bg-[var(--card)] ${
                    isSelected
                      ? "font-medium"
                      : ""
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && (
                    <Check size={16} aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]"/>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}