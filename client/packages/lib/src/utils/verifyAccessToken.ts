/* eslint-disable @typescript-eslint/no-explicit-any */
import { importSPKI, jwtVerify } from "jose";

export const verifyAccessToken = async (accessToken: string) => {
  try {
    const VITE_ALGORITHM = "RS256";
    const VITE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvAMDMEx2kTVwFVtJMGsZ
rYviTH07F+NjeutOHS6xpJ/pdw1HVU8SXj1ZQZAUkjlOXbPjvhJ8dLVAqv7uukDg
LGK0INDJnGDpUfOvVRdpqCS3ski6hPYOMN8Yr98O1V62IiVf6rpdOIHsm3Qn45DW
TSp+JNEV+B379U8QZjeqCKJazQkELuzMu680kmaR3yxJN478Lw9sOl270WcM4iwc
6oif3hB6wVCkoc0+9u8YUMWx5pO5ft7MMXrkS6Aa5aaDYKNYUaoF8HwatYpuJj50
FvUO4DaCWRgfXy+wa41zxAju1ccoNO8pDxQ1zZLk2yBIwQSSV3FTKdpAeOap76hW
ywIDAQAB
-----END PUBLIC KEY-----`

    const spki = await importSPKI(VITE_PUBLIC_KEY, VITE_ALGORITHM);
    const { payload }: { payload: any } = await jwtVerify(accessToken, spki);
    return payload;
  } catch (err: any) {
    console.log(err);
  }
};
