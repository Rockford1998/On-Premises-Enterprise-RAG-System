import { Response } from "express";

/**
 * Valid HTTP status codes for the response
 */
type SuccessStatusCode = 200 | 201 | 202 | 204;
type ErrorStatusCode = 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503;

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
 * Options for sending an error API response
 */
interface ErrorResponseOptions {
  res: Response;
  success: false;
  message: string;
  status: ErrorStatusCode;
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
