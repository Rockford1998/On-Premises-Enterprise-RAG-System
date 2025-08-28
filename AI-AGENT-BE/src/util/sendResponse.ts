import { Response } from "express";

interface SendResponseOptions {
  success?: boolean;
  message?: string;
  data?: any;
  error?: any;
  status?: number;
}

export const sendResponse = (
  res: Response,
  { success = true, message = "", data = null, error = null, status = 200 }: SendResponseOptions
) => {
  return res.status(status).json({
    success,
    message,
    ...(data !== null && { data }),
    ...(error && { error }),
  });
};
