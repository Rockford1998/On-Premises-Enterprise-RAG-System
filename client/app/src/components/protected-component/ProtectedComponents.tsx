import { useStoreAuth } from "@/store/useStoreAuth";
import { verifyAccessToken } from "@/utils/verifyAccessToken";
import { useEffect } from "react";
import { useNavigate } from "react-router";

export const ProtectedComponent = ({
  children,
}: {
  children: React.ReactNode;
  permissionName?: string;
}) => {
  const navigate = useNavigate();
  const accessToken = useStoreAuth((state) => state.accessToken) || "";
  const logOut = useStoreAuth((state) => state.logOut);

  useEffect(() => {
    (async () => {
      try {
        await verifyAccessToken(accessToken);
      } catch (error) {
        console.log(error);
        logOut();
        navigate("/signin");
      }
    })();
  }, [accessToken, logOut, navigate]);
  return <>{children}</>;
};
