import { redirect } from "@tanstack/react-router";
import { useStoreAuth } from "@/store/useStoreAuth";
import { verifyAccessToken } from "@/utils/verifyAccessToken";

export const ProtectedRoute = async ({ location }: any) => {
  const { accessToken, logOut } = useStoreAuth.getState();

  // No token → redirect
  if (!accessToken) {
    logOut();
    throw redirect({
      to: "/sign-in",
      search: { redirect: location.href },
    });
  }

  try {
    const isVerified = await verifyAccessToken(accessToken);

    if (!isVerified) {
      logOut();
      throw redirect({ to: "/sign-in" });
    }
  } catch (err) {
    logOut();
    throw redirect({ to: "/sign-in" });
  }
};
