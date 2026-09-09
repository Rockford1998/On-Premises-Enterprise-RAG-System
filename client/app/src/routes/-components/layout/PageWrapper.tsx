import type { JSX } from "react";

interface PageWrapProps {
  title?: string;
  children: JSX.Element | Array<JSX.Element>;
  actions?: React.ReactNode;
}

export const PageWrapper = ({ children, actions, title }: PageWrapProps) => {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        {title && (
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h2>
        )}
        <div className="flex items-center gap-2">{actions ?? null}</div>
      </div>
      <div className="h-full">{children}</div>
    </div>
  );
};
