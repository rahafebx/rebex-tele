import { forwardRef } from "react";

interface InputProps {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  dir?: "ltr" | "rtl" | undefined;
  disabled?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  hint?: string;
  maxLength?: number;
  minLength?: number;
  required?: boolean;
  autoComplete?: React.HTMLInputAutoCompleteAttribute;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>["inputMode"];
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      type = "text",
      placeholder,
      value,
      onChange,
      dir,
      disabled,
      className,
      hint,
      maxLength,
      minLength,
      required,
      autoComplete,
      inputMode,
    },
    ref,
  ) => {
    return (
      <>
        <label className="text-[15px] font-medium">
          {label}
          <input
            ref={ref}
            type={type}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            dir={dir}
            disabled={disabled}
            maxLength={maxLength}
            minLength={minLength}
            required={required}
            autoComplete={autoComplete}
            inputMode={inputMode}
            className={`mt-1.5 w-full rounded-lg border bg-transparent px-3 py-2.5 text-base disabled:opacity-40 ${className ?? ""}`}
          />
        </label>
        {hint && <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p>}
      </>
    );
  },
);

Input.displayName = "Input";
export default Input;
