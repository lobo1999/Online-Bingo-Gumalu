
import {
  SESSION_HOURS,
  sha256,
  safeEqual,
  newSessionToken,
  dbRequest,
  setSessionCookie,
  json,
  onlyMethod,
  handleError
} from "./_lib.js";

export default async function handler(req, res) {
  if (!onlyMethod(req, res, "POST")) return;

  // Reject requests coming from other websites.
  let validOrigin = false;

  try {
    const origin = new URL(req.headers.origin);
    const forwardedHost =
      req.headers["x-forwarded-host"] || req.headers.host;

    validOrigin =
      origin.protocol === "https:" &&
      origin.host === forwardedHost;
  } catch {
    validOrigin = false;
  }

  if (!validOrigin) {
    return json(res, 403, {
      error: "Request origin not allowed."
    });
  }

  try {
    const token = req.body?.token;
    const expectedHash =
      process.env.ADMIN_ACTIVATION_TOKEN_SHA256;

    const validFormat =
      typeof token === "string" &&
      /^[a-f0-9]{64}$/.test(token) &&
      typeof expectedHash === "string" &&
      /^[a-f0-9]{64}$/.test(expectedHash);

    if (
      !validFormat ||
      !safeEqual(sha256(token), expectedHash)
    ) {
      return json(res, 403, {
        error: "Token inválido. Por favor, contacta a Luis Lobo, Bingo Master, para obtener el token de acceso de administrador."
      });
    }

    const sessionToken = newSessionToken();

    const expiresAt = new Date(
      Date.now() + SESSION_HOURS * 60 * 60 * 1000
    ).toISOString();

    const activated = await dbRequest(
      "rpc/activate_bingo_admin",
      {
        method: "POST",
        body: {
          new_session_hash: sha256(sessionToken),
          new_expires_at: expiresAt
        }
      }
    );

    if (activated !== true) {
      return json(res, 409, {
        error: "Ya existe un administrador activo. Inténtalo nuevamente cuando termine su sesión de 12 horas."
      });
    }

    setSessionCookie(res, sessionToken);

    return json(res, 200, {
      success: true,
      redirect: "/control-panel/"
    });
  } catch (error) {
    return handleError(res, error);
  }
}
