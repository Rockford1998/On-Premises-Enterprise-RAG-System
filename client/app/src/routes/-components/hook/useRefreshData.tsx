import { useState } from "react";

export const useRefreshData = () => {
  const [count, setCount] = useState<number>(0);
  const refreshData = () => {
    setCount((prev) => (prev ?? 0) + 1);
  };

  return {
    count,
    refreshData,
  };
};
