# Populous kickoff: tech stack options for an autonomous 24h+ Claude Code build

Research date: Oct 8, 2026. Target: Windows 11 PC, RTX-class GPU, Claude Code building a Populous: The Beginning style god game (deformable heightmap terrain on a wrapping/curved world, 500 to 2000 autonomous units, terrain spells, rotating camera) with almost no human help, then expanded for weeks.

Evidence tags used throughout:

- [V] verified by running it in this research sandbox (Linux, 2 vCPU, no GPU; Godot 4.7.2 official build with checksum verified against the published SHA512 sums; Node 22.22.0; Playwright 1.64.0 with its bundled Chromium 156; Vitest 5.0.3; TypeScript 7.0.2).
- [S] taken from a source listed at the bottom (paraphrased).
- [U] unverified or inference. Anything about Windows plus a real RTX GPU is [U] because the sandbox has no GPU and no Windows. Section 7 lists the checks the build agent should run first on the real machine.

Limits of this research: GitHub's REST API and search pages were blocked in this session, so 2025 to 2026 issue-tracker gotchas were gathered from forum posts, release notes, source files fetched from raw.githubusercontent.com, and direct tests, not from issue searches. Claims about how well LLMs write GDScript come mostly from two vendor blogs (both sell Godot AI products) and have no reproducible benchmark behind them. Treat criterion (c) accordingly.

---

## 0. Verdict

Recommended: **Option C built on Option B.** A pure TypeScript deterministic simulation core (no DOM, no Three.js imports), a thin Three.js renderer on top, a Node CLI harness for tests, replays, bots and screenshots, and Electron later for the exe. Use **WebGLRenderer (WebGL2) for v1**, keep the renderer behind an interface, and treat WebGPU as an optional later upgrade.

Runner-up: **Godot 4.7.2 with strictly typed GDScript** and the sim written as engine-free `RefCounted` classes. It is a solid choice if graphics fidelity and the editor workflow matter more to you than agent autonomy. Its main weakness for this brief: `--headless` cannot render at all, so every screenshot needs a real window.

Why: criterion (a) is the first and heaviest. The web stack gives the agent a faster simulation (about 6.5x in a micro-benchmark), headless screenshots with no window popping up on your desktop (verified with WebGL), and native tooling for JSON state, WebSocket bots and JUnit. It also scores best on (c). Godot wins (d) and (e) only modestly for a stylized low-poly game with 2000 units.

### Exact versions found (as of Oct 8, 2026)

| Component | Version | Date / note |
|---|---|---|
| Godot stable | **4.7.2-stable** | Aug 18, 2026. Build string verified by running it: 4.7.2.stable.official.ed1daf0bf. Binary SHA512 matched the published sums [V]. |
| Godot previous stable lines | 4.7.1 (Jul 14), 4.7 (Jun 18), 4.6.3 (May 20), 4.6.2 (Apr 1), 3.6.3 (Aug 22) | [S] archive page and releases page |
| Godot next | 4.8-dev7 snapshot | Sep 29, 2026, no beta or RC listed yet [S] |
| GUT (Godot unit test) | **9.7.1** (godot_4_7 branch, for 4.7.x); 9.6.1 for 4.6.x | [S] README; ran 9.7.1 on 4.7.2 [V] |
| gdUnit4 | **v6.2.2** (Oct 7, 2026) | README lists Godot 4.5 through 4.7.1 plus 4.8.dev7 [S]; repo now lives under the godot-gdunit-labs org. I did not run it. |
| godot-rust crate | godot 0.5.5 | Aug 9, 2026 (crates.io API) [S]; not checked against 4.7 |
| three.js | **r186, npm 0.186.1** | Sep 24, 2026 (0.186.0 on Sep 8). @types/three 0.186.0 |
| Babylon.js | **9.30.0** | published Oct 8, 2026 (npm) |
| Vite | **8.3.4** | Oct 8, 2026; needs Node ^20.19 or >=22.12 |
| Vitest | **5.0.3** | Sep 30, 2026; needs Node ^22.12, ^24 or >=26 |
| TypeScript | **7.0.2** | npm latest; installed here and `tsc --version` reported 7.0.2 [V]. I did not run a full type check. |
| Playwright | **1.64.0** | Oct 7, 2026; installing it pulled Chrome for Testing **156.0.8078.4** (Playwright "chromium v1248") [V] |
| @playwright/mcp | 0.0.83 | Sep 28, 2026 |
| Electron | **44.7.0** | Oct 7, 2026. Electron 44.0 (Aug 25, 2026) bundled Chromium 152.0.7977.54, Node 24.18.1, V8 15.2 [S] |
| Tauri CLI / API | 2.12.1 | npm |
| Support libs (npm latest) | ws 8.22.0, bitecs 0.4.0, miniplex 2.0.0, @dimforge/rapier3d-compat 0.21.0, three-mesh-bvh 0.9.16, @gltf-transform/core 4.5.1, pixelmatch 8.0.0, pngjs 7.0.0 | |
| Sandbox Node | 22.22.0 ran `.ts` files directly with no flags and no build step | [V] |

WebGPU status [S]: caniuse shows about 87.8% global usage (85.8% full plus 2.02% partial). Chrome and Edge 113+, Safari 26, Firefox 141 on Windows per a Nov 2025 web.dev post (the caniuse page text I got back listed Firefox as not enabled by default, so treat Firefox as uncertain). Linux Chromium support was still "in progress" in that post.

---

## 1. What was measured in the sandbox

| Test | Result |
|---|---|
| Godot `--headless` with a Node-based scene: `_process` | Runs normally (30 frames counted) [V] |
| Godot `--headless`: `get_viewport().get_texture().get_image()` | Returns null and prints an engine error from the dummy renderer's texture storage [V] |
| Godot `--headless`: `await RenderingServer.frame_post_draw` | Never completes; the process hangs until killed [V] |
| Godot source (master): headless display server | Advertises only the "dummy" rendering driver; dummy `render_target_create()` returns an empty RID [S, source files read directly] |
| Godot with Xvfb + Mesa llvmpipe, `--rendering-driver opengl3 --rendering-method gl_compatibility` | Real screenshot saved via `Image.save_png`, correct 640x360, non-black [V] |
| Godot `--write-movie movie/f.png --fixed-fps 30 --quit-after 20` | 20 PNG frames plus a WAV, exits cleanly [V] |
| GDScript sim, 2000 units x 5000 ticks, seeded RNG, wrapped random walk | 1.72 to 1.79 s per run, identical output across runs for the same seed [V] |
| TypeScript sim, same logic, Float32Array SoA, Node 22 | 0.27 s (about 6.5x faster). Both are trivial behaviors on a 2 vCPU VM, so only the ratio is meaningful. [V] |
| `godot --check-only --script` on a type error | Exit 1, line-numbered parse error [V] |
| Same on Godot 3 syntax (`export var`, `yield`) | Exit 1, error explicitly says the keyword was removed in Godot 4 and to use `@export` [V] |
| Runtime script error in a `SceneTree` script (`_initialize`) | Error printed, process did NOT exit; hung until the `timeout` killed it. With `--quit-after 5` it exited 0 despite the error [V] |
| Same runtime error inside code under test run by GUT | GUT counted it as a failing test, exit code 1 [V] |
| New `class_name` script used before re-import | Parse error "Identifier not declared"; fixed by one `--headless --import` [V] |
| project.godot warnings set to level 2 (error) for untyped declarations and unsafe access | `--check-only` fails with "Warning treated as error" on untyped code [V] |
| `Array.duplicate()` in a typed `for` loop | Type inference fails ("Cannot infer the type") until the loop variable is typed explicitly [V] |
| GUT 9.7.1 on 4.7.2, headless | Runs, exit 1 on any failure, JUnit XML written with per-test status [V] |
| Godot TCPServer HTTP/JSON debug endpoint (about 30 lines) | `GET /state`, `POST /step?n=1000`, `POST /quit` all worked from curl [V] |
| Vitest 5.0.3 + TypeScript 7.0.2 deterministic replay test + JUnit | 4 tests pass in about 1 s, JUnit XML written [V] |
| Node `ws` server running the sim headless plus a bot client | Step, raise-terrain and snapshot commands round-tripped as JSON [V] |
| Playwright 1.64 + Chromium 156 (both new headless and headless shell), Three.js WebGLRenderer, 2000 InstancedMesh + 64x64 terrain | Page screenshot correct (not black), in-page `canvas.toDataURL` correct, `window.__game.getState()` returned JSON [V] |
| Same, `WebGPURenderer` with `forceWebGL` | Correct screenshot [V] |
| Same, `WebGPURenderer` on the real WebGPU backend (SwiftShader Vulkan) | Frames render (backend reported "webgpu", about 93 frames in 1.5 s) but `page.screenshot` and `canvas.toDataURL` came back blank, and a render-target readback failed with a Dawn "instance dropped" AbortError [V] |
| Three r186 `WebGPURenderer` on an older Chromium (the build preinstalled in the sandbox, Playwright chromium revision 1194) | Throws a TypeError about a `swizzle` property in `GPUTextureViewDescriptor`; works on Chromium 156 [V] |

---

## 2. Scorecard

| Criterion | A) Godot 4.7.2 | B) TypeScript + Three.js r186 | C) Engine-agnostic TS core + thin renderer |
|---|---|---|---|
| (a) Agent self-testing | Headless sim and unit tests excellent. No pixels in `--headless`; screenshots need a real window (a window flashes on his desktop) or Xvfb on Linux. Runtime script errors do not fail the process. | Sim in plain Node, Vitest JUnit, WS/JSON bots, Playwright headless screenshots with no window (WebGL verified). WebGPU capture unreliable headless. | Same as B, with the sim fully testable and replayable without any renderer at all. Best fit. |
| (b) Extensibility, data-driven, modding | Resources (`.tres`), JSON, PCK mod loading, signals. Scene files are merge-noisy. | ES modules, JSON rules, strict types as a safety net, Vite HMR. | Strongest: rules and sim are renderer-independent, mods target a stable sim API. |
| (c) LLM correctness | GDScript drifts to Godot 3 habits [S, vendor blogs]; `--check-only` catches it with good messages [V]. `.tscn` hand edits are risky. | TS and Three.js core are heavily represented. WebGPURenderer/TSL churns every release, so model knowledge is stale there. | As B, and the sim code is plain TS, the easiest target for an LLM. |
| (d) Graphics ceiling and 500 to 2000 units | Highest: Forward+ PBR, D3D12 or Vulkan, AreaLight3D in 4.7, MultiMesh handles thousands trivially [S]. Sim in GDScript about 6.5x slower than TS in my test. | WebGL2/WebGPU is plenty for stylized low poly. InstancedMesh for 2000 units is routine. Single-threaded JS, so plan for a Worker later. | Same as B. |
| (e) Asset import | glTF 2.0 recommended, direct .blend, FBX via ufbx, WAV/Ogg/MP3 [S]. Smoothest. | GLTFLoader (+ Draco/meshopt/KTX2), Web Audio. Small amount of glue code. | Same as B. |
| Desktop exe | Single command export (needs templates). | Electron 44.7.0 (pins Chromium 152, so what you test is what ships). | Same as B. |

---

## 3. Option A: Godot 4.7.2

### 3.1 Facts that matter

- Headless: `--headless` is shorthand for `--display-driver headless --audio-driver Dummy` [S]. It is the documented way to run servers and CI. Game logic, `_process`, `_physics_process`, `SceneTree` scripts, JSON, files, TCP all work [V]. Rendering does not: the dummy rasterizer has no render targets and no texture readback [V, S].
- Rendering for screenshots needs a real display server. On Windows with an RTX that means a real window; on Linux CI it means Xvfb plus Mesa [V]. `--rendering-driver`, `--rendering-method`, `--resolution WxH`, `--position X,Y`, `--windowed`, `--fixed-fps N` are all documented flags [S]. Godot 4.6 made D3D12 the default driver for new Windows projects [S]; omit the driver flag and the project default applies.
- `--write-movie out.png --fixed-fps 30 --quit-after N` renders N frames deterministically (fixed timestep decouples from wall clock) and writes a PNG per frame plus a WAV [V, S]. Relative output paths resolve against the project folder, not the current directory [S]. It is also available in exported builds [S].
- `--fixed-fps` disables real-time sync [S]. Combined with `--headless` this should fast-forward a scene tree simulation, but I only verified the `--script` runner, which is simpler and faster for pure sim [U for the combination].
- Windows ships a console wrapper, `Godot_v4.7.2-stable_win64_console.exe`, next to the GUI exe in the official zip (verified by listing the zip, 198 KB) [V]. Use the console one so stdout and stderr pipe back to the agent [U on exact pipe behavior of the GUI exe].
- Exports: `godot --headless --path . --export-release "<preset>" <out>`; `--export-debug` and `--export-pack` also exist; export templates must be installed and a preset must exist in `export_presets.cfg` [S]. Docs say `--headless` is required for export on machines without GPU access.
- Jolt became the default 3D physics engine for new projects in 4.6 and node IDs are now saved in scene files (re-save via Project > Tools > Upgrade Project Files) [S, 4.6 release page]. I would not use engine physics for sim logic.
- 4.7 headline features are mostly rendering and editor (HDR output, AreaLight3D, new Asset Store, dedicated MeshLibrary editor) [S]. Nothing in the 4.7 notes changes headless, testing or CLI behavior; the page has no known-issues section.

### 3.2 GUT vs gdUnit4

| | GUT 9.7.1 | gdUnit4 v6.2.2 |
|---|---|---|
| Godot match | Branch per Godot minor: 9.7.1 for 4.7.x, 9.6.1 for 4.6.x | One line covers 4.5 to 4.7.1 (+4.8.dev7) |
| Language | GDScript only | GDScript and C# (via gdUnit4Net) |
| CLI | `godot --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://test -gexit` [V] | `addons/gdUnit4/runtest.cmd` (Windows) or `runtest.sh`, needs `GODOT_BIN` env var, wraps `GdUnitCmdTool.gd` [S] |
| Exit codes | 0 pass, 1 fail [V] | 0 pass, 100 failures, 101 warnings [S] |
| JUnit | `-gjunit_xml_file=path` [V] | `results.xml` in the report dir (default `res://reports/`), plus HTML report [S] |
| Extras | Doubles, stubs, spies, parameterized tests, inner classes | Scene runner (input simulation), fuzzing, flaky-test retry, orphan node detection, mocking [S] |
| Gotcha | Must set `-gdir`; without it exits 1 with a config error [V] | I did not test headless behavior; its CLI docs page does not discuss it [S] |

My pick for an autonomous agent: **GUT 9.7.1**, because I ran it end to end and its CLI and exit codes are simple. Reconsider gdUnit4 if you want the scene runner for input-driven tests.

### 3.3 GDScript vs C# for an agent

| | Strict typed GDScript | C# (.NET build of Godot) |
|---|---|---|
| Static checking | Set warnings to error level in `project.godot` (untyped declarations, unsafe member/call access) and `--check-only` fails the run [V]. | Compiler errors from `dotnet build`; best-in-class diagnostics. |
| Error messages | Line numbers; Godot 3 syntax gets an explicit "removed in Godot 4" message [V]. | Standard .NET messages. |
| LSP | Editor-hosted language server (the editor must be running) [U on headless use]. | Roslyn/OmniSharp-class tooling. |
| Speed | About 6.5x slower than V8 in my trivial benchmark [V]. | Near native .NET speed [U]. |
| Test tooling | GUT or gdUnit4 | gdUnit4Net, or plain `dotnet test` for engine-free libraries |
| Platform limits | None for desktop. | Docs: C# Godot 4 projects cannot export to web; Android/iOS experimental; hot reload does not preserve state except exported vars; Godot 4.8 will require .NET 10 [S]. Needs the .NET SDK installed separately. |
| API pitfalls | `Array.duplicate()` loses element type, breaking inference [V]. | String-based `Call`/`Connect` need snake_case engine names, so PascalCase C# names silently fail [S]. |

### 3.4 Godot MCP and AI tooling (all third party)

| Project | What it offers | Notes |
|---|---|---|
| satelliteoflove/godot-mcp | 21 tools / 86 actions: scene and node read/edit, `screenshot_game`, error log, run/stop, input injection, live game state as JSON, freeze/step the game clock, run GDScript in the running game | Editor plugin talking over local WebSocket and Godot's debugger protocol, so the editor must be running; Godot 4.5+; 165 stars at fetch time [S] |
| Coding-Solo/godot-mcp | launch editor, run project, capture debug output, stop, scene creation, UID helpers | 5.6k stars; no screenshot or headless mention [S] |
| keeveeg/godot-mcp | Claims 300+ tools including screenshots, runtime state, input record/replay | 30 stars, tested with 4.7 per its README [S] |

None are first party. For a 24h unattended run I would write a 100 line project-owned harness instead (section 3.5), then optionally add an MCP later.

### 3.5 Concrete commands (Windows PowerShell, Godot 4.7.2)

Placeholder project path below is under `C:\Users\stewa\Documents\Claude\` (the live location per your folder notes); change it if the project lives elsewhere. Never write under `OneDrive\Documents`.

```powershell
cd C:\Users\stewa\Documents\Claude\Populous
$GODOT = "C:\Tools\Godot\Godot_v4.7.2-stable_win64_console.exe"

# one-time, and again after adding any new class_name script or imported asset
& $GODOT --headless --path . --import

# parse/type check one script (exit 1 on error)
& $GODOT --headless --path . --check-only --script res://tools/run_sim.gd

# unit tests with JUnit output (exit 1 on failure)
& $GODOT --headless --path . -s addons/gut/gut_cmdln.gd -gdir=res://test -gexit -gjunit_xml_file=build/junit.xml

# deterministic headless sim run, prints one JSON line
& $GODOT --headless --path . --script res://tools/run_sim.gd -- --seed=42 --ticks=100000

# screenshot: needs a real window, so NOT --headless. Scene saves a PNG then quits.
& $GODOT --path . --resolution 1280x720 res://tools/shot_scene.tscn -- --out=build/shot.png

# frame sequence at fixed timestep, then exits after 120 frames
& $GODOT --path . --write-movie build/frames/f.png --fixed-fps 30 --quit-after 120 res://main.tscn

# desktop export (needs export templates installed and an export preset named "Windows Desktop")
& $GODOT --headless --path . --export-release "Windows Desktop" build/populous.exe
```

Linux CI equivalent for the screenshot [V]:

```bash
cd /home/user/populous
SHOT_PATH=build/shot.png xvfb-run -a -s "-screen 0 1280x720x24" ./godot --path . --rendering-driver opengl3 --rendering-method gl_compatibility res://main.tscn
```

GDScript capture pattern [V under llvmpipe]. Guard against headless first, because the await never returns there:

```gdscript
if DisplayServer.get_name() == "headless":
    push_error("screenshots need a real display server")
    get_tree().quit(2)
    return
await RenderingServer.frame_post_draw
var img: Image = get_viewport().get_texture().get_image()
img.save_png(OS.get_environment("SHOT_PATH"))
get_tree().quit()
```

State endpoint for an external bot (no HTTPServer class ships with Godot; TCPServer is enough) [V]:

```gdscript
extends SceneTree
# GET /state -> JSON, POST /step?n=1000 advances sim, POST /quit
var server := TCPServer.new()
var clients: Array[StreamPeerTCP] = []
var world: World
var quit_after_reply := false
func _initialize() -> void:
    world = World.new(42)
    print("listen err=", server.listen(7777, "127.0.0.1"))
func _process(_delta: float) -> bool:
    if server.is_connection_available():
        clients.append(server.take_connection())
    for c: StreamPeerTCP in clients.duplicate():   # typed loop var is required
        c.poll()
        if c.get_status() != StreamPeerTCP.STATUS_CONNECTED:
            clients.erase(c); continue
        var n := c.get_available_bytes()
        if n > 0:
            var line := c.get_utf8_string(n).split("\r\n")[0]
            var body := {"error": "not found"}
            if line.begins_with("GET /state"): body = world.snapshot()
            elif line.begins_with("POST /step"):
                var steps := int(line.split("n=")[1].split(" ")[0]) if "n=" in line else 1
                for i in steps: world.step()
                body = world.snapshot()
            elif line.begins_with("POST /quit"):
                body = {"ok": true}; quit_after_reply = true
            var payload := JSON.stringify(body)
            c.put_data(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s" % [payload.to_utf8_buffer().size(), payload]).to_utf8_buffer())
            c.disconnect_from_host(); clients.erase(c)
            if quit_after_reply: quit(0)
    return false
```

### 3.6 Known gotchas for agents (Godot)

1. `--headless` means the dummy renderer. No screenshots, no viewport readback, and `frame_post_draw` never fires [V, S]. A forum thread I found (undated in my fetch, evidently from an early Godot 4 release) reports exactly this and offers no workaround; current master source agrees, so I do not treat it as a 2025 to 2026 finding.
2. Runtime script errors do not change the exit code and may not end the process [V]. Always wrap in `timeout`, pass `--quit-after`, and have the harness scan stderr for `SCRIPT ERROR` and `ERROR:` lines. GUT does convert such errors into test failures [V].
3. `class_name` registry is a cache. New global classes need `--headless --import` before other scripts can reference them [V].
4. Typed inference traps: `Array.duplicate()` returns an untyped array [V]. Under strict warnings these become hard errors, which is good for catching bugs but means the agent must write explicit types.
5. `.tscn` and `.tres` hand editing: Godot 4.6 started writing node IDs into scenes [S], resources reference each other by `uid://` plus path, and ext_resource ids must be unique. Mitigation: keep scenes tiny (one main scene), build the world in code, keep rules in JSON or `.tres` created via the engine API, never hand-merge scene files [U on exact failure modes beyond the above].
6. Third-party MCP servers need the editor running; they are not suitable for pure headless autonomy [S].
7. GUT versions track Godot minors; gdUnit4 moved to the godot-gdunit-labs org. Pin both in the repo.
8. C# cannot export to web and ties you to the .NET SDK [S]. Desktop exports are supported.
9. Godot's Sphinx documentation pages come back almost empty to simple HTTP fetchers; the agent should read docs from the godot-docs repo `.rst` files instead [V, my own fetches].

---

## 4. Option B: TypeScript + Three.js r186

### 4.1 Facts that matter

- Three.js: r186 is current (npm 0.186.1, Sep 24, 2026). The manual still labels WebGPURenderer as experimental, with automatic WebGL 2 fallback, a separate `three/webgpu` entry, and says WebGLRenderer stays maintained and recommended for pure WebGL 2 apps [S]. WebGPURenderer does not support `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, or `EffectComposer`; custom shaders must be rewritten as TSL node materials [S]. This matters for a curved-world vertex bend: with WebGLRenderer you can use `onBeforeCompile` (the style LLMs know best); with WebGPURenderer you need `positionNode` in TSL.
- API churn is high on the WebGPU side. From the migration guide [S]: r183 renamed `PostProcessing` to `RenderPipeline` and deprecated `Clock`; r185 changed premultiplied alpha handling, removed `TiledLighting`, renamed several TSL helpers; r186 removed `PCFSoftShadowMap`, made `Renderer.dispose()` async, and deprecated the CommonJS build. `renderAsync()` has been deprecated since r181: use `await renderer.init()` then `render()` (I saw this warning in r186 [V]).
- Chromium baseline: three r186's WebGPU backend failed on an older Chromium (swizzle descriptor TypeError) and worked on Chromium 156 [V]. Pin the browser with Playwright's lockfile.
- Playwright 1.64.0: ships Chromium as Chrome for Testing 156.0.8078.4 and a separate headless shell used by default for headless runs; the new headless mode is available via `channel: 'chromium'` [S, V]. Both worked in my WebGL and WebGPU-frame tests.
- WebGPU headless screenshots: third-party guidance says Linux headless WebGPU captures come out black (agent-browser.dev and the Vercel labs guide). Only agent-browser.dev makes the Windows claim: hardware D3D renders headless but WebGPU canvas screenshots still come out black unless run headed. A three.js forum post from May 15, 2025 reports a blank canvas with Puppeteer too (no answer given). My own Linux SwiftShader test reproduced blank captures and a failed readback [V]. For Windows plus RTX this is [U]: test it (section 7) before relying on WebGPU in automated screenshots.
- Vitest 5.0.3 browser mode supports `toMatchScreenshot()` with the Playwright provider, pixelmatch comparison, reference images in `__screenshots__`, and its docs warn rendering is not deterministic across GPU, driver, OS and headless/headed differences, advising references be generated in one controlled environment [S].
- Vite 8.3.4 and TypeScript 7.0.2 (installed; I only ran `tsc --version`, so the `tsc --noEmit` command below is unverified and I did not benchmark type-check speed). Node 22.12+ is required by Vitest 5.
- Babylon.js 9.30.0 is an alternative with a long-standing `NullEngine` for headless Node scenes (I could not re-verify its v9 docs page in this session [U]). Since the sim core is engine-free anyway, I would not pick Babylon for this project; Three.js is lighter and better represented in LLM training data.
- Desktop: Electron 44.7.0 bundles its own Chromium (152 in 44.0), so WebGL/WebGPU behavior on his PC equals what you tested; ANGLE is statically linked in Electron 44 [S]. Tauri 2.12.1 uses the system WebView2 on Windows and needs the Rust toolchain; WebGPU availability inside WebView2 was not confirmed in my searches [U]. Recommendation: Electron.
- Assets: GLB from Meshy/Tripo/Blender loads with `GLTFLoader` (Draco, meshopt, KTX2 decoders available); audio through Web Audio. Both are routine [S for loaders existing; the integration glue is [U]].

### 4.2 Concrete commands (Windows PowerShell)

```powershell
cd C:\Users\stewa\Documents\Claude\Populous

# setup (pin exact versions in package.json, commit the lockfile)
npm install three@0.186.1 vite@8.3.4 vitest@5.0.3 typescript@7.0.2 playwright@1.64.0 ws@8.22.0
npx playwright install chromium

# static check, unit tests with JUnit (verified flags), 4 sample tests ran in about 1 s
npx tsc --noEmit
npx vitest run --reporter=default --reporter=junit --outputFile.junit=build/junit.xml

# deterministic headless replay in plain Node, TS runs directly on Node 22.22 with no build step
node tools/replay.ts --seed 42 --ticks 100000 --out build/state.json

# headless sim server for bots: JSON over WebSocket on ws://127.0.0.1:7778
node tools/sim_server.ts

# dev server for the renderer, then a screenshot from the running game
npx vite --port 5173
node tools/shot.mjs --url "http://localhost:5173/?seed=42&cam=overview" --out build/shot.png
```

Screenshot plus state tool (the pattern I ran, WebGL path) [V]:

```js
// tools/shot.mjs (core)
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });          // no window on the desktop
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForFunction(() => window.__ready);                    // game sets this after first frame
const state = await page.evaluate(() => window.__game.getState());   // JSON, no screenshot needed
console.log(JSON.stringify(state));
await page.screenshot({ path: out });                                // only when asked
await browser.close();
```

In-page API the game exposes (the same `Command` type is used by UI, bots and replays) [V for getState and screenshot, rest is design]:

```ts
window.__game = {
  getState: () => ({ tick, units: unitCount, camera: cam.position.toArray(), hash: sim.hash() }),
  send: (cmd: Command) => sim.enqueue(cmd),
  step: (n: number) => { for (let i = 0; i < n; i++) sim.step(); },
  screenshot: () => { renderer.render(scene, cam); return renderer.domElement.toDataURL('image/png'); },
};
```

Headless sim WebSocket server and a bot client [V]:

```ts
// tools/sim_server.ts
import { WebSocketServer } from 'ws';
import { createWorld, step, raise, snapshot } from '../packages/sim/src/index.ts';
const world = createWorld(42);
new WebSocketServer({ port: 7778, host: '127.0.0.1' }).on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.cmd === 'step') for (let i = 0; i < (msg.n ?? 1); i++) step(world);
    if (msg.cmd === 'raise') raise(world, msg.x, msg.z, msg.r ?? 4, msg.amt ?? 1);
    ws.send(JSON.stringify(snapshot(world)));
  });
});
```

For WebGPU runs on the real machine, add flags and expect to need headed mode for capture [U on Windows]:

```js
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
```

### 4.3 Known gotchas (web)

1. WebGPU canvases can screenshot blank in headless Chromium, and GPU readback can fail [V on Linux SwiftShader, S for Windows]. Verified workaround: run the same renderer with `forceWebGL` (WebGPURenderer) or just use WebGLRenderer for QA capture [V]. Also add a "non-blank" assertion (pixel standard deviation above a small threshold), because a screenshot call can succeed with a black or white image.
2. Pin Chromium by pinning Playwright; three r186 WebGPU needs a recent Chromium [V].
3. WebGPURenderer API churn every release and no `ShaderMaterial`/`onBeforeCompile` [S]. Do not let an agent "upgrade three" unprompted.
4. Headless shell versus new headless differ in subtle ways (PDFs, screenshots, speed) since Playwright 1.49 [S: issue 33566]. Pick one and keep references from the same one.
5. Screenshot references are not portable across machines [S: Vitest guidance]. Generate them on the same PC and same browser build.
6. WebGPU needs a secure context: `https` or `localhost` [S].
7. Software rendering is slow: about 16 fps at 640x360 for 2000 instances plus terrain on SwiftShader in the sandbox. That is a CPU fallback, not representative of an RTX, but it means screenshot runs should wait for N frames, not for time [V].
8. JavaScript determinism: `Math.random`, `Date.now`, `performance.now`, `Map`/`Set` iteration order assumptions and transcendental functions can break replays. Same-engine (V8 in Node and Chromium and Electron) replays should match, but cross-engine equality is [U].

---

## 5. Option C: engine-agnostic simulation core + thin renderer

This is B with discipline. It is also the version of A that survives an engine switch.

Layout (npm workspaces):

```
packages/sim        pure TS, zero DOM/Three imports, fixed tick (e.g. 20 Hz), seeded PRNG, SoA typed arrays
packages/rules      data: spells, units, terrain rules as JSON or TS objects validated at load
packages/renderer   Three.js: terrain mesh/shader from sim heightmap, InstancedMesh for units, camera rig
apps/game           Vite entry, input -> Command queue
tools/              replay.ts, sim_server.ts, bot.ts, shot.mjs, doctor.mjs
test/               vitest unit + golden replays; playwright visual and e2e
```

Rules that make it work for an autonomous agent:

- The sim consumes only a `Command` stream plus a seed. Input recordings, bot scripts and golden replays are all the same file format: a list of `{tick, cmd}`.
- `sim.hash()` over heightmap and unit arrays every N ticks; golden replay tests assert the hash sequence. A diverging hash pinpoints the first bad tick.
- The renderer reads sim state (heightmap dirty regions, unit position arrays); it never writes it. This lets the sim move into a Web Worker later without refactoring.
- Terrain wrap: store the heightmap with modulo indexing in the sim (my probe used modulo indexing and a seam test passed [V]); the curved horizon is a render-only vertex bend.
- Lint rule banning `Math.random`, `Date.now`, `performance.now` and DOM globals inside `packages/sim`.

Godot variant of the same idea, if you choose A: put the sim in `RefCounted` classes with no Node references (what my probe did [V]) tested by GUT; or write it as a plain C# class library tested with `dotnet test` and loaded by the Godot C# project. Rendering is then a thin Node3D layer. This keeps tests fast but still cannot capture screenshots headless.

A Godot renderer driven by a Node sim over WebSocket is technically possible but adds latency and two runtimes; not recommended.

---

## 6. Recommended option: risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Headless GPU screenshots are unreliable, especially WebGPU (blank canvases, failed readback); Windows plus RTX behavior is unverified | Use WebGLRenderer for v1 and for all automated captures. Ship a `doctor.mjs` that captures (backend x headless/headed) and asserts pixel variance. Keep WebGPU behind a flag and verify headed only. Primary evidence is the sim state JSON; screenshots are secondary. |
| 2 | Three.js WebGPU/TSL API churn and stale model knowledge; browser baseline differences | Pin three at 0.186.1 and Playwright at 1.64.0 with lockfile; ban unprompted upgrades; read the migration guide before any bump; keep the renderer behind an interface; avoid TSL until needed. |
| 3 | Determinism drift as the codebase grows over weeks | Seeded PRNG, fixed timestep, banned nondeterministic APIs in `packages/sim`, per-N-tick state hashes in golden replays, CI gate on replay equality; run sim in V8 only (Node, Chromium, Electron share it). |
| 4 | Single-threaded JS performance and GC as unit AI, pathfinding and terrain deformation grow | SoA typed arrays, spatial hash, chunked terrain with dirty-region updates, InstancedMesh with only changed matrices, design sim API as snapshot-based so it can move to a Worker; add a Vitest perf budget (baseline: 2000 units x 5000 ticks of trivial behavior took about 0.27 s) and a headless `bench` script. |
| 5 | The agent trusts green unit tests while visuals and gameplay are broken (camera rotation, wrap seam, terrain normals, bots stuck), or a long run gets stuck in a loop | Scripted bot playtests with invariants (units alive, no NaN, tribe goals reachable); fixed-seed fixed-camera screenshot "contact sheets" at milestones; same-machine pixelmatch regression; wrap every external command in a timeout; commit on every green checkpoint; keep a PROGRESS file. Use the OpenAI Decisions API only on milestone screenshots to save quota. |

---

## 7. First things the build agent should run on the real Windows machine

1. `node --version` (need 22.12 or newer; 22.22 ran `.ts` directly here).
2. `npx playwright install chromium`, then run `doctor.mjs`: capture a Three scene in headless with WebGL, assert non-uniform pixels. Then repeat with the real WebGPU backend headless and headed to learn what actually works on the RTX (this is the main unknown).
3. Confirm `getState()` over `page.evaluate` and the Node WebSocket server work with Windows firewall defaults (use 127.0.0.1 only).
4. If Godot is chosen instead: download the official win64 zip, use the `_console.exe`, install export templates for 4.7.2, run `--headless --import`, GUT, and a windowed screenshot.
5. Set up a `build/` and `outputs/` layout and keep everything under `C:\Users\stewa\Documents\Claude\`.

---

## Sources

Godot releases and docs
- https://godotengine.org/download/archive/
- https://github.com/godotengine/godot/releases
- https://github.com/godotengine/godot/releases/download/4.7.2-stable/SHA512-SUMS.txt
- https://godotengine.org/releases/4.7/
- https://godotengine.org/releases/4.6/
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/editor/command_line_tutorial.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/export/exporting_for_dedicated_servers.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/animation/creating_movies.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/scripting/c_sharp/c_sharp_basics.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/performance/using_multimesh.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/rendering/renderers.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/assets_pipeline/importing_3d_scenes/available_formats.rst
- https://raw.githubusercontent.com/godotengine/godot-docs/master/tutorials/assets_pipeline/importing_audio_samples.rst
- https://raw.githubusercontent.com/godotengine/godot/master/servers/display/display_server_headless.h
- https://raw.githubusercontent.com/godotengine/godot/master/servers/rendering/dummy/storage/texture_storage.h
- https://forum.godotengine.org/t/godot-4s-headless-is-not-the-same-as-godot-3s-no-window-it-cant-render-in-the-backend/1394

Godot testing and AI tooling
- https://raw.githubusercontent.com/bitwes/Gut/main/README.md
- https://gut.readthedocs.io/en/latest/Command-Line.html
- https://raw.githubusercontent.com/MikeSchulze/gdUnit4/master/README.md
- https://godot-gdunit-labs.github.io/gdUnit4/latest/advanced_testing/cmd/
- https://github.com/godot-gdunit-labs/gdUnit4/releases
- https://github.com/satelliteoflove/godot-mcp
- https://github.com/Coding-Solo/godot-mcp
- https://github.com/keeveeg/godot-mcp
- https://www.summerengine.com/blog/best-llm-for-godot (vendor blog)
- https://ziva.sh/blogs/generate-gdscript-with-ai (vendor blog)
- https://crates.io/api/v1/crates/godot

Web stack
- https://registry.npmjs.org/three (also /vite, /vitest, /playwright, /typescript, /electron, /@babylonjs/core, /@tauri-apps/cli, /@playwright/mcp, /ws, /bitecs, /pixelmatch, /pngjs)
- https://threejs.org/manual/en/webgpurenderer
- https://github.com/mrdoob/three.js/releases/tag/r186
- https://github.com/mrdoob/three.js/wiki/Migration-Guide
- https://discourse.threejs.org/t/what-is-the-current-state-of-headless-rendering-with-webgpu/82600
- https://agent-browser.dev/webgpu
- https://vgpu.labs.vercel.dev/guides/agent-browser-webgpu
- https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
- https://web.dev/blog/webgpu-supported-major-browsers
- https://caniuse.com/webgpu
- https://github.com/microsoft/playwright/issues/33566
- https://raw.githubusercontent.com/microsoft/playwright/main/docs/src/browsers.md
- https://www.createit.com/?p=3319
- https://vitest.dev/guide/browser/visual-regression-testing
- https://www.electronjs.org/blog/electron-44-0
- https://gamedev.net/news/5369-babylonjs-9230-released/
