import {
  BINGO_MAX,
  STATE_STORAGE_KEY,
  PRESENCE_STORAGE_KEY,
  addNumberToState,
  createStateSync,
  formatBingoNumber,
  getAvailableNumbers,
  getColumnConfig,
  getLetterForNumber,
  getRandomAvailableNumber,
  isPresentationPresent,
  isValidState,
  loadState,
  normalizeBingoNumber,
  removeNumberFromState,
  resetState,
  subscribeToPresentationPresence,
  undoLastNumberInState
} from "./bingo-state.js";

const elements = {
  currentNumber: document.querySelector("#current-number"),
  currentDescription: document.querySelector(
    "#current-number-description"
  ),

  drawnCount: document.querySelector("#drawn-count"),
  remainingCount: document.querySelector("#remaining-count"),

  manualForm: document.querySelector("#manual-form"),
  manualInput: document.querySelector("#manual-number"),

  randomButton: document.querySelector("#random-number-button"),
  undoButton: document.querySelector("#undo-button"),
  resetButton: document.querySelector("#reset-button"),
  openPresentationButton: document.querySelector(
    "#open-presentation-button"
  ),

  controlBoard: document.querySelector("#control-board"),

  historyList: document.querySelector("#history-list"),
  historyEmpty: document.querySelector("#history-empty"),
  historyCount: document.querySelector("#history-count"),

  presentationStatus: document.querySelector(
    "#presentation-status"
  ),
  presentationStatusText: document.querySelector(
    "#presentation-status-text"
  ),

  toastRegion: document.querySelector("#toast-region")
};

let currentState = loadState();
let latestPresenceSignal = 0;

const stateSync = createStateSync({
  onState(receivedState) {
    if (!isValidState(receivedState)) {
      return;
    }

    currentState = receivedState;
    render();
  },

  onError() {
    showToast(
      "El estado quedó guardado, pero BroadcastChannel no pudo transmitirlo. El navegador intentará sincronizarlo mediante almacenamiento.",
      "warning"
    );
  }
});

stateSync.setCurrentRevision(currentState.revision);

buildBoard();
render();
updatePresentationStatus();

const unsubscribePresenceStorage =
  subscribeToPresentationPresence(() => {
    updatePresentationStatus();
  });

const presenceChannel = createPresenceChannel();

const presenceCheckInterval = window.setInterval(() => {
  updatePresentationStatus();

  stateSync.postMessage({
    type: "PRESENCE_REQUEST",
    timestamp: Date.now()
  });
}, 2000);

elements.manualForm.addEventListener("submit", handleManualSubmit);

elements.randomButton.addEventListener(
  "click",
  handleRandomNumber
);

elements.undoButton.addEventListener(
  "click",
  handleUndo
);

elements.resetButton.addEventListener(
  "click",
  handleReset
);

elements.openPresentationButton.addEventListener(
  "click",
  openPresentation
);

window.addEventListener("storage", event => {
  if (
    event.key === PRESENCE_STORAGE_KEY ||
    event.key === STATE_STORAGE_KEY
  ) {
    updatePresentationStatus();
  }
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(presenceCheckInterval);
  unsubscribePresenceStorage();
  presenceChannel?.close();
  stateSync.destroy();
});

/**
 * Crea todos los elementos del tablero una sola vez.
 */
function buildBoard() {
  const fragment = document.createDocumentFragment();

  for (const column of getColumnConfig()) {
    const columnElement = document.createElement("div");
    columnElement.className = "bingo-column";
    columnElement.dataset.column = column.letter;

    const heading = document.createElement("h3");
    heading.className =
      `bingo-column__heading bingo-column__heading--${column.letter.toLowerCase()}`;
    heading.textContent = column.letter;

    const numbers = document.createElement("div");
    numbers.className = "bingo-column__numbers";

    for (
      let number = column.min;
      number <= column.max;
      number += 1
    ) {
      const cell = document.createElement("div");
      cell.className = "bingo-number";
      cell.dataset.number = String(number);

      const value = document.createElement("span");
      value.className = "bingo-number__value";
      value.textContent = String(number);

      const status = document.createElement("span");
      status.className = "bingo-number__status";
      status.setAttribute("aria-hidden", "true");

      cell.append(value, status);
      numbers.append(cell);
    }

    columnElement.append(heading, numbers);
    fragment.append(columnElement);
  }

  elements.controlBoard.replaceChildren(fragment);
}

/**
 * Actualiza todo el panel a partir de currentState.
 */
function render() {
  renderSummary();
  renderBoard();
  renderHistory();
  renderActionAvailability();
}

/**
 * Número principal y contadores.
 */
function renderSummary() {
  const count = currentState.drawnNumbers.length;
  const remaining = BINGO_MAX - count;

  elements.drawnCount.textContent = String(count);
  elements.remainingCount.textContent = String(remaining);

  if (currentState.lastNumber === null) {
    elements.currentNumber.textContent = "—";
    elements.currentNumber.dataset.letter = "";

    elements.currentDescription.textContent =
      "Todavía no se ha anunciado ningún número.";

    return;
  }

  const letter = getLetterForNumber(currentState.lastNumber);

  elements.currentNumber.textContent =
    formatBingoNumber(currentState.lastNumber);

  elements.currentNumber.dataset.letter = letter;

  elements.currentDescription.textContent =
    remaining === 0
      ? "¡Se anunciaron los 75 números!"
      : "Último número anunciado.";
}

/**
 * Estado visual de las 75 celdas.
 */
function renderBoard() {
  const drawnSet = new Set(currentState.drawnNumbers);

  elements.controlBoard
    .querySelectorAll(".bingo-number")
    .forEach(cell => {
      const number = Number(cell.dataset.number);
      const isDrawn = drawnSet.has(number);

      cell.classList.toggle(
        "bingo-number--drawn",
        isDrawn
      );

      cell.classList.toggle(
        "bingo-number--available",
        !isDrawn
      );

      cell.setAttribute(
        "aria-label",
        isDrawn
          ? `${formatBingoNumber(number)}, anunciado`
          : `${formatBingoNumber(number)}, disponible`
      );

      const status = cell.querySelector(
        ".bingo-number__status"
      );

      status.textContent = isDrawn ? "✓" : "";
    });
}

/**
 * Renderiza el historial cronológico.
 */
function renderHistory() {
  const count = currentState.drawnNumbers.length;

  elements.historyCount.textContent =
    `${count} ${count === 1 ? "número" : "números"}`;

  elements.historyEmpty.hidden = count > 0;
  elements.historyList.hidden = count === 0;

  const fragment = document.createDocumentFragment();

  currentState.drawnNumbers.forEach((number, index) => {
    const item = document.createElement("li");
    item.className = "history-item";

    if (index === count - 1) {
      item.classList.add("history-item--latest");
    }

    const order = document.createElement("span");
    order.className = "history-item__order";
    order.textContent = String(index + 1);

    const value = document.createElement("span");
    value.className = "history-item__number";
    value.textContent = formatBingoNumber(number);

    const label = document.createElement("span");
    label.className = "history-item__label";
    label.textContent =
      index === count - 1
        ? "Último anunciado"
        : "Anunciado";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className =
      "button button--small button--remove";
    removeButton.textContent = "Quitar";
    removeButton.setAttribute(
      "aria-label",
      `Quitar ${formatBingoNumber(number)} del historial`
    );

    removeButton.addEventListener("click", () => {
      handleRemoveNumber(number);
    });

    const info = document.createElement("div");
    info.className = "history-item__info";
    info.append(value, label);

    item.append(order, info, removeButton);
    fragment.append(item);
  });

  elements.historyList.replaceChildren(fragment);
}

/**
 * Habilita/deshabilita acciones cuando corresponda.
 */
function renderActionAvailability() {
  const count = currentState.drawnNumbers.length;

  elements.undoButton.disabled = count === 0;
  elements.randomButton.disabled = count >= BINGO_MAX;
}

/**
 * Registro manual.
 */
function handleManualSubmit(event) {
  event.preventDefault();

  const number = normalizeBingoNumber(
    elements.manualInput.value
  );

  if (number === null) {
    showToast(
      "Ingresa un número entero entre 1 y 75.",
      "error"
    );

    elements.manualInput.focus();
    elements.manualInput.select();
    return;
  }

  try {
    const nextState = addNumberToState(
      currentState,
      number
    );

    commitState(nextState);

    elements.manualInput.value = "";
    elements.manualInput.focus();

    showToast(
      `${formatBingoNumber(number)} registrado correctamente.`,
      "success"
    );
  } catch (error) {
    handleDomainError(error);
    elements.manualInput.focus();
    elements.manualInput.select();
  }
}

/**
 * Número aleatorio exclusivamente entre los disponibles.
 */
function handleRandomNumber() {
  const availableNumbers = getAvailableNumbers(currentState);

  if (availableNumbers.length === 0) {
    showToast(
      "Ya se anunciaron los 75 números. No quedan números disponibles.",
      "warning"
    );
    return;
  }

  const number = getRandomAvailableNumber(currentState);

  if (number === null) {
    showToast(
      "No quedan números disponibles.",
      "warning"
    );
    return;
  }

  try {
    const nextState = addNumberToState(
      currentState,
      number
    );

    commitState(nextState);

    showToast(
      `Número aleatorio: ${formatBingoNumber(number)}.`,
      "success"
    );
  } catch (error) {
    handleDomainError(error);
  }
}

/**
 * Deshacer último.
 */
function handleUndo() {
  if (currentState.drawnNumbers.length === 0) {
    showToast(
      "Todavía no hay números para deshacer.",
      "warning"
    );
    return;
  }

  const removedNumber = currentState.lastNumber;

  try {
    const nextState = undoLastNumberInState(
      currentState
    );

    commitState(nextState);

    showToast(
      `${formatBingoNumber(removedNumber)} fue deshecho.`,
      "info"
    );
  } catch (error) {
    handleDomainError(error);
  }
}

/**
 * Quita un número concreto.
 */
function handleRemoveNumber(number) {
  try {
    const nextState = removeNumberFromState(
      currentState,
      number
    );

    commitState(nextState);

    showToast(
      `${formatBingoNumber(number)} fue retirado del historial y vuelve a estar disponible.`,
      "info"
    );
  } catch (error) {
    handleDomainError(error);
  }
}

/**
 * Reinicio con confirmación explícita.
 */
function handleReset() {
  if (currentState.drawnNumbers.length === 0) {
    showToast(
      "El bingo ya está vacío.",
      "info"
    );
    return;
  }

  const confirmed = window.confirm(
    "¿Reiniciar completamente el bingo?\n\n" +
    "Se borrarán todos los números anunciados y los 75 números volverán a estar disponibles."
  );

  if (!confirmed) {
    showToast(
      "Reinicio cancelado.",
      "info"
    );
    return;
  }

  const nextState = resetState(currentState);
  commitState(nextState);

  elements.manualInput.value = "";

  showToast(
    "Bingo reiniciado correctamente. Los 75 números están disponibles.",
    "success"
  );
}

/**
 * Persiste y difunde una modificación.
 */
function commitState(nextState) {
  try {
    currentState = stateSync.publish(nextState);
    render();
  } catch (error) {
    console.error(error);

    showToast(
      error?.message ||
        "Ocurrió un error al guardar el estado del bingo.",
      "error"
    );
  }
}

/**
 * Abre la presentación usando la ruta limpia.
 */
function openPresentation() {
  const presentationWindow = window.open(
    "/bingo-home",
    "baby-shower-bingo-presentation"
  );

  if (!presentationWindow) {
    showToast(
      "El navegador bloqueó la ventana emergente. Permite ventanas emergentes para este sitio e inténtalo nuevamente.",
      "error",
      6500
    );

    return;
  }

  try {
    presentationWindow.focus();
  } catch {
    // El foco puede estar restringido por el navegador.
  }

  stateSync.postMessage({
    type: "PRESENCE_REQUEST",
    timestamp: Date.now()
  });

  showToast(
    "Pantalla del bingo abierta.",
    "success"
  );
}

/**
 * BroadcastChannel auxiliar para mensajes de presencia.
 */
function createPresenceChannel() {
  if (!("BroadcastChannel" in window)) {
    return null;
  }

  try {
    const channel = new BroadcastChannel(
      "baby-shower-bingo"
    );

    channel.addEventListener("message", event => {
      const message = event.data;

      if (
        !message ||
        typeof message !== "object"
      ) {
        return;
      }

      if (message.type === "PRESENTATION_PRESENCE") {
        latestPresenceSignal = Date.now();
        updatePresentationStatus();
      }
    });

    return channel;
  } catch (error) {
    console.warn(
      "No se pudo crear el canal de presencia:",
      error
    );

    return null;
  }
}

/**
 * Estado conectado/desconectado.
 *
 * Usa cualquiera de:
 * - mensaje reciente por BroadcastChannel;
 * - heartbeat reciente en localStorage.
 */
function updatePresentationStatus() {
  const recentBroadcast =
    Date.now() - latestPresenceSignal < 6500;

  const connected =
    recentBroadcast || isPresentationPresent();

  elements.presentationStatus.classList.toggle(
    "connection-status--online",
    connected
  );

  elements.presentationStatus.classList.toggle(
    "connection-status--offline",
    !connected
  );

  elements.presentationStatusText.textContent =
    connected
      ? "Pantalla del bingo conectada"
      : "Pantalla del bingo no conectada";
}

/**
 * Traduce errores de dominio a notificaciones.
 */
function handleDomainError(error) {
  console.error(error);

  const message =
    error?.message ||
    "No fue posible completar la acción.";

  showToast(message, "error");
}

/**
 * Toast accesible y sin dependencias.
 */
function showToast(
  message,
  type = "info",
  duration = 4200
) {
  const toast = document.createElement("div");

  toast.className =
    `toast toast--${type}`;

  toast.setAttribute("role", "status");

  const icon = document.createElement("span");
  icon.className = "toast__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = getToastIcon(type);

  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "toast__close";
  closeButton.setAttribute(
    "aria-label",
    "Cerrar notificación"
  );
  closeButton.textContent = "×";

  const removeToast = () => {
    toast.classList.add("toast--leaving");

    window.setTimeout(() => {
      toast.remove();
    }, 200);
  };

  closeButton.addEventListener(
    "click",
    removeToast
  );

  toast.append(icon, text, closeButton);
  elements.toastRegion.append(toast);

  window.setTimeout(removeToast, duration);
}

function getToastIcon(type) {
  const icons = {
    success: "✓",
    error: "!",
    warning: "!",
    info: "i"
  };

  return icons[type] ?? "i";
}
