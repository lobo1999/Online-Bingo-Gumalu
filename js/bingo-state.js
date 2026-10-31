/**
 * Estado y sincronización compartidos del bingo.
 *
 * No depende del DOM, por lo que puede reutilizarse tanto en el panel
 * de control como en la presentación.
 */

export const BINGO_MIN = 1;
export const BINGO_MAX = 75;

export const STATE_STORAGE_KEY = "baby-shower-bingo-state";
export const PRESENCE_STORAGE_KEY = "baby-shower-bingo-presentation-presence";

export const CHANNEL_NAME = "baby-shower-bingo";

const PRESENCE_TIMEOUT_MS = 6500;

const COLUMN_CONFIG = Object.freeze([
  { letter: "B", min: 1, max: 15 },
  { letter: "I", min: 16, max: 30 },
  { letter: "N", min: 31, max: 45 },
  { letter: "G", min: 46, max: 60 },
  { letter: "O", min: 61, max: 75 }
]);

/**
 * Crea un estado inicial seguro.
 */
export function createInitialState() {
  return {
    drawnNumbers: [],
    lastNumber: null,
    updatedAt: null,
    revision: 0
  };
}

/**
 * Copia defensiva de un estado válido.
 */
export function cloneState(state) {
  return {
    drawnNumbers: [...state.drawnNumbers],
    lastNumber: state.lastNumber,
    updatedAt: state.updatedAt,
    revision: state.revision
  };
}

/**
 * Comprueba que un valor sea un número entero de bingo válido.
 */
export function isValidBingoNumber(value) {
  return (
    Number.isInteger(value) &&
    value >= BINGO_MIN &&
    value <= BINGO_MAX
  );
}

/**
 * Convierte un valor a entero si representa exactamente un número válido.
 */
export function normalizeBingoNumber(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const number = Number(value);

  return isValidBingoNumber(number) ? number : null;
}

/**
 * Valida exhaustivamente el formato persistido/recibido.
 *
 * Requisitos:
 * - Objeto plano.
 * - drawnNumbers es array.
 * - Todos son enteros 1..75.
 * - Sin duplicados.
 * - lastNumber es null o un número presente.
 * - Si hay números, lastNumber debe ser el último del historial.
 * - revision es entero >= 0.
 * - updatedAt es null o una fecha ISO válida.
 */
export function isValidState(candidate) {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return false;
  }

  const {
    drawnNumbers,
    lastNumber,
    updatedAt,
    revision
  } = candidate;

  if (!Array.isArray(drawnNumbers)) {
    return false;
  }

  if (drawnNumbers.length > BINGO_MAX) {
    return false;
  }

  if (!drawnNumbers.every(isValidBingoNumber)) {
    return false;
  }

  if (new Set(drawnNumbers).size !== drawnNumbers.length) {
    return false;
  }

  if (
    !Number.isInteger(revision) ||
    revision < 0
  ) {
    return false;
  }

  if (updatedAt !== null) {
    if (typeof updatedAt !== "string") {
      return false;
    }

    const timestamp = Date.parse(updatedAt);

    if (Number.isNaN(timestamp)) {
      return false;
    }
  }

  if (drawnNumbers.length === 0) {
    return lastNumber === null;
  }

  if (!isValidBingoNumber(lastNumber)) {
    return false;
  }

  return lastNumber === drawnNumbers[drawnNumbers.length - 1];
}

/**
 * Sanea un posible estado externo.
 *
 * Si algo no es confiable, devuelve un estado inicial en vez de intentar
 * adivinar parcialmente la intención.
 */
export function sanitizeState(candidate) {
  if (!isValidState(candidate)) {
    return createInitialState();
  }

  return cloneState(candidate);
}

/**
 * Lee el estado persistido.
 *
 * Si localStorage está vacío, bloqueado o corrupto, devuelve un estado
 * inicial seguro. Si encuentra datos corruptos intenta eliminarlos.
 */
export function loadState() {
  try {
    const rawState = window.localStorage.getItem(STATE_STORAGE_KEY);

    if (!rawState) {
      return createInitialState();
    }

    const parsedState = JSON.parse(rawState);

    if (!isValidState(parsedState)) {
      try {
        window.localStorage.removeItem(STATE_STORAGE_KEY);
      } catch {
        // No hay nada adicional que hacer si localStorage no permite escribir.
      }

      return createInitialState();
    }

    return cloneState(parsedState);
  } catch (error) {
    console.error("No se pudo leer el estado del bingo:", error);
    return createInitialState();
  }
}

/**
 * Crea un nuevo estado después de anunciar un número.
 */
export function addNumberToState(currentState, value) {
  const state = sanitizeState(currentState);
  const number = normalizeBingoNumber(value);

  if (number === null) {
    throw new BingoStateError(
      "INVALID_NUMBER",
      "Ingresa un número entero entre 1 y 75."
    );
  }

  if (state.drawnNumbers.includes(number)) {
    throw new BingoStateError(
      "DUPLICATE_NUMBER",
      `El número ${formatBingoNumber(number)} ya fue anunciado.`
    );
  }

  return createNextState([
    ...state.drawnNumbers,
    number
  ], state.revision);
}

/**
 * Quita cualquier número previamente anunciado.
 *
 * El historial mantiene el orden restante y lastNumber pasa a ser el
 * último número que siga en la lista.
 */
export function removeNumberFromState(currentState, value) {
  const state = sanitizeState(currentState);
  const number = normalizeBingoNumber(value);

  if (number === null) {
    throw new BingoStateError(
      "INVALID_NUMBER",
      "El número que intentas quitar no es válido."
    );
  }

  if (!state.drawnNumbers.includes(number)) {
    throw new BingoStateError(
      "NUMBER_NOT_DRAWN",
      `El número ${formatBingoNumber(number)} no está en el historial.`
    );
  }

  const updatedNumbers = state.drawnNumbers.filter(
    drawnNumber => drawnNumber !== number
  );

  return createNextState(updatedNumbers, state.revision);
}

/**
 * Deshace el último número anunciado.
 */
export function undoLastNumberInState(currentState) {
  const state = sanitizeState(currentState);

  if (state.drawnNumbers.length === 0) {
    throw new BingoStateError(
      "EMPTY_HISTORY",
      "Todavía no hay números para deshacer."
    );
  }

  return createNextState(
    state.drawnNumbers.slice(0, -1),
    state.revision
  );
}

/**
 * Reinicia el bingo aumentando la revisión para que todas las ventanas
 * reconozcan el cambio como más reciente.
 */
export function resetState(currentState) {
  const state = sanitizeState(currentState);

  return {
    drawnNumbers: [],
    lastNumber: null,
    updatedAt: new Date().toISOString(),
    revision: state.revision + 1
  };
}

/**
 * Obtiene los números que todavía no han salido.
 */
export function getAvailableNumbers(state) {
  const safeState = sanitizeState(state);
  const drawnSet = new Set(safeState.drawnNumbers);
  const available = [];

  for (let number = BINGO_MIN; number <= BINGO_MAX; number += 1) {
    if (!drawnSet.has(number)) {
      available.push(number);
    }
  }

  return available;
}

/**
 * Escoge uniformemente uno de los números aún disponibles.
 */
export function getRandomAvailableNumber(state) {
  const availableNumbers = getAvailableNumbers(state);

  if (availableNumbers.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(
    Math.random() * availableNumbers.length
  );

  return availableNumbers[randomIndex];
}

/**
 * Devuelve B, I, N, G u O para un número.
 */
export function getLetterForNumber(number) {
  if (!isValidBingoNumber(number)) {
    return "";
  }

  const column = COLUMN_CONFIG.find(
    item => number >= item.min && number <= item.max
  );

  return column?.letter ?? "";
}

/**
 * Devuelve por ejemplo "G 52".
 */
export function formatBingoNumber(number) {
  if (!isValidBingoNumber(number)) {
    return "—";
  }

  return `${getLetterForNumber(number)} ${number}`;
}

/**
 * Configuración inmutable de las columnas.
 */
export function getColumnConfig() {
  return COLUMN_CONFIG.map(column => ({ ...column }));
}

/**
 * Guarda el estado en localStorage.
 *
 * Esta función NO transmite por BroadcastChannel. La responsabilidad
 * de almacenar + transmitir se encapsula en createStateSync().
 */
export function persistState(state) {
  const safeState = sanitizeState(state);

  if (!isValidState(safeState)) {
    throw new BingoStateError(
      "INVALID_STATE",
      "No se pudo guardar un estado inválido."
    );
  }

  try {
    window.localStorage.setItem(
      STATE_STORAGE_KEY,
      JSON.stringify(safeState)
    );
  } catch (error) {
    console.error("No se pudo guardar el estado del bingo:", error);

    throw new BingoStateError(
      "STORAGE_ERROR",
      "No fue posible guardar el bingo en este navegador."
    );
  }

  return cloneState(safeState);
}

/**
 * Administrador de sincronización entre ventanas.
 *
 * Evita ciclos:
 * - Solo recibe estados con revision superior a currentRevision.
 * - Recibir un estado NO vuelve a guardarlo.
 * - BroadcastChannel y storage pueden entregar el mismo cambio, pero
 *   únicamente el primero con revisión nueva se procesa.
 */
export function createStateSync({
  onState,
  onError = () => {}
} = {}) {
  let currentRevision = -1;
  let channel = null;
  let destroyed = false;

  const emitState = (candidate, source) => {
    if (destroyed || !isValidState(candidate)) {
      return false;
    }

    if (candidate.revision <= currentRevision) {
      return false;
    }

    currentRevision = candidate.revision;

    if (typeof onState === "function") {
      onState(cloneState(candidate), source);
    }

    return true;
  };

  try {
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);

      channel.addEventListener("message", event => {
        const message = event.data;

        if (
          !message ||
          typeof message !== "object" ||
          message.type !== "STATE_UPDATE"
        ) {
          return;
        }

        emitState(message.state, "broadcast");
      });
    }
  } catch (error) {
    console.warn("BroadcastChannel no está disponible:", error);
    channel = null;
  }

  const handleStorage = event => {
    if (event.key !== STATE_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      const candidate = JSON.parse(event.newValue);
      emitState(candidate, "storage");
    } catch (error) {
      console.warn(
        "Se ignoró un cambio de almacenamiento corrupto:",
        error
      );
    }
  };

  window.addEventListener("storage", handleStorage);

  return {
    /**
     * Registra la revisión inicialmente renderizada.
     */
    setCurrentRevision(revision) {
      if (
        Number.isInteger(revision) &&
        revision >= 0
      ) {
        currentRevision = Math.max(currentRevision, revision);
      }
    },

    /**
     * Persiste y transmite el estado completo.
     */
    publish(state) {
      const safeState = persistState(state);

      currentRevision = Math.max(
        currentRevision,
        safeState.revision
      );

      try {
        channel?.postMessage({
          type: "STATE_UPDATE",
          state: safeState
        });
      } catch (error) {
        console.warn(
          "No se pudo transmitir por BroadcastChannel:",
          error
        );

        if (typeof onError === "function") {
          onError(error);
        }
      }

      return safeState;
    },

    /**
     * Mensajes auxiliares que no cambian el estado.
     */
    postMessage(message) {
      if (!message || typeof message !== "object") {
        return;
      }

      try {
        channel?.postMessage(message);
      } catch (error) {
        console.warn("No se pudo enviar el mensaje:", error);
      }
    },

    destroy() {
      destroyed = true;
      window.removeEventListener("storage", handleStorage);

      try {
        channel?.close();
      } catch {
        // Ignorar cierre fallido.
      }

      channel = null;
    }
  };
}

/**
 * Escribe el heartbeat de presencia de la pantalla.
 */
export function updatePresentationPresence() {
  const presence = {
    active: true,
    timestamp: Date.now()
  };

  try {
    window.localStorage.setItem(
      PRESENCE_STORAGE_KEY,
      JSON.stringify(presence)
    );
  } catch (error) {
    console.warn(
      "No se pudo actualizar la presencia de la presentación:",
      error
    );
  }

  return presence;
}

/**
 * Borra el heartbeat cuando la ventana de presentación se cierra.
 */
export function clearPresentationPresence() {
  try {
    window.localStorage.removeItem(PRESENCE_STORAGE_KEY);
  } catch {
    // No es un error crítico.
  }
}

/**
 * Determina si la presentación ha enviado un heartbeat recientemente.
 */
export function isPresentationPresent() {
  try {
    const rawPresence = window.localStorage.getItem(
      PRESENCE_STORAGE_KEY
    );

    if (!rawPresence) {
      return false;
    }

    const presence = JSON.parse(rawPresence);

    if (
      !presence ||
      presence.active !== true ||
      !Number.isFinite(presence.timestamp)
    ) {
      return false;
    }

    return Date.now() - presence.timestamp <= PRESENCE_TIMEOUT_MS;
  } catch {
    return false;
  }
}

/**
 * Observa específicamente cambios del heartbeat.
 */
export function subscribeToPresentationPresence(callback) {
  const handler = event => {
    if (event.key === PRESENCE_STORAGE_KEY) {
      callback?.(isPresentationPresent());
    }
  };

  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener("storage", handler);
  };
}

/**
 * Error de dominio con código identificable por la interfaz.
 */
export class BingoStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BingoStateError";
    this.code = code;
  }
}

/**
 * Construye la siguiente versión válida del estado.
 */
function createNextState(drawnNumbers, previousRevision) {
  const lastNumber =
    drawnNumbers.length > 0
      ? drawnNumbers[drawnNumbers.length - 1]
      : null;

  return {
    drawnNumbers: [...drawnNumbers],
    lastNumber,
    updatedAt: new Date().toISOString(),
    revision: previousRevision + 1
  };
}
