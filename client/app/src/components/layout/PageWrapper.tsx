import type { JSX } from "react";

interface PageWrapProps {
  title?: string;
  children: JSX.Element | Array<JSX.Element>;
  actions?: React.ReactNode;
}

export const PageWrapper = ({ children, actions, title }: PageWrapProps) => {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        {title && (
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white border-b-2 border-black dark:border-white pb-1">
            {title}
          </h2>
        )}
        <div className="flex">{actions ?? null}</div>
      </div>
      <div className="h-full ">{children}</div>
    </div>
  );
};
