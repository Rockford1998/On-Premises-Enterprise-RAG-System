import { Response } from "express";

/**
 * Valid HTTP status codes for the response
 */
type SuccessStatusCode = 200 | 201 | 202 | 204;
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503;

/**
 * Options for sending a success API response
 */
export type DataWithPagination = {
  page: number;
  limit: number;
  total: number;
  data: any[];
};

interface WithoutPagination {
  res: Response;
  success: true;
  message: string;
  data?: any;
  status: SuccessStatusCode;
}

interface WithPagination {
  res: Response;
  success: true;
  pagination: true;
  message: string;
  data: DataWithPagination;
  status: SuccessStatusCode;
}

type SuccessResponseOptions = WithoutPagination | WithPagination;

/**
 * Machine-readable error codes. Clients branch on these rather than on
 * message text — notably TOKEN_EXPIRED, which tells the browser to attempt a
 * silent refresh instead of bouncing the user to sign-in.
 */
export type ApiErrorCode =
  | "TOKEN_EXPIRED"
  | "TOKEN_INVALID"
  | "TOKEN_MISSING"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_DISABLED"
  | "SESSION_EXPIRED"
  | "SESSION_REUSE_DETECTED"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR";

/**
 * Options for sending an error API response
 */
interface ErrorResponseOptions {
  res: Response;
  success: false;
  message: string;
  status: ErrorStatusCode;
  code?: ApiErrorCode;
}

/**
 * Union of success and error response options
 */
type SendResponseOptions = SuccessResponseOptions | ErrorResponseOptions;

/**
 * Send a standardized API response
 */
export const sendResponse = (options: SendResponseOptions) => {
  const { res, status, ...responseBody } = options;

  return res
    .status(status as number)
    .json(responseBody);
};
