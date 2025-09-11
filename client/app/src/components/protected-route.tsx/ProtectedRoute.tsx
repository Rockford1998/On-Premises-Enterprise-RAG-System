import { useStoreAuth } from "@/store/useStoreAuth";
import { verifyAccessToken } from "@/utils/verifyAccessToken";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  //
  const pathname = location.pathname;
  const accessToken = useStoreAuth((state) => state.accessToken);
  const [isTokenValid, setIsTokenValid] = useState(!!accessToken);
  const logout = useStoreAuth((state) => state.logOut);
  const nevigate = useNavigate();

  useEffect(() => {
    (async () => {
      if (accessToken) {
        try {
          const payload = await verifyAccessToken(accessToken);
          if (payload) setIsTokenValid(true);
        } catch (error) {
          logout();
          setIsTokenValid(false);
          nevigate("/login");
        }
      } else {
        logout();
        setIsTokenValid(false);
        nevigate("/login");
      }
    })();
  }, [accessToken, logout, nevigate, pathname]);

  //
  if (isTokenValid) {
    if (pathname === "/login") {
      return <Navigate replace={true} to="/" />;
    } else {
      // return children;
    }
  } else {
    if (pathname === "/login") {
      // return children;
    } else {
      return <Navigate replace={true} to="/login" />;
    }
  }

  //
  return <>{children}</>;
};
