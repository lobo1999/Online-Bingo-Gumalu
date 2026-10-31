import {
  BINGO_MAX,
  CHANNEL_NAME,
  PRESENCE_STORAGE_KEY,
  clearPresentationPresence,
  createStateSync,
  formatBingoNumber,
  getColumnConfig,
  getLetterForNumber,
  isValidState,
  loadState,
  updatePresentationPresence
} from "./bingo-state.js";

const elements = {
  board: document.querySelector("#presentation-board"),
  lastNumberPanel: document.querySelector("#last-number-panel"),
  lastNumber: document.querySelector("#presentation-last-number"),
  lastNumberLetter: document.querySelector(
    ".presentation-last-number__letter"
  ),
  lastNumberValue: document.querySelector(
    ".presentation-last-number__number"
  ),
  message: document.querySelector("#presentation-message"),
  drawnCount: document.querySelector("#presentation-drawn-count")
};

let currentState = loadState();
let previousRenderedLastNumber = null;
let hasRenderedInitialState = false;

const stateSync = createStateSync({
  onState(receivedState) {
    if (!isValidState(receivedState)) {
      return;
    }

    currentState = receivedState;
    render();
  },

  onError(error) {
    console.warn(
      "Error de sincronización de la presentación:",
      error
    );
  }
});

stateSync.setCurrentRevision(currentState.revision);

buildBoard();
render();

const presenceChannel = createPresenceChannel();

announcePresence();

const heartbeatInterval = window.setInterval(() => {
  announcePresence();
}, 2000);

window.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    const persistedState = loadState();

    if (
      isValidState(persistedState) &&
      persistedState.revision > currentState.revision
    ) {
      currentState = persistedState;
      stateSync.setCurrentRevision(
        persistedState.revision
      );
      render();
    }

    announcePresence();
  }
});

window.addEventListener("pagehide", cleanup);
window.addEventListener("beforeunload", cleanup);

/**
 * Crea las cinco columnas y las 75 celdas.
 */
function buildBoard() {
  const fragment = document.createDocumentFragment();

  for (const column of getColumnConfig()) {
    const columnElement = document.createElement("div");

    columnElement.className = "bingo-column";
    columnElement.dataset.column = column.letter;

    const heading = document.createElement("h2");

    heading.className =
      `bingo-column__heading bingo-column__heading--${column.letter.toLowerCase()}`;

    heading.textContent = column.letter;

    const numberContainer = document.createElement("div");
    numberContainer.className = "bingo-column__numbers";

    for (
      let number = column.min;
      number <= column.max;
      number += 1
    ) {
      const cell = document.createElement("div");
      cell.className =
        "bingo-number bingo-number--available";

      cell.dataset.number = String(number);

      const value = document.createElement("span");
      value.className = "bingo-number__value";
      value.textContent = String(number);

      const status = document.createElement("span");
      status.className = "bingo-number__status";
      status.setAttribute("aria-hidden", "true");

      cell.append(value, status);
      numberContainer.append(cell);
    }

    columnElement.append(
      heading,
      numberContainer
    );

    fragment.append(columnElement);
  }

  elements.board.replaceChildren(fragment);
}

/**
 * Render de presentación.
 */
function render() {
  renderBoard();
  renderCounter();
  renderLastNumber();

  hasRenderedInitialState = true;
}

/**
 * Actualiza las 75 celdas.
 */
function renderBoard() {
  const drawnSet = new Set(currentState.drawnNumbers);

  elements.board
    .querySelectorAll(".bingo-number")
    .forEach(cell => {
      const number = Number(cell.dataset.number);
      const drawn = drawnSet.has(number);

      cell.classList.toggle(
        "bingo-number--drawn",
        drawn
      );

      cell.classList.toggle(
        "bingo-number--available",
        !drawn
      );

      const status = cell.querySelector(
        ".bingo-number__status"
      );

      status.textContent = drawn ? "✓" : "";

      cell.setAttribute(
        "aria-label",
        drawn
          ? `${formatBingoNumber(number)}, anunciado`
          : `${formatBingoNumber(number)}, disponible`
      );
    });
}

function renderCounter() {
  elements.drawnCount.textContent =
    String(currentState.drawnNumbers.length);
}

/**
 * Último número + estados inicial/final.
 */
function renderLastNumber() {
  const count = currentState.drawnNumbers.length;
  const lastNumber = currentState.lastNumber;

  if (count === 0 || lastNumber === null) {
    elements.lastNumberLetter.textContent = "";
    elements.lastNumberValue.textContent = "—";

    elements.message.textContent =
      "¡Bienvenidos! El bingo comenzará en breve.";

    elements.lastNumberPanel.classList.remove(
      "last-number-panel--complete"
    );

    previousRenderedLastNumber = null;
    return;
  }

  const letter = getLetterForNumber(lastNumber);

  elements.lastNumberLetter.textContent = letter;
  elements.lastNumberValue.textContent = String(lastNumber);

  elements.lastNumberPanel.dataset.letter = letter;

  if (count === BINGO_MAX) {
    elements.message.textContent =
      "¡Han salido todos los números!";

    elements.lastNumberPanel.classList.add(
      "last-number-panel--complete"
    );
  } else {
    elements.message.textContent =
      `${BINGO_MAX - count} números disponibles`;
    elements.lastNumberPanel.classList.remove(
      "last-number-panel--complete"
    );
  }

  const shouldAnimate =
    hasRenderedInitialState &&
    lastNumber !== previousRenderedLastNumber;

  if (shouldAnimate) {
    animateLastNumber();
  }

  previousRenderedLastNumber = lastNumber;
}

/**
 * Reinicia la clase para permitir animaciones consecutivas.
 */
function animateLastNumber() {
  elements.lastNumber.classList.remove(
    "presentation-last-number--animate"
  );

  // Fuerza un reflow para reiniciar la animación CSS.
  void elements.lastNumber.offsetWidth;

  elements.lastNumber.classList.add(
    "presentation-last-number--animate"
  );
}

/**
 * Presencia: BroadcastChannel + heartbeat localStorage.
 */
function announcePresence() {
  const presence = updatePresentationPresence();

  try {
    presenceChannel?.postMessage({
      type: "PRESENTATION_PRESENCE",
      timestamp: presence.timestamp
    });
  } catch (error) {
    console.warn(
      "No se pudo enviar la presencia:",
      error
    );
  }
}

function createPresenceChannel() {
  if (!("BroadcastChannel" in window)) {
    return null;
  }

  try {
    const channel = new BroadcastChannel(
      CHANNEL_NAME
    );

    channel.addEventListener("message", event => {
      const message = event.data;

      if (
        !message ||
        typeof message !== "object"
      ) {
        return;
      }

      if (message.type === "PRESENCE_REQUEST") {
        announcePresence();
      }
    });

    return channel;
  } catch (error) {
    console.warn(
      "BroadcastChannel de presencia no disponible:",
      error
    );

    return null;
  }
}

let cleanedUp = false;

function cleanup() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;

  window.clearInterval(heartbeatInterval);

  try {
    clearPresentationPresence();
  } catch {
    // Sin impacto sobre el bingo.
  }

  try {
    presenceChannel?.close();
  } catch {
    // Ignorar.
  }

  stateSync.destroy();
}
