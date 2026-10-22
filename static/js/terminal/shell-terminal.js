(function () {
    "use strict";

    const container = document.getElementById("terminal-container");
    const configElement = document.getElementById("terminal-config");
    if (!container || !configElement || typeof Terminal !== "function") {
        return;
    }

    const config = JSON.parse(configElement.textContent);
    const statusElement = document.getElementById("terminal-status");
    const reconnectButton = document.getElementById("terminal-reconnect");
    const clearButton = document.getElementById("terminal-clear");
    const disconnectButton = document.getElementById("terminal-disconnect");
    const startButton = document.getElementById("terminal-start");
    const acknowledgement = document.getElementById("recording-acknowledgement");
    const fitAddon = new FitAddon.FitAddon();
    const styles = getComputedStyle(document.documentElement);
    const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace",
        fontSize: 14,
        scrollback: 5000,
        allowProposedApi: false,
        theme: {
            background: "#000000",
            foreground: styles.getPropertyValue("--text-primary").trim() || "#e6e9ef",
            cursor: styles.getPropertyValue("--success-400").trim() || "#4ade80",
            selectionBackground: styles.getPropertyValue("--primary-700").trim() || "#1e40af",
        },
    });
    let socket = null;
    let manualClose = false;
    let resizeTimer = null;
    let recordingAcknowledged = false;

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();

    function setStatus(label, className) {
        statusElement.textContent = label;
        statusElement.className = className;
    }

    function bytesToBase64(bytes) {
        let value = "";
        for (let index = 0; index < bytes.length; index += 1) {
            value += String.fromCharCode(bytes[index]);
        }
        return btoa(value);
    }

    function base64ToBytes(value) {
        const decoded = atob(value);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
            bytes[index] = decoded.charCodeAt(index);
        }
        return bytes;
    }

    function send(message) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }

    function sendResize() {
        fitAddon.fit();
        send({ type: "resize", columns: terminal.cols, rows: terminal.rows });
    }

    function connect() {
        if (config.recording && !recordingAcknowledged) {
            return;
        }
        if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) {
            return;
        }
        manualClose = false;
        terminal.reset();
        terminal.writeln("\x1b[90mConnecting to the WebZFS terminal...\x1b[0m");
        setStatus("Connecting", "badge-warning");
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}${config.socketPath}`);

        socket.addEventListener("open", function () {
            fitAddon.fit();
            send({
                type: "start",
                columns: terminal.cols,
                rows: terminal.rows,
                recording_expected: Boolean(config.recording),
                recording_acknowledged: recordingAcknowledged,
            });
        });
        socket.addEventListener("message", function (event) {
            const message = JSON.parse(event.data);
            if (message.type === "output") {
                terminal.write(base64ToBytes(message.data));
            } else if (message.type === "ready") {
                setStatus("Connected", "badge-success");
                terminal.focus();
            } else if (message.type === "error") {
                terminal.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
                setStatus("Error", "badge-danger");
            } else if (message.type === "configuration_changed") {
                terminal.writeln(`\r\n\x1b[33m${message.message}\x1b[0m`);
                setStatus("Reload required", "badge-warning");
                manualClose = true;
                window.setTimeout(function () {
                    window.location.reload();
                }, 750);
            } else if (message.type === "closed") {
                setStatus("Disconnected", "badge-secondary");
                if (socket) {
                    socket.close(1000, "Server finalized terminal");
                }
            }
        });
        socket.addEventListener("close", function (event) {
            socket = null;
            disconnectButton.disabled = false;
            if (!manualClose) {
                terminal.writeln(`\r\n\x1b[90mTerminal disconnected (${event.code}).\x1b[0m`);
            }
            setStatus("Disconnected", "badge-secondary");
        });
        socket.addEventListener("error", function () {
            setStatus("Connection failed", "badge-danger");
        });
    }

    terminal.onData(function (data) {
        const bytes = new TextEncoder().encode(data);
        send({ type: "input", data: bytesToBase64(bytes) });
    });

    reconnectButton.addEventListener("click", connect);
    clearButton.addEventListener("click", function () {
        terminal.clear();
        terminal.focus();
    });
    disconnectButton.addEventListener("click", function () {
        manualClose = true;
        send({ type: "close" });
        disconnectButton.disabled = true;
    });

    document.body.addEventListener("htmx:beforeSwap", function (event) {
        if (event.detail.target === document.body && socket) {
            manualClose = true;
            socket.close(1000, "Page navigation");
        }
    });

    if (config.recording) {
        acknowledgement.addEventListener("change", function () {
            startButton.disabled = !acknowledgement.checked;
        });
        startButton.addEventListener("click", function () {
            if (!acknowledgement.checked) {
                return;
            }
            recordingAcknowledged = true;
            document.getElementById("terminal-consent").hidden = true;
            connect();
        });
    } else {
        connect();
    }

    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(sendResize, 100);
    });
    window.addEventListener("beforeunload", function () {
        manualClose = true;
        if (socket) {
            socket.close(1000, "Page closed");
        }
    });
})();