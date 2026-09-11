/**
 * Google Drive OAuth + API helpers for Drive knowledge-base connections.
 * Each connection stores its own refresh token (encrypted — see util/crypto.ts)
 * obtained through the standard OAuth consent flow, rather than one shared
 * service-account key, so different connections can point at different
 * Google accounts.
 */
import { google, drive_v3 } from "googleapis";
import { env } from "../config/env";
import { decryptSecret } from "./crypto";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

/** Mirrors SUPPORTED_UPLOAD_EXTENSIONS (minus zip) — kept to what readFile() can parse. */
const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",
];

/**
 * Native Google Workspace files (Docs, Slides) have no fixed binary form, so
 * they can't be downloaded with files.get(alt: media) — they must be
 * exported to one of the formats above instead. Maps each to the export
 * mime type/extension to request. Sheets is deliberately excluded: its
 * export formats (xlsx/csv) have no loader in readFile(), and PDF export
 * destroys the tabular structure.
 */
const GOOGLE_NATIVE_EXPORT_MIME_TYPES: Record<string, { exportMimeType: string; extension: string }> = {
  "application/vnd.google-apps.document": { exportMimeType: "application/pdf", extension: "pdf" },
  "application/vnd.google-apps.presentation": {
    exportMimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  },
};

/** Appends the right extension for a native Google file so readFile() picks the matching loader. */
export const driveFileNameFor = (file: Pick<DriveFileMeta, "name" | "mimeType">): string => {
  const native = GOOGLE_NATIVE_EXPORT_MIME_TYPES[file.mimeType];
  return native ? `${file.name}.${native.extension}` : file.name;
};

export class GoogleOAuthNotConfiguredError extends Error {
  constructor() {
    super(
      "Google Drive sync is not configured. Set GOOGLE_OAUTH_CLIENT_ID, " +
      "GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI and " +
      "CREDENTIALS_ENCRYPTION_KEY before connecting a Drive source.",
    );
    this.name = "GoogleOAuthNotConfiguredError";
  }
}

const assertConfigured = () => {
  const { clientId, clientSecret, redirectUri } = env.googleOAuth;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleOAuthNotConfiguredError();
  }
};

export const buildOAuthClient = () => {
  assertConfigured();
  return new google.auth.OAuth2(
    env.googleOAuth.clientId,
    env.googleOAuth.clientSecret,
    env.googleOAuth.redirectUri,
  );
};

/** access_type "offline" + prompt "consent" force a refresh token even on a re-auth. */
export const getAuthUrl = (state: string): string => {
  const client = buildOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
};

export const exchangeCodeForTokens = async (
  code: string,
): Promise<{ refreshToken: string; accountEmail: string }> => {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke this app's access at " +
      "https://myaccount.google.com/permissions and try connecting again.",
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) {
    throw new Error("Could not read the connected Google account's email address.");
  }

  return { refreshToken: tokens.refresh_token, accountEmail: data.email };
};

/** Builds an authenticated Drive client from a connection's encrypted refresh token. */
export const driveClientFor = (refreshTokenEncrypted: string): drive_v3.Drive => {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: decryptSecret(refreshTokenEncrypted) });
  return google.drive({ version: "v3", auth: client });
};

export type DriveFileMeta = {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
  modifiedTime?: string;
  size?: string;
};

/** Paginated listing of non-trashed, ingestible files directly inside one folder. */
export const listFolderFiles = async (
  drive: drive_v3.Drive,
  folderId: string,
): Promise<DriveFileMeta[]> => {
  const allMimeTypes = [...SUPPORTED_MIME_TYPES, ...Object.keys(GOOGLE_NATIVE_EXPORT_MIME_TYPES)];
  const mimeFilter = allMimeTypes.map((t) => `mimeType = '${t}'`).join(" or ");
  const q = `'${folderId}' in parents and trashed = false and (${mimeFilter})`;

  const files: DriveFileMeta[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q,
      fields: "nextPageToken, files(id, name, mimeType, md5Checksum, modifiedTime, size)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of data.files ?? []) {
      if (f.id && f.name && f.mimeType) {
        files.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          md5Checksum: f.md5Checksum ?? undefined,
          modifiedTime: f.modifiedTime ?? undefined,
          size: f.size ?? undefined,
        });
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
};

export type DriveFolderMeta = {
  id: string;
  name: string;
  parentId?: string;
};

/** All non-trashed folders the account can see, across My Drive and shared drives. */
export const listFolders = async (drive: drive_v3.Drive): Promise<DriveFolderMeta[]> => {
  const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";

  const folders: DriveFolderMeta[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await drive.files.list({
      q,
      fields: "nextPageToken, files(id, name, parents)",
      pageSize: 200,
      pageToken,
      corpora: "allDrives",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    for (const f of data.files ?? []) {
      if (f.id && f.name) {
        folders.push({ id: f.id, name: f.name, parentId: f.parents?.[0] ?? undefined });
      }
    }
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return folders;
};

export const downloadFileBuffer = async (
  drive: drive_v3.Drive,
  file: Pick<DriveFileMeta, "id" | "mimeType">,
): Promise<Buffer> => {
  const native = GOOGLE_NATIVE_EXPORT_MIME_TYPES[file.mimeType];
  const res = native
    ? await drive.files.export(
        { fileId: file.id, mimeType: native.exportMimeType },
        { responseType: "arraybuffer" },
      )
    : await drive.files.get(
        { fileId: file.id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      );
  return Buffer.from(res.data as ArrayBuffer);
};
