import type { JSX } from "react";

interface PageWrapProps {
  title: string;
  children: JSX.Element | Array<JSX.Element>;
  actions?: React.ReactNode;
}

export const PageWrapper = ({ children, actions, title }: PageWrapProps) => {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="scroll-m-20 text-2xl font-semibold tracking-tight">
          {title}
        </h3>
        <div className="flex">{actions ? actions : null}</div>
      </div>
      <div>{children}</div>
    </div>
  );
};
