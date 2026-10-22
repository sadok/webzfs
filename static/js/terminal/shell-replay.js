(function () {
    "use strict";

    const configElement = document.getElementById("shell-replay-config");
    const container = document.getElementById("replay-terminal");
    if (!configElement || !container || typeof Terminal !== "function") {
        return;
    }
    const config = JSON.parse(configElement.textContent);
    const fitAddon = new FitAddon.FitAddon();
    const terminal = new Terminal({
        disableStdin: true,
        cursorBlink: false,
        fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace",
        fontSize: 14,
        scrollback: 10000,
        theme: { background: "#000000", foreground: "#e6e9ef" },
    });
    let replayGeneration = 0;
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    function decodePayload(event) {
        if (event.payload.encoding === "json") {
            return event.payload.data;
        }
        const decoded = atob(event.payload.data);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
            bytes[index] = decoded.charCodeAt(index);
        }
        return bytes;
    }

    async function loadAll(path) {
        const events = [];
        let start = 0;
        while (start !== null) {
            const response = await fetch(`${path}?start=${start}&limit=2000`);
            if (!response.ok) {
                throw new Error(`Recording request failed with HTTP ${response.status}`);
            }
            const page = await response.json();
            events.push(...page.events);
            start = page.next_sequence;
        }
        return events;
    }

    async function replay() {
        const generation = ++replayGeneration;
        terminal.reset();
        const events = await loadAll(config.eventsPath);
        const speed = Number(document.getElementById("replay-speed").value);
        let previousOffset = 0;
        for (const event of events) {
            if (generation !== replayGeneration) {
                return;
            }
            if (speed > 0) {
                const delay = Math.min(2000, (event.offset_ns - previousOffset) / 1000000 / speed);
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            previousOffset = event.offset_ns;
            if (event.type === "resize") {
                const dimensions = decodePayload(event);
                terminal.resize(dimensions.columns, dimensions.rows);
            } else if (event.type === "output") {
                terminal.write(decodePayload(event));
            }
        }
    }

    document.getElementById("replay-start").addEventListener("click", function () {
        replay().catch(error => terminal.writeln(`\r\nReplay failed: ${error.message}`));
    });
    document.getElementById("replay-clear").addEventListener("click", function () {
        replayGeneration += 1;
        terminal.reset();
    });
    document.body.addEventListener("htmx:beforeSwap", function (event) {
        if (event.detail.target === document.body) {
            replayGeneration += 1;
        }
    });
    window.revealRawShellInput = async function () {
        const events = await loadAll(config.inputPath);
        const decoder = new TextDecoder("utf-8", { fatal: false });
        let value = "";
        events.forEach(event => {
            value += decoder.decode(decodePayload(event), { stream: true });
        });
        value += decoder.decode();
        const output = document.getElementById("raw-input-output");
        output.textContent = value;
        output.classList.remove("hidden");
    };
    window.addEventListener("resize", function () { fitAddon.fit(); });
})();