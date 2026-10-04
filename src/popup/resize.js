(() => {
    const SIZE_KEY = 'popupSize';

    function initialize({ scaleSelect, isPlayerWindow }) {
        if (isPlayerWindow) return { restore() {} };

        const body = document.body;
        const grip = document.createElement('button');
        grip.id = 'popup-resize-handle';
        grip.className = 'popup-resize-handle';
        grip.type = 'button';
        grip.setAttribute('aria-label', 'Resize popup');
        grip.setAttribute('aria-describedby', 'popup-resize-help');
        grip.title = 'Drag to resize. Arrow keys move this corner by 10px; Shift + arrow moves 50px. Choose a size preset to reset.';

        const help = document.createElement('span');
        help.id = 'popup-resize-help';
        help.className = 'sr-only';
        help.textContent = 'Drag the bottom-left corner to resize. Left widens, right narrows, up shortens, and down lengthens. Hold Shift for larger steps. Choose a size preset to reset.';

        const announcement = document.createElement('span');
        announcement.className = 'sr-only';
        announcement.setAttribute('role', 'status');
        body.append(grip, help, announcement);
        body.classList.add('popup-resizable');

        let customOption = null;
        let customSize = null;
        let drag = null;
        let interacted = false;

        function clampSize(size) {
            const maxWidth = Math.min(800, screen.availWidth || 800);
            const maxHeight = Math.min(600, screen.availHeight || 600);
            return {
                width: Math.round(Math.max(Math.min(360, maxWidth), Math.min(maxWidth, size.width))),
                height: Math.round(Math.max(Math.min(280, maxHeight), Math.min(maxHeight, size.height)))
            };
        }

        function currentSize() {
            const { width, height } = body.getBoundingClientRect();
            return clampSize({ width, height });
        }

        function announceSize() {
            announcement.textContent = `Popup size: ${customSize.width} by ${customSize.height} pixels.`;
        }

        function persistSize() {
            chrome.storage.local.set({ [SIZE_KEY]: customSize }).catch(() => {});
            announceSize();
        }

        function applySize(size) {
            customSize = clampSize(size);
            body.style.width = `${customSize.width}px`;
            body.style.height = `${customSize.height}px`;
            if (!customOption) {
                customOption = new Option('Custom', 'custom');
                customOption.disabled = true;
                customOption.hidden = true;
                scaleSelect.appendChild(customOption);
            }
            // Keep the existing text scale, while making every preset selectable
            // again (including the preset from which the user began resizing).
            scaleSelect.value = 'custom';
        }

        function finishDrag() {
            if (!drag) return;
            const { moved } = drag;
            drag = null;
            body.classList.remove('popup-resizing');
            if (moved) persistSize();
        }

        grip.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            interacted = true;
            grip.focus({ preventScroll: true });
            drag = { ...currentSize(), x: event.screenX, y: event.screenY, pointerId: event.pointerId, moved: false };
            grip.setPointerCapture(event.pointerId);
            body.classList.add('popup-resizing');
        });

        grip.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            const dx = drag.x - event.screenX;
            const dy = event.screenY - drag.y;
            if (!dx && !dy && !drag.moved) return;
            drag.moved = true;
            // Native Chrome action popups are anchored on their right side.
            // Screen coordinates stay stable as the popup's left edge moves.
            applySize({ width: drag.width + dx, height: drag.height + dy });
        });
        window.addEventListener('pointerup', finishDrag, true);
        window.addEventListener('pointercancel', finishDrag, true);
        grip.addEventListener('lostpointercapture', finishDrag);
        window.addEventListener('blur', finishDrag);
        window.addEventListener('pagehide', finishDrag);

        grip.addEventListener('keydown', event => {
            const step = event.shiftKey ? 50 : 10;
            const changes = {
                ArrowLeft: [step, 0],
                ArrowRight: [-step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step]
            };
            const change = changes[event.key];
            if (!change) return;
            event.preventDefault();
            interacted = true;
            const size = currentSize();
            applySize({ width: size.width + change[0], height: size.height + change[1] });
            persistSize();
        });

        scaleSelect.addEventListener('change', () => {
            if (scaleSelect.value === 'custom') return;
            interacted = true;
            finishDrag();
            customSize = null;
            body.style.removeProperty('width');
            body.style.removeProperty('height');
            customOption?.remove();
            customOption = null;
            chrome.storage.local.remove(SIZE_KEY).catch(() => {});
            announcement.textContent = 'Popup size reset to preset.';
        });

        return {
            restore(size) {
                if (!interacted && Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
                    applySize(size);
                }
            }
        };
    }

    globalThis.MinecraftJukeboxResize = { initialize };
})();
