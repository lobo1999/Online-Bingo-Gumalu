
import {
  getGame,
  getPublicGame,
  isAdmin,
  json,
  onlyMethod,
  handleError
} from "./_lib.js";

export default async function handler(req, res) {
  if (!onlyMethod(req, res, "GET")) return;

  try {
    const [game, admin] = await Promise.all([
      getGame(),
      isAdmin(req)
    ]);

    return json(res, 200, {
      game: getPublicGame(game),
      admin
    });
  } catch (error) {
    return handleError(res, error);
  }
}
