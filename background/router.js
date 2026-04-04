(() => {
    const bg = globalThis.MinecraftJukeboxBackground;

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

        (async () => {
            await bg.stateReady;
            await bg.discLibraryReady;

            const skipBlobWaitTypes = new Set([
                'minecraftAssetsUploadedIndex',
                'minecraftAssetBlob',
                'minecraftAssetsUploadComplete'
            ]);

            if (!skipBlobWaitTypes.has(message?.type)) {
                await bg.blobLibraryReady.catch(() => {});
            }

            switch (message?.type) {
                case 'minecraftAssetsSelected':
                    bg.setDiscLibrary(message.assets);
                    break;
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
                case 'requestDiscBlob':
                    safeSendResponse(await bg.getDiscBlobResponse(message));
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
        })().catch(error => {
            console.error('[MinecraftJukebox] Failed to process message type:', message?.type, error);
            if (expectsResponse && !didSendResponse) {
                safeSendResponse({ ok: false });
            }
        });

        return expectsResponse;
    });

    chrome.runtime.onInstalled.addListener(() => {
        bg.persistState();
    });
})();
