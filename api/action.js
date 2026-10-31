import { randomInt } from "node:crypto";

import {
  getGame,
  getPublicGame,
  isAdmin,
  dbRequest,
  json,
  onlyMethod,
  handleError
} from "./_lib.js";


const VALID_ACTIONS = new Set([
  "announce",
  "random",
  "undo",
  "reset",
  "celebrate"
]);

function chooseRandom(available) {
  return available[randomInt(available.length)];
}

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
    if (!(await isAdmin(req))) {
      return json(res, 401, {
        error: "Administrator session required."
      });
    }

    const action = req.body?.action;

    if (!VALID_ACTIONS.has(action)) {
      return json(res, 400, {
        error: "Invalid action."
      });
    }

    const game = await getGame();
    let numbers = [...game.called_numbers];
    let celebrationSeq = Number(game.celebration_seq);
    let celebrationAt = game.celebration_at;

    if (action === "announce") {
      const number = Number(req.body?.number);

      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 75
      ) {
        return json(res, 400, {
          error: "Number must be between 1 and 75."
        });
      }

      if (numbers.includes(number)) {
        return json(res, 409, {
          error: `Number ${number} was already announced.`
        });
      }

      numbers.push(number);
    }

    if (action === "random") {
      const available = [];

      for (let n = 1; n <= 75; n++) {
        if (!numbers.includes(n)) {
          available.push(n);
        }
      }

      if (available.length === 0) {
        return json(res, 409, {
          error: "All 75 numbers have been announced."
        });
      }

      numbers.push(chooseRandom(available));
    }

    if (action === "undo") {
      if (numbers.length === 0) {
        return json(res, 409, {
          error: "There are no numbers to undo."
        });
      }

      numbers.pop();
    }

    if (action === "reset") {
      numbers = [];
    }

    if (action === "celebrate") {
      celebrationSeq += 1;
      celebrationAt = new Date().toISOString();
    }

    const updated = await dbRequest(
      "rpc/update_bingo_game",
      {
        method: "POST",
        body: {
          expected_version: game.version,
          new_numbers: numbers,
          new_celebration_seq: celebrationSeq,
          new_celebration_at: celebrationAt
        }
      }
    );

    if (updated !== true) {
      return json(res, 409, {
        error: "Game changed. Please try again."
      });
    }

    const newGame = await getGame();

    return json(res, 200, {
      success: true,
      game: getPublicGame(newGame)
    });
  } catch (error) {
    return handleError(res, error);
  }
}
