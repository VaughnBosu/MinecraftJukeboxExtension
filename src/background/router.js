(() => {
    const bg = globalThis.MinecraftJukeboxBackground;

    const blobLibraryWaitTypes = new Set([
        'playDisc',
        'queueDisc',
        'requestMinecraftAssets'
    ]);
    const playbackCommandTypes = new Set([
        'playDisc', 'queueDisc', 'removeFromQueue', 'reorderQueue',
        'skipNext', 'skipPrevious', 'clearQueue', 'control', 'setVolume'
    ]);
    let playbackCommands = Promise.resolve();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const expectsResponse = bg.messageTypesExpectingResponse.has(message?.type);
        let didSendResponse = false;

        const safeSendResponse = response => {
            if (didSendResponse) {
                return;
            }

            didSendResponse = true;
            try {
                sendResponse(response);
            } catch (error) {
                console.error('[MinecraftJukebox] Failed to send response for message type:', message?.type, error);
            }
        };

        const handleMessage = async () => {
            await bg.stateReady;
            await bg.discLibraryReady;

            if (blobLibraryWaitTypes.has(message?.type)) {
                await bg.blobLibraryReady.catch(() => {});
            }

            switch (message?.type) {
                case 'minecraftAssetsUploadedIndex':
                    safeSendResponse(await bg.handleUploadedIndex(message));
                    return;
                case 'minecraftAssetBlob':
                    safeSendResponse(await bg.handleAssetBlob(message));
                    return;
                case 'minecraftAssetsUploadComplete':
                    safeSendResponse(await bg.handleUploadComplete(message));
                    return;
                case 'requestMinecraftAssets':
                    safeSendResponse(bg.getAssetsResponse());
                    return;
                case 'playDisc':
                    await bg.handlePlayDisc(message);
                    break;
                case 'queueDisc':
                    await bg.handleQueueDisc(message);
                    break;
                case 'removeFromQueue':
                    await bg.handleRemoveFromQueue(message.index);
                    break;
                case 'reorderQueue':
                    await bg.handleReorderQueue(message.fromIndex, message.toIndex);
                    break;
                case 'skipNext':
                    await bg.handleSkipNext();
                    break;
                case 'skipPrevious':
                    await bg.handleSkipPrevious();
                    break;
                case 'clearQueue':
                    await bg.handleClearQueue();
                    break;
                case 'control':
                    await bg.handleControl(message.command, message.value);
                    break;
                case 'setVolume':
                    bg.applyVolumeLevel(message.volume);
                    break;
                case 'requestState':
                    safeSendResponse(bg.getStateSnapshot());
                    return;
                case 'progress':
                    bg.handleProgressUpdate(message);
                    break;
                case 'playbackStopped':
                    bg.handlePlaybackStopped(message);
                    break;
                default:
                    break;
            }
        };

        // Multiple player views can issue commands while audio is still being
        // initialized. Preserve their order without delaying progress updates.
        const isPlaybackCommand = playbackCommandTypes.has(message?.type);
        const operation = isPlaybackCommand ? playbackCommands.then(handleMessage) : handleMessage();
        if (isPlaybackCommand) playbackCommands = operation.catch(() => {});
        operation.catch(error => {
            console.error('[MinecraftJukebox] Failed to process message type:', message?.type, error);
            if (expectsResponse && !didSendResponse) {
                safeSendResponse({ ok: false });
            }
        });

        return expectsResponse;
    });
})();
