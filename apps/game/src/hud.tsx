// Minimal Preact HUD for the M0 bootstrap scene. The real HUD lives in packages/ui from M4.
import { render } from "preact";
import { signal } from "@preact/signals";

const title = signal("Hearthfall");

function Hud() {
  return (
    <div style={{ position: "absolute", left: "16px", top: "12px", color: "#3a2a22", fontWeight: 700, fontSize: "20px", textShadow: "0 1px 0 #f4f1ea" }} data-hud="title">
      {title} <span style={{ fontWeight: 400, fontSize: "14px" }}>bootstrap</span>
    </div>
  );
}

export function mountHud(el: HTMLElement) {
  render(<Hud />, el);
}
