import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useStoreAuth } from "../../store/useStoreAuth";
import { CONST_PAGE_ROUTES } from "../../constants";
import { verifyAccessToken } from "../../utils";

//
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
          nevigate(CONST_PAGE_ROUTES.SignIn);
        }
      } else {
        logout();
        setIsTokenValid(false);
        nevigate(CONST_PAGE_ROUTES.SignIn);
      }
    })();
  }, [accessToken, logout, nevigate, pathname]);

  //
  if (isTokenValid) {
    if (pathname === CONST_PAGE_ROUTES.SignIn) {
      return <Navigate replace={true} to={CONST_PAGE_ROUTES.home} />;
    } else {
      // return children;
    }
  } else {
    if (pathname === CONST_PAGE_ROUTES.SignIn) {
      // return children;
    } else {
      return <Navigate replace={true} to={CONST_PAGE_ROUTES.SignIn} />;
    }
  }

  //
  return <>{children}</>;
};
