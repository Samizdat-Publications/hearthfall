// BACKLOG 46: host-only switches ahead of network play (BACKLOG 15). Today every session is the host;
// a lockstep peer would set role "peer" so its page never exposes the window.__game debug hook (whose
// command() issues god-mode tribe -1 commands), and the host filters peer commands with the sim's
// peerCommandRefusal.

export type SessionRole = "host" | "peer";

/** The debug hook: always in test builds (the harness drives them), with ?debug=1 only on the host. */
export function debugApiAllowed(testBuild: boolean, debugParam: boolean, role: SessionRole): boolean {
  if (role !== "host") return false;
  return testBuild || debugParam;
}
