// config/env.ts validates required vars at import time, so unit tests that
// transitively import it (directly or via token.service.ts) need these set
// before any test file loads — real values are never needed since the tests
// that touch these paths mock the mongoose models instead of connecting.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-jwt-secret";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-only-jwt-refresh-secret";
process.env.MONGODB_URL = process.env.MONGODB_URL || "mongodb://127.0.0.1:27017/test-placeholder";
