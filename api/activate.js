
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

const origin = req.headers.origin;
const host = req.headers.host;

if (
  !origin ||
  new URL(origin).host !== host ||
  new URL(origin).protocol !== "https:"
) {
  return json(res, 403, {
    error: "Request origin not allowed."
  });
}

  try {
    const token = req.body?.token;
    const expectedHash =
      process.env.ADMIN_ACTIVATION_TOKEN_SHA256;

    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !expectedHash ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
      return json(res, 403, {
        error: "Invalid activation link."
      });
    }

    if (!safeEqual(sha256(token), expectedHash)) {
      return json(res, 403, {
        error: "Invalid activation link."
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
        error: "This activation link has already been used."
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
