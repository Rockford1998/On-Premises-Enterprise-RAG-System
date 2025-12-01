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
          console.log(accessToken);
          const isVerified = await verifyAccessToken(accessToken);
          if (isVerified) setIsTokenValid(true);
        } catch (error) {
          console.log(error);
          logout();
          setIsTokenValid(false);
          nevigate("/signin");
        }
      } else {
        logout();
        setIsTokenValid(false);
        nevigate("/signin");
      }
    })();
  }, [accessToken, logout, nevigate, pathname]);

  //
  if (isTokenValid) {
    if (pathname === "/signin") {
      return <Navigate replace={true} to="/" />;
    } else {
      // return children;
    }
  } else {
    if (pathname === "/signin") {
      // return children;
    } else {
      return <Navigate replace={true} to="/signin" />;
    }
  }

  //
  return <>{children}</>;
};
