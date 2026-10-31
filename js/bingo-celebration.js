
const CHANNEL_NAME = "baby-shower-bingo";
const CELEBRATION_KEY = "eloina-bingo-celebration";
const DURATION_MS = 8500;

const overlay = document.querySelector("#bingo-celebration");
const button = document.querySelector("#celebrate-bingo-button");

let channel = null;
let hideTimer = null;
let lastEventId = "";

try {
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch (error) {
  console.warn("Canal de celebración no disponible:", error);
}

function showCelebration() {
  if (!overlay) return;

  window.clearTimeout(hideTimer);

  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.remove("celebration-active");

  // Restart the animation on every click.
  void overlay.offsetWidth;

  overlay.classList.add("celebration-active");

  hideTimer = window.setTimeout(() => {
    overlay.classList.remove("celebration-active");
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
  }, DURATION_MS);
}

function receiveCelebration(message) {
  if (
    !message ||
    message.type !== "BINGO_CELEBRATION" ||
    typeof message.id !== "string" ||
    message.id === lastEventId
  ) {
    return;
  }

  lastEventId = message.id;
  showCelebration();
}

function triggerCelebration() {
  const message = {
    type: "BINGO_CELEBRATION",
    id: crypto.randomUUID(),
    timestamp: Date.now()
  };

  try {
    localStorage.setItem(
      CELEBRATION_KEY,
      JSON.stringify(message)
    );
  } catch (error) {
    console.warn("No se pudo guardar la celebración:", error);
  }

  try {
    channel?.postMessage(message);
  } catch (error) {
    console.warn("No se pudo transmitir la celebración:", error);
  }

  // Also works when both interfaces are in one document.
  receiveCelebration(message);
}

button?.addEventListener("click", triggerCelebration);

channel?.addEventListener("message", event => {
  receiveCelebration(event.data);
});

window.addEventListener("storage", event => {
  if (
    event.key !== CELEBRATION_KEY ||
    !event.newValue
  ) {
    return;
  }

  try {
    receiveCelebration(JSON.parse(event.newValue));
  } catch {
    console.warn("Mensaje de celebración inválido.");
  }
});

window.addEventListener("pagehide", () => {
  window.clearTimeout(hideTimer);
  channel?.close();
});
