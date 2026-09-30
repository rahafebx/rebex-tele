// card component with children and calssName prop
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border bg-[var(--card)] ${className ?? ""}`}
      {...props}
    >
      {children}
    </div>
  );
}